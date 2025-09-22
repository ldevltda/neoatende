// backend/src/services/WbotServices/listeners/handleOpenAi.ts
import OpenAI from "openai";
import * as Planner from "../../AI/Planner";
import { loadState, saveState } from "../../InventoryServices/ConversationState";
import * as InventoryFormatter from "../../InventoryServices/InventoryFormatter";
import * as RunSearchService from "../../InventoryServices/RunSearchService";
import * as NLFilter from "../../InventoryServices/NLFilter";
import InventoryIntegration from "../../../models/InventoryIntegration";
import { sanitizeName, keepOnlySpecifiedChars } from "./helpers";
import { logger } from "../../../utils/logger";
import { proto } from "baileys";
import { RateLimiter } from "../../AI/RateLimiter";
import { maskPII } from "../../AI/Sanitize";
import { shouldTransferToHuman } from "../../AI/TransferPolicy";
import { LongTermMemory } from "../../AI/LongTermMemory";

/** ---------- helpers p/ import dinâmico sem erro de TS ---------- */
async function safeImport(modulePath: string): Promise<any | null> {
  try {
    // evita erro de resolução do TS quando o arquivo não existe neste repo
    // @ts-ignore
    const dynImport = (Function("p", "return import(p)")) as (p: string) => Promise<any>;
    return await dynImport(modulePath);
  } catch {
    try {
      // eslint-disable-next-line @typescript-eslint/no-var-requires
      return require(modulePath);
    } catch {
      return null;
    }
  }
}

/** ===== Prompt Lookup compatível com sua tela ===== */
type PromptConfig = {
  prompt?: string;
  temperature?: number;
  maxTokens?: number;
  name?: string;
  apiKey?: string;
};

async function getPromptForTicket(companyId: number, queueId?: number | null): Promise<PromptConfig> {
  // 1) tenta serviço (se existir neste projeto)
  const svc = await safeImport("../../PromptServices/PromptLookupService");
  if (svc) {
    if (typeof (svc as any).getCompanyPromptByQueueId === "function") {
      try {
        const r = await (svc as any).getCompanyPromptByQueueId(companyId, queueId);
        if (r) return r as PromptConfig;
      } catch {}
    }
    if (typeof (svc as any).getCompanyPromptByQueue === "function") {
      try {
        const r = await (svc as any).getCompanyPromptByQueue(companyId, queueId);
        if (r) return r as PromptConfig;
      } catch {}
    }
  }

  // 2) tenta model direto como fallback
  try {
    const PromptModelMod = await safeImport("../../../models/Prompt");
    const PromptModel = PromptModelMod?.default || PromptModelMod;
    if (PromptModel) {
      const where: any = { companyId };
      if (queueId) where.queueId = queueId;
      const row = await PromptModel.findOne({ where, order: [["id", "DESC"]] });
      if (row) {
        const anyRow = row as any;
        return {
          prompt: anyRow.prompt,
          temperature: typeof anyRow.temperature === "number" ? anyRow.temperature : undefined,
          maxTokens:
            typeof anyRow.maxTokens === "number"
              ? anyRow.maxTokens
              : typeof anyRow.max_tokens === "number"
              ? anyRow.max_tokens
              : undefined,
          name: anyRow.name,
          apiKey: anyRow.apiKey ?? undefined
        };
      }
    }
  } catch {}

  // 3) default
  return {
    prompt:
      "Você é um agente de atendimento em pt-BR. Seja cordial, objetivo e siga as políticas da empresa. " +
      "Nunca invente dados; peça mais informações ou encaminhe para humano quando necessário.",
  };
}

/** ===== Tipos internos ===== */
interface ChatMsg { role: "system" | "user" | "assistant"; content: string; }

const sessionsOpenAi: { id?: number; client: OpenAI }[] = [];
const limiter = RateLimiter.forGlobal();

async function getOpenAiClient(companyId: number, overrideKey?: string) {
  const apiKey = overrideKey || process.env.OPENAI_API_KEY;
  if (!apiKey) throw new Error("OPENAI_API_KEY not set");
  if (overrideKey) return new OpenAI({ apiKey }); // por-prompt
  let session = sessionsOpenAi.find(s => s.id === companyId);
  if (!session) {
    session = { id: companyId, client: new OpenAI({ apiKey }) };
    sessionsOpenAi.push(session);
  }
  return session.client;
}

function buildDefaultGreeting(name?: string, brand?: string) {
  const who = sanitizeName(name || "tudo bem?");
  const b = keepOnlySpecifiedChars(brand || "nossa equipe");
  return `Olá ${who}! 👋 Eu sou o assistente virtual da ${b}. Como posso ajudar hoje?`;
}

async function callPlanner(args: any) {
  const anyPlanner: any = Planner as any;
  if (typeof anyPlanner.plan === "function") return anyPlanner.plan(args);
  if (anyPlanner.default && typeof anyPlanner.default.plan === "function") return anyPlanner.default.plan(args);
  const text: string = (args?.text || "").toLowerCase();
  const inv = /(im[óo]vel|apart|casa|estoque|produto|carro|ve[ií]culo|agenda|hor[aá]rio|pre[çc]o|dispon[ií]vel)/.test(text);
  return { intent: inv ? "browse_inventory" : "smalltalk", query_ready: inv, slots: {}, missing_slots: [], followups: inv ? [] : ["Me conta um pouco mais, por favor."] };
}

async function chooseIntegrationByTextCompat(companyId: number, text: string) {
  const all = await InventoryIntegration.findAll({ where: { companyId }, order: [["id", "ASC"]] });
  if (!all.length) return null;
  if (all.length === 1) return all[0];
  const t = (text || "").toLowerCase();
  const scored = all.map((intg: any) => {
    const hint = (intg.categoryHint || "").toLowerCase();
    let score = 0;
    if (hint && t.includes(hint)) score += 2;
    if (/im[óo]veis|imovel|apart|casa/.test(t) && /im[óo]veis|imovel/.test(hint)) score += 1;
    if (/carro|ve[ií]culo/.test(t) && /carro|ve[ií]culo|auto|veiculo/.test(hint)) score += 1;
    if (/agenda|hor[aá]rio/.test(t) && /agenda|calendar/.test(hint)) score += 1;
    return { intg, score };
  }).sort((a,b) => b.score - a.score);
  return (scored[0]?.score || 0) > 0 ? scored[0].intg : all[0];
}

async function callParseCriteria(companyId: number, text: string, slots: any) {
  const anyNL: any = NLFilter as any;
  if (typeof anyNL.parseCriteriaFromText === "function") {
    try { return await anyNL.parseCriteriaFromText(text); } catch {}
    try { return await anyNL.parseCriteriaFromText(companyId, text); } catch {}
    try { return await anyNL.parseCriteriaFromText(companyId, text, slots); } catch {}
  }
  return { query: text };
}

async function callRunSearch(args: any) {
  const anyRS: any = RunSearchService as any;
  if (typeof anyRS.run === "function") return anyRS.run(args);
  if (typeof anyRS.default === "function") return anyRS.default(args);
  if (typeof anyRS === "function") return anyRS(args);
  throw new Error("RunSearchService: nenhuma função exportada encontrada.");
}

/* ============================= WRAPPER COMPAT ============================== */
type HandleParams = { msg: proto.IWebMessageInfo; wbot: any; ticket: any; contact: any; };
function normalizeArgs(args: any[]): HandleParams {
  if (args.length === 1 && args[0] && typeof args[0] === "object" && "msg" in args[0]) return args[0] as HandleParams;
  const [msg, wbot, ticket, contact] = args;
  return { msg, wbot, ticket, contact } as HandleParams;
}
/* ========================================================================== */

const handleOpenAiCore = async ({ msg, wbot, ticket, contact }: HandleParams): Promise<void> => {
  try {
    if (contact?.disableBot) return;

    try { await limiter.consume(`ai:${ticket.companyId}`, 1); } catch {}

    const bodyMessage =
      msg && msg.message
        ? ((msg.message.conversation || msg.message.extendedTextMessage?.text) as string)
        : "";
    if (!bodyMessage) return;
    const text = (bodyMessage || "").trim();

    // === PROMPT CONFIG ===
    const promptCfg = await getPromptForTicket(ticket.companyId, ticket.queueId);
    const systemPrompt = (promptCfg.prompt || "").trim();
    const temperature = typeof promptCfg.temperature === "number" ? promptCfg.temperature : 0.4;
    const maxTokens = typeof promptCfg.maxTokens === "number" ? promptCfg.maxTokens : 256;

    const client = await getOpenAiClient(ticket.companyId, promptCfg.apiKey);
    const ltm = new LongTermMemory(promptCfg.apiKey || process.env.OPENAI_API_KEY!);
    const model = process.env.OPENAI_MODEL || "gpt-4o-mini";

    const convoState: any = await loadState(ticket.id).catch(() => null);
    const longMem = await ltm.read(ticket.companyId, contact?.id);

    const memoryContext = longMem.length
      ? `Memória do cliente: ${longMem.map(m => `${m.key}=${m.value}`).join(", ")}`
      : "";

    const plan = await callPlanner({
      text: `${maskPII(text)}\n${memoryContext ? `\n[Contexto]\n${memoryContext}` : ""}`,
      last_state: convoState?.state || {},
      model,
      systemPrompt
    });

    logger.info({
      ctx: "OpenAIPlanner",
      ticketId: ticket.id,
      companyId: ticket.companyId,
      intent: plan.intent,
      query_ready: plan.query_ready,
      slots: plan.slots,
      missing: plan.missing_slots
    });

    // ===== Smalltalk usando o prompt do cadastro =====
    if (!plan.intent || plan.intent === "smalltalk" || plan.intent === "other") {
      const messages: ChatMsg[] = [];
      if (systemPrompt) messages.push({ role: "system", content: systemPrompt });
      else messages.push({ role: "system", content: "Você é um atendente simpático, útil e objetivo. Responda em pt-BR." });

      if (memoryContext) messages.push({ role: "system", content: memoryContext });
      if (convoState?.history?.length) messages.push(...(convoState.history as ChatMsg[]));

      const chat = await client.chat.completions.create({
        model,
        temperature,
        max_tokens: maxTokens,
        messages: [...messages, { role: "user", content: maskPII(text) }]
      });

      const answer = chat.choices?.[0]?.message?.content?.trim();
      if (!answer) return;

      if (shouldTransferToHuman(answer)) {
        await wbot.sendMessage(msg.key.remoteJid!, { text: "Vou te transferir para um atendente humano para te ajudar melhor. 🙏" });
        return;
      }

      const sent = await wbot.sendMessage(msg.key.remoteJid!, { text: answer });
      try { const { verifyMessage } = await import("./mediaHelpers"); await verifyMessage(sent, ticket, contact); } catch {}

      try {
        const facts = await ltm.extractFactsPtBR(text, answer);
        if (facts?.length) await ltm.upsert(ticket.companyId, contact?.id, facts);
      } catch {}

      await saveState(ticket.id, {
        ...(convoState || {}),
        history: [
          ...(convoState?.history || []),
          { role: "user", content: text },
          { role: "assistant", content: answer }
        ].slice(-12)
      } as any);
      return;
    }

    // ===== Inventory (mantém o prompt como persona/política) =====
    if (plan.intent === "browse_inventory") {
      const chosen = await chooseIntegrationByTextCompat(ticket.companyId, text);
      const baseCriteria = await callParseCriteria(ticket.companyId, text, plan.slots || {});
      for (const mem of longMem) {
        if (mem.key === "bairro_interesse" && !baseCriteria.bairro) baseCriteria.bairro = mem.value;
        if (mem.key === "cidade_interesse" && !baseCriteria.cidade) baseCriteria.cidade = mem.value;
        if (mem.key === "orcamento_max" && !baseCriteria.precoMax) baseCriteria.precoMax = mem.value;
        if (mem.key === "orcamento_min" && !baseCriteria.precoMin) baseCriteria.precoMin = mem.value;
        if (mem.key === "tipo_imovel" && !baseCriteria.tipo) baseCriteria.tipo = mem.value;
        if (mem.key === "produto_interesse" && !baseCriteria.produto) baseCriteria.produto = mem.value;
      }

      if (!plan.query_ready || (plan.missing_slots && plan.missing_slots.length)) {
        const follow = (plan.followups && plan.followups[0])
          || `Perfeito! Pode me dizer mais detalhes (ex.: faixa de preço, região ou característica importante)?`;
        const sent = await wbot.sendMessage(msg.key.remoteJid!, { text: follow });
        try { const { verifyMessage } = await import("./mediaHelpers"); await verifyMessage(sent, ticket, contact); } catch {}
        return;
      }

      const searchRes = await callRunSearch({
        companyId: ticket.companyId,
        integrationId: chosen?.id,
        criteria: baseCriteria,
        page: 1,
        limit: 10,
        sort: "relevance:desc",
        locale: "pt-BR"
      });

      const payload = {
        items: searchRes.items || [],
        total: searchRes.total || 0,
        criteria: baseCriteria
      };

      let renderedText: string | undefined;
      if ((InventoryFormatter as any).formatInventoryReplyWithPrompt && systemPrompt) {
        renderedText = (InventoryFormatter as any).formatInventoryReplyWithPrompt(payload, systemPrompt);
      } else if ((InventoryFormatter as any).formatInventoryReply) {
        renderedText = (InventoryFormatter as any).formatInventoryReply(payload);
      } else {
        renderedText = JSON.stringify(payload, null, 2);
      }

      const sent = await wbot.sendMessage(msg.key.remoteJid!, { text: renderedText || "Não encontrei opções ideais ainda. Me dê mais detalhes?" });
      try { const { verifyMessage } = await import("./mediaHelpers"); await verifyMessage(sent, ticket, contact); } catch {}

      try {
        const facts = await ltm.extractFactsPtBR(text, renderedText);
        if (facts?.length) await ltm.upsert(ticket.companyId, contact?.id, facts);
      } catch {}

      await saveState(ticket.id, {
        ...(convoState || {}),
        history: [
          ...(convoState?.history || []),
          { role: "user", content: text },
          { role: "assistant", content: renderedText! }
        ].slice(-12)
      } as any);
      return;
    }

    // fallback
    const sent = await wbot.sendMessage(msg.key.remoteJid!, {
      text: "Posso te ajudar com dúvidas ou buscar informações/alternativas para você. Me conte um pouco mais! 🙂"
    });
    try { const { verifyMessage } = await import("./mediaHelpers"); await verifyMessage(sent, ticket, contact); } catch {}
  } catch (err: any) {
    logger.error({ ctx: "handleOpenAi", err: err?.message || err });
    try {
      await wbot.sendMessage(msg.key.remoteJid!, {
        text: "Tive um problema para responder agora. Vou te transferir para um atendente humano, tudo bem? 🙏"
      });
    } catch {}
  }
};

/** Export nomeado — aceita objeto OU posicional via wrapper */
export const handleOpenAi = async (...args: any[]) => {
  const params = normalizeArgs(args);
  if (!params?.ticket) throw new Error("handleOpenAi: ticket indefinido na chamada");
  return handleOpenAiCore(params);
};

/** Export default — compat com `import handleOpenAi from ...` */
export default handleOpenAi;
