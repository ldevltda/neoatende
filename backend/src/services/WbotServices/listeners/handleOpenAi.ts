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

interface ChatMsg { role: "system" | "user" | "assistant"; content: string; }

const sessionsOpenAi: { id?: number; client: OpenAI }[] = [];
const limiter = RateLimiter.forGlobal();

async function getOpenAiClient(companyId: number) {
  if (!process.env.OPENAI_API_KEY) throw new Error("OPENAI_API_KEY not set");
  let session = sessionsOpenAi.find(s => s.id === companyId);
  if (!session) {
    session = { id: companyId, client: new OpenAI({ apiKey: process.env.OPENAI_API_KEY }) };
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
  if (anyPlanner.default && typeof anyPlanner.default.plan === "function") {
    return anyPlanner.default.plan(args);
  }
  const text: string = (args?.text || "").toLowerCase();
  const inv = /(im[óo]vel|apart|casa|estoque|produto|carro|ve[ií]culo|agenda|hor[aá]rio|pre[çc]o|dispon[ií]vel)/.test(text);
  return {
    intent: inv ? "browse_inventory" : "smalltalk",
    query_ready: inv,
    slots: {},
    missing_slots: [],
    followups: inv ? [] : ["Me conta um pouco mais, por favor."]
  };
}

async function chooseIntegrationByTextCompat(companyId: number, text: string) {
  const list = await InventoryIntegration.findAll({ where: { companyId, isActive: true }, order: [["id", "ASC"]] });
  if (!list.length) return null;
  if (list.length === 1) return list[0];

  const t = (text || "").toLowerCase();
  const scored = list.map(intg => {
    const hint = (intg.categoryHint || "").toLowerCase();
    let score = 0;
    if (hint && t.includes(hint)) score += 2;
    if (/im[óo]veis|imovel|apart|casa/.test(t) && /im[óo]veis|imovel/.test(hint)) score += 1;
    if (/carro|ve[ií]culo/.test(t) && /carro|ve[ií]culo|auto|veiculo/.test(hint)) score += 1;
    if (/agenda|hor[aá]rio/.test(t) && /agenda|calendar/.test(hint)) score += 1;
    return { intg, score };
  }).sort((a,b) => b.score - a.score);

  return (scored[0]?.score || 0) > 0 ? scored[0].intg : list[0];
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
  if (args.length === 1 && args[0] && typeof args[0] === "object" && "msg" in args[0]) {
    return args[0] as HandleParams; // formato objeto
  }
  const [msg, wbot, ticket, contact] = args;        // formato posicional
  return { msg, wbot, ticket, contact } as HandleParams;
}
/* ========================================================================== */

/** Núcleo do agente (lógica principal) */
const handleOpenAiCore = async ({
  msg, wbot, ticket, contact
}: HandleParams): Promise<void> => {
  try {
    if (contact?.disableBot) return;

    await limiter.consume(`ai:${ticket.companyId}`, 1);

    const bodyMessage =
      msg && msg.message
        ? ((msg.message.conversation || msg.message.extendedTextMessage?.text) as string)
        : "";

    if (!bodyMessage) return;
    const text = (bodyMessage || "").trim();

    const companyId = ticket.companyId;
    const client = await getOpenAiClient(companyId);
    const ltm = new LongTermMemory(process.env.OPENAI_API_KEY!);
    const model = process.env.OPENAI_MODEL || "gpt-4o-mini";

    const convoState: any = await loadState(ticket.id).catch(() => null);
    const longMem = await ltm.read(companyId, contact?.id);

    const memoryContext = longMem.length
      ? `Memória do cliente: ${longMem.map(m => `${m.key}=${m.value}`).join(", ")}`
      : "";

    const plan = await callPlanner({
      text: `${maskPII(text)}\n${memoryContext ? `\n[Contexto]\n${memoryContext}` : ""}`,
      last_state: convoState?.state || {},
      model
    });

    logger.info({
      ctx: "OpenAIPlanner",
      ticketId: ticket.id,
      companyId,
      intent: plan.intent,
      query_ready: plan.query_ready,
      slots: plan.slots,
      missing: plan.missing_slots
    });

    if (!plan.intent || plan.intent === "other") {
      const sent = await wbot.sendMessage(msg.key.remoteJid!, {
        text: `Entendi. Você poderia me contar um pouco mais para eu te ajudar melhor?`
      });
      try { const { verifyMessage } = await import("./mediaHelpers"); await verifyMessage(sent, ticket, contact); } catch {}
      return;
    }

    if (plan.intent === "smalltalk") {
      const messages: ChatMsg[] = [
        { role: "system", content: "Você é um atendente simpático, útil e objetivo. Responda em pt-BR." },
      ];
      if (memoryContext) messages.push({ role: "system", content: memoryContext });
      if (convoState?.history?.length) messages.push(...(convoState.history as ChatMsg[]));

      const chat = await client.chat.completions.create({
        model,
        temperature: 0.4,
        max_tokens: 256,
        messages: [
          ...messages,
          { role: "user", content: maskPII(text) }
        ]
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
        if (facts?.length) await ltm.upsert(companyId, contact?.id, facts);
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

    if (plan.intent === "browse_inventory") {
      const chosen = await chooseIntegrationByTextCompat(companyId, text);
      const baseCriteria = await callParseCriteria(companyId, text, plan.slots || {});

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
        companyId,
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

      const renderedText = (InventoryFormatter as any).formatInventoryReply
        ? (InventoryFormatter as any).formatInventoryReply(payload)
        : JSON.stringify(payload, null, 2);

      const sent = await wbot.sendMessage(msg.key.remoteJid!, { text: renderedText || "Não encontrei opções ideais ainda. Me dê mais detalhes?" });
      try { const { verifyMessage } = await import("./mediaHelpers"); await verifyMessage(sent, ticket, contact); } catch {}

      try {
        const facts = await ltm.extractFactsPtBR(text, renderedText);
        if (facts?.length) await ltm.upsert(companyId, contact?.id, facts);
      } catch {}

      await saveState(ticket.id, {
        ...(convoState || {}),
        history: [
          ...(convoState?.history || []),
          { role: "user", content: text },
          { role: "assistant", content: renderedText }
        ].slice(-12)
      } as any);

      return;
    }

    const isGreet = /^oi|ol[aá]|bom dia|boa tarde|boa noite/i.test(text);
    if (isGreet) {
      const sentMessage = await wbot.sendMessage(msg.key.remoteJid!, {
        text: buildDefaultGreeting(contact?.name, process.env.BRAND_NAME || process.env.APP_NAME)
      });
      try { const { verifyMessage } = await import("./mediaHelpers"); await verifyMessage(sentMessage, ticket, contact); } catch {}
      return;
    }

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
