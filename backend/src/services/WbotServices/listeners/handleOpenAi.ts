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
import Company from "../../../models/Company";
import { REAL_ESTATE_SYSTEM_PROMPT } from "../../Agents/templates/realEstatePrompt";
import VisitService from "../../Visits/VisitService";

// ---- helpers
async function safeImport(modulePath: string): Promise<any | null> {
  try {
    // @ts-ignore
    const dynImport = (Function("p", "return import(p)")) as (p: string) => Promise<any>;
    return await dynImport(modulePath);
  } catch {
    try { return require(modulePath); } catch { return null; }
  }
}

// Fallback list-renderer (se não existir renderer dedicado)
function defaultWhatsAppRenderer(items: any[], maxItems = 3): string {
  if (!Array.isArray(items) || items.length === 0) {
    return "Não encontrei opções com esses critérios agora. Posso ajustar bairro, faixa de preço ou número de quartos para te mostrar alternativas?";
  }
  const take = items.slice(0, maxItems).map((p: any, i: number) => {
    const title = p.title || p.titulo || p.name || p.nome || `Imóvel ${i + 1}`;
    const bairro = p.bairro || p.neighborhood || "";
    const cidade = p.cidade || p.city || "";
    const area = p.area || p.area_m2 || p.m2 || p.areaUtil || undefined;
    const dorm = p.dormitorios || p.quartos || p.bedrooms || undefined;
    const vagas = p.vagas || p.garagens || p.parking || undefined;
    const preco = p.price || p.preco || p.valor || undefined;
    const link = p.url || p.link || p.permalink || "";

    const lines = [
      `*${i + 1}) ${title}*`,
      (bairro || cidade) && `• ${[bairro, cidade].filter(Boolean).join(" / ")}`,
      area && `• ${String(area).replace(".", ",")} m²`,
      (dorm || vagas) && `• ${dorm ?? "?"} dorm · ${vagas ?? "?"} vaga(s)`,
      preco && `• ${preco}`,
      link && `• ${link}`
    ].filter(Boolean);

    return lines.join("\n");
  });

  return `${take.join("\n\n")}\n\n👉 Quer ver por dentro? Agendo sua visita agora.`;
}

// Detalhes fallback
function defaultWhatsAppDetails(item: any): string {
  if (!item) return "Não encontrei esse imóvel. Quer tentar outro código ou me dar mais detalhes?";
  const title = item.title || item.titulo || item.name || "Imóvel";
  const bairro = item.bairro || item.neighborhood || "";
  const cidade = item.cidade || item.city || "";
  const area = item.area || item.area_m2 || item.m2 || item.areaUtil;
  const dorm = item.dormitorios || item.quartos || item.bedrooms;
  const vagas = item.vagas || item.garagens || item.parking;
  const banh = item.banheiros || item.bathrooms;
  const preco = item.price || item.preco || item.valor;
  const link = item.url || item.link || item.permalink || "";
  const desc = item.description || item.descricao || "";

  const parts = [
    `*${title}*`,
    (bairro || cidade) && `${[bairro, cidade].filter(Boolean).join(" / ")}`,
    area && `Área: ${String(area).replace(".", ",")} m²`,
    (dorm || vagas) && `Dorms/Vagas: ${dorm ?? "?"}/${vagas ?? "?"}`,
    banh && `Banheiros: ${banh}`,
    preco && `Preço: ${preco}`,
    desc && `—\n${desc}`,
    link && `🔗 ${link}`,
  ].filter(Boolean);

  return `${parts.join("\n")}\n\n👉 Quer agendar uma visita? Posso te sugerir dois horários.`;
}

// Polidor com LLM (opcional)
async function polishWithLLM(
  client: OpenAI,
  model: string,
  systemPrompt: string,
  text: string
): Promise<string> {
  try {
    const pol = await client.chat.completions.create({
      model,
      temperature: 0.2,
      max_tokens: 220,
      messages: [
        {
          role: "system",
          content:
            (systemPrompt || "Responda em pt-BR, cordial e objetivo.") +
            "\nRegra: não altere preços, links ou números. Apenas melhore o tom e a clareza."
        },
        {
          role: "user",
          content:
            `Reescreva levemente a mensagem abaixo, mantendo os dados exatos (códigos, preços, links, números). ` +
            `Melhore o tom e finalize com CTA curto.\n\n===\n${text}\n===`
        }
      ]
    });
    const out = pol.choices?.[0]?.message?.content?.trim();
    return out || text;
  } catch {
    return text;
  }
}

/** ===== Prompt Lookup ===== */
type PromptConfig = {
  prompt?: string;
  temperature?: number;
  maxTokens?: number;
  name?: string;
  apiKey?: string;
};

async function getPromptForTicket(companyId: number, queueId?: number | null): Promise<PromptConfig> {
  const svc = await safeImport("../../PromptServices/PromptLookupService");
  if (svc) {
    if (typeof (svc as any).getCompanyPromptByQueueId === "function") {
      try { const r = await (svc as any).getCompanyPromptByQueueId(companyId, queueId); if (r) return r; } catch {}
    }
    if (typeof (svc as any).getCompanyPromptByQueue === "function") {
      try { const r = await (svc as any).getCompanyPromptByQueue(companyId, queueId); if (r) return r; } catch {}
    }
  }

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

async function callPlanner(args: any) {
  const anyPlanner: any = Planner as any;
  if (typeof anyPlanner.plan === "function") return anyPlanner.plan(args);
  if (anyPlanner.default && typeof anyPlanner.default.plan === "function") return anyPlanner.default.plan(args);
  const text: string = (args?.text || "").toLowerCase();
  const inv = /(im[óo]vel|apart|casa|estoque|produto|carro|ve[ií]culo|agenda|hor[aá]rio|pre[çc]o|dispon[ií]vel|ver mais|detalh(e|es)|#\d+)/.test(text);
  return { intent: inv ? "browse_inventory" : "smalltalk", query_ready: inv, slots: {}, followups: inv ? [] : ["Me conta um pouco mais, por favor."] };
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

async function callParseCriteria(companyId: number, text: string, slots: Record<string, any>) {
  // 1) PlannerService (se existir)
  try {
    const svc = await safeImport("../../InventoryServices/PlannerService");
    if (svc?.parseCriteria) return await svc.parseCriteria(companyId, text, slots);
  } catch {}
  // 2) NLFilter variantes
  try {
    const anyNF: any = NLFilter as any;
    if (typeof anyNF.parseCriteria === "function") return await anyNF.parseCriteria(text, slots);
    if (typeof anyNF.parse === "function") return await anyNF.parse(text, slots);
  } catch {}
  // 3) fallback
  return { texto: text, ...slots };
}

/** ===== Intenções extras (detalhes/paginação/agendamento) ===== */
function askLGPDOnce(state: any): string | null {
  if (state?.lgpdShown) return null;
  return "Aviso LGPD: ao compartilhar dados pessoais (nome, e-mail, telefone), você concorda com nosso uso para contato sobre os imóveis. Você pode pedir para parar a qualquer momento.";
}

function detectVisitIntent(text: string) {
  const t = (text || "").toLowerCase();
  return /(quero\s+visitar|agendar|ver por dentro|marcar visita|agendar visita)/.test(t);
}

function detectShowMore(text: string) {
  const t = (text || "").toLowerCase();
  return /(ver mais|mais|mostrar mais|próximos)/.test(t);
}

function detectDetailsByIndex(text: string): number | null {
  // "#2" | "detalhes 2" | "ver 2"
  const mHash = text.match(/#\s*(\d{1,2})/);
  if (mHash) return parseInt(mHash[1], 10);
  const m = text.toLowerCase().match(/detalh(?:e|es)\s+(\d{1,2})|ver\s+(\d{1,2})/);
  if (m) return parseInt((m[1] || m[2]), 10);
  return null;
}

function detectCode(text: string): string | null {
  // "código 123" | "cod 123" | "ref 123"
  const m = text.toLowerCase().match(/(c[oó]d(?:igo)?|ref(?:er[êe]ncia)?)\s*[:#]?\s*([a-z0-9\-]+)/i);
  return (m && m[2]) ? m[2] : null;
}

// Captura simples de lead (email/telefone)
async function maybeCaptureLead(text: string, contact: any) {
  try {
    const email = (text.match(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi) || [])[0];
    const phone = (text.match(/\+?55?\s*\(?\d{2}\)?\s*\d{4,5}[-\s]?\d{4}/g) || [])[0];
    const updates: any = {};
    if (email && !contact.email) updates.email = email.toLowerCase();
    if (phone && !contact.extraPhone) updates.extraPhone = phone.replace(/\D/g, "");
    if (Object.keys(updates).length) await contact.update(updates);
  } catch {}
}

async function callRunSearch(args: any) {
  try {
    if (typeof (RunSearchService as any).default === "function") return await (RunSearchService as any).default(args);
    if (typeof (RunSearchService as any).run === "function") return await (RunSearchService as any).run(args);
  } catch (err) {
    logger.error({ ctx: "callRunSearch", err });
  }
  return { items: [], total: 0, page: 1, pageSize: args?.limit || 5, raw: null };
}

/** Normaliza parâmetros */
function normalizeArgs(args: any[]) {
  if (args.length === 1 && typeof args[0] === "object") return args[0];
  const [msg, wbot, contact, ticket, companyId, , , , flow, isMenu, whatsapp] = args as any[];
  return { msg, wbot, contact, ticket, companyId, flow, isMenu, whatsapp };
}

/** Extrator estruturado (memória) */
async function extractStructuredFacts(text: string, reply: string) {
  try {
    const mod = await safeImport("../../AI/FactExtractors");
    if (mod?.extractStructuredFactsPtBR) return mod.extractStructuredFactsPtBR(text, reply);
  } catch {}
  // fallback mínimo via regex
  const facts: { key: string; value: string }[] = [];
  const email = (text.match(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi) || [])[0];
  const phone = (text.match(/\+?55?\s*\(?\d{2}\)?\s*\d{4,5}[-\s]?\d{4}/g) || [])[0];
  if (email) facts.push({ key: "email", value: email.toLowerCase() });
  if (phone) facts.push({ key: "telefone", value: phone.replace(/\D/g, "") });
  const dorm = text.match(/(\d)\s*(dormit[óo]rios?|quartos?)/i);
  if (dorm) facts.push({ key: "dormitorios", value: dorm[1] });
  const vagas = text.match(/(\d)\s*(vagas?|garagem)/i);
  if (vagas) facts.push({ key: "vagas", value: vagas[1] });
  const precoMax = text.match(/at[ée]\s*R?\$?\s*([\d\.\,]+)/i);
  if (precoMax) facts.push({ key: "precoMax", value: precoMax[1] });
  return facts;
}

/** Núcleo */
async function handleOpenAiCore(params: {
  msg: proto.IWebMessageInfo;
  wbot: any;
  contact: any;
  ticket: any;
  companyId: number;
  flow?: any;
  isMenu?: boolean;
  whatsapp?: any;
}) {
  const { msg, wbot, contact, ticket } = params;

  try {
    if (contact?.disableBot) return;

    try { await limiter.consume(`ai:${ticket.companyId}`, 1); } catch {}

    const bodyMessage =
      msg && msg.message
        ? ((msg.message.conversation || (msg.message as any).extendedTextMessage?.text) as string)
        : "";
    if (!bodyMessage) return;
    const text = (bodyMessage || "").trim();

    await maybeCaptureLead(text, contact); // captura básica (email/telefone)

    // === PROMPT CONFIG ===
    const promptCfg = await getPromptForTicket(ticket.companyId, ticket.queueId);
    let segment: string = "imoveis";
    try {
      const company = await Company.findByPk(ticket.companyId);
      if (company?.segment) segment = String(company.segment);
    } catch {}
    let systemPrompt = (promptCfg.prompt || "").trim();
    if (segment === "imoveis") {
      const persona = (REAL_ESTATE_SYSTEM_PROMPT || "").trim();
      systemPrompt = systemPrompt ? `${persona}\n\n${systemPrompt}` : persona;
    }
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
      text,
      memoryContext,
      lastState: convoState,
      longMem,
      companyId: ticket.companyId
    });

    // ===== Intenção: detalhes/paginação direta usando lastSearch =====
    if (segment === "imoveis" && convoState?.lastSearch?.items?.length) {
      // DETALHES POR ÍNDICE
      const idx = detectDetailsByIndex(text);
      if (idx !== null && idx > 0) {
        const item = convoState.lastSearch.items[idx - 1];
        let detailsText = defaultWhatsAppDetails(item);
        try {
          const rmod = await safeImport("../../InventoryServices/Renderers/WhatsAppRenderer");
          if (rmod?.renderPropertyDetails) detailsText = rmod.renderPropertyDetails(item);
        } catch {}
        const sent = await wbot.sendMessage(msg.key.remoteJid!, { text: detailsText });
        try { const { verifyMessage } = await import("./mediaHelpers"); await verifyMessage(sent, ticket, contact); } catch {}
        return;
      }
      // DETALHES POR CÓDIGO
      const code = detectCode(text);
      if (code) {
        const item = (convoState.lastSearch.items as any[]).find(it =>
          String(it.codigo || it.code || it.slug || it.id).toLowerCase() === code.toLowerCase()
        );
        if (item) {
          let detailsText = defaultWhatsAppDetails(item);
          try {
            const rmod = await safeImport("../../InventoryServices/Renderers/WhatsAppRenderer");
            if (rmod?.renderPropertyDetails) detailsText = rmod.renderPropertyDetails(item);
          } catch {}
          const sent = await wbot.sendMessage(msg.key.remoteJid!, { text: detailsText });
          try { const { verifyMessage } = await import("./mediaHelpers"); await verifyMessage(sent, ticket, contact); } catch {}
          return;
        }
      }
      // PAGINAÇÃO
      if (detectShowMore(text)) {
        const chosen = await chooseIntegrationByTextCompat(ticket.companyId, text);
        const nextPage = (convoState.lastSearch.page || 1) + 1;
        const pageSize = convoState.lastSearch.pageSize || 10;
        const searchRes = await callRunSearch({
          companyId: ticket.companyId,
          integrationId: chosen?.id || convoState.lastSearch.integrationId,
          criteria: convoState.lastSearch.criteria || {},
          page: nextPage,
          limit: pageSize,
          sort: "relevance:desc",
          locale: "pt-BR"
        });

        let rendered = defaultWhatsAppRenderer(searchRes.items || [], 3);
        try {
          const rmod = await safeImport("../../InventoryServices/Renderers/WhatsAppRenderer");
          if (rmod?.renderWhatsAppList)
            rendered = rmod.renderWhatsAppList(searchRes.items || [], { maxItems: 3 });
        } catch {}

        // polir (opcional)
        if (rendered && process.env.POLISH_WITH_LLM === "true") {
          rendered = await polishWithLLM(client, model, systemPrompt, rendered);
        }

        // salva lastSearch
        await saveState(ticket.id, {
          ...(convoState || {}),
          lastSearch: {
            integrationId: chosen?.id || convoState.lastSearch.integrationId,
            criteria: convoState.lastSearch.criteria,
            page: nextPage,
            pageSize,
            total: searchRes.total || 0,
            items: searchRes.items || []
          }
        });

        const sent = await wbot.sendMessage(msg.key.remoteJid!, { text: rendered });
        try { const { verifyMessage } = await import("./mediaHelpers"); await verifyMessage(sent, ticket, contact); } catch {}
        return;
      }
    }

    // ===== Smalltalk / Q&A =====
    if (plan.intent !== "browse_inventory") {
      const messages: ChatMsg[] = [];
      if (systemPrompt) messages.push({ role: "system", content: systemPrompt });
      else messages.push({ role: "system", content: "Você é um atendente simpático, útil e objetivo. Responda em pt-BR." });

      // LGPD (apenas 1x quando vamos qualificar)
      const lgpd = askLGPDOnce(convoState);
      if (lgpd) messages.push({ role: "system", content: `Mensagem obrigatória: ${lgpd}` });

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
        await wbot.sendMessage(msg.key.remoteJid!, { text: "Vou transferir para um atendente humano para te ajudar melhor. 🙏" });
        return;
      }

      const sent = await wbot.sendMessage(msg.key.remoteJid!, { text: answer });
      try { const { verifyMessage } = await import("./mediaHelpers"); await verifyMessage(sent, ticket, contact); } catch {}

      // Memória estruturada (fatos)
      try {
        const facts = await extractStructuredFacts(text, answer);
        if (facts?.length) await ltm.upsert(ticket.companyId, contact?.id, facts);
      } catch {}
      // Mantém histórico + flag LGPD
      await saveState(ticket.id, {
        ...(convoState || {}),
        lgpdShown: true,
        history: [
          ...(convoState?.history || []),
          { role: "user", content: text },
          { role: "assistant", content: answer }
        ].slice(-12)
      } as any);
      return;
    }

    // ===== Inventory =====
    if (plan.intent === "browse_inventory") {
      const chosen = await chooseIntegrationByTextCompat(ticket.companyId, text);
      const baseCriteria = await callParseCriteria(ticket.companyId, text, plan.slots || {});
      for (const mem of longMem) {
        if (mem.key === "bairro_interesse" && !baseCriteria.bairro) baseCriteria.bairro = mem.value;
        if (mem.key === "cidade_interesse" && !baseCriteria.cidade) baseCriteria.cidade = mem.value;
        if (mem.key === "precoMax" && !baseCriteria.precoMax) baseCriteria.precoMax = mem.value;
        if (mem.key === "precoMin" && !baseCriteria.precoMin) baseCriteria.precoMin = mem.value;
        if (mem.key === "dormitorios" && !baseCriteria.dormitorios) baseCriteria.dormitorios = mem.value;
        if (mem.key === "vagas" && !baseCriteria.vagas) baseCriteria.vagas = mem.value;
        if (mem.key === "tipo_imovel" && !baseCriteria.tipo) baseCriteria.tipo = mem.value;
      }

      // Intenção de agendamento (antes de buscar)
      if (segment === "imoveis" && detectVisitIntent(text)) {
        // Cria uma "solicitação" e pede 2 janelas
        await VisitService.requestVisit({
          companyId: ticket.companyId,
          ticketId: ticket.id,
          contactId: contact.id,
          propertyRef: convoState?.lastSearch?.items?.[0]?.codigo || null,
          notes: `Lead pediu visita via chat. Msg: "${text}".`
        });

        const reply = "Perfeito! 😊 Me envie *duas janelas de horário* (ex.: “sexta 15h ou sábado 10h”), que eu já valido e agendo pra você.";
        const sent = await wbot.sendMessage(msg.key.remoteJid!, { text: reply });
        try { const { verifyMessage } = await import("./mediaHelpers"); await verifyMessage(sent, ticket, contact); } catch {}
        return;
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

      // guarda lastSearch para paginação/detalhes
      await saveState(ticket.id, {
        ...(convoState || {}),
        lastSearch: {
          integrationId: chosen?.id,
          criteria: baseCriteria,
          page: 1,
          pageSize: 10,
          total: searchRes.total || 0,
          items: searchRes.items || []
        }
      });

      // Renderização da lista
      let renderedText: string | undefined;
      if (segment === "imoveis") {
        try {
          const rmod = await safeImport("../../InventoryServices/Renderers/WhatsAppRenderer");
          const renderFn =
            rmod?.renderWhatsAppList ||
            ((items: any[]) => defaultWhatsAppRenderer(items, 3));
          renderedText = renderFn(searchRes.items || [], {
            headerTitle: "🌟 Opções selecionadas",
            categoryHint: "imóveis",
            maxItems: 3,
            showIndexEmojis: true
          });
        } catch {
          renderedText = defaultWhatsAppRenderer(searchRes.items || [], 3);
        }
      }

      if (!renderedText) {
        if ((InventoryFormatter as any).formatInventoryReplyWithPrompt && systemPrompt) {
          renderedText = (InventoryFormatter as any).formatInventoryReplyWithPrompt(
            { items: searchRes.items || [], total: searchRes.total || 0, criteria: baseCriteria }, systemPrompt);
        } else if ((InventoryFormatter as any).formatInventoryReply) {
          renderedText = (InventoryFormatter as any).formatInventoryReply(
            { items: searchRes.items || [], total: searchRes.total || 0, criteria: baseCriteria });
        } else {
          renderedText = JSON.stringify({ items: searchRes.items || [], total: searchRes.total || 0 }, null, 2);
        }
      }

      // Polir com LLM (se habilitado)
      if (renderedText && process.env.POLISH_WITH_LLM === "true") {
        renderedText = await polishWithLLM(client, model, systemPrompt, renderedText);
      }

      const sent = await wbot.sendMessage(msg.key.remoteJid!, {
        text: renderedText || "Não encontrei opções ideais ainda. Me dê mais detalhes?"
      });
      try { const { verifyMessage } = await import("./mediaHelpers"); await verifyMessage(sent, ticket, contact); } catch {}

      // Extrair fatos e salvar
      try {
        const facts = await extractStructuredFacts(text, renderedText || "");
        if (facts?.length) await ltm.upsert(ticket.companyId, contact?.id, facts);
      } catch {}

      // histórico
      const newState: any = await loadState(ticket.id).catch(() => (convoState || {}));
      await saveState(ticket.id, {
        ...(newState || {}),
        history: [
          ...((newState?.history as ChatMsg[]) || []),
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
      const sent = await params.wbot.sendMessage(params.msg.key.remoteJid!, {
        text: "Tive um problema agora há pouco. Pode repetir, por favor?"
      });
      try { const { verifyMessage } = await import("./mediaHelpers"); await verifyMessage(sent, params.ticket, params.contact); } catch {}
    } catch {}
  }
}

export const handleOpenAi = async (...args: any[]) => {
  const params = normalizeArgs(args);
  if (!params?.ticket) throw new Error("handleOpenAi: ticket indefinido na chamada");
  return handleOpenAiCore(params);
};

export default handleOpenAi;
