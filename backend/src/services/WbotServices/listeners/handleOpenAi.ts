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
import Ticket from "../../../models/Ticket";
import Whatsapp from "../../../models/Whatsapp";
import Queue from "../../../models/Queue";
import VisitService from "../../Visits/VisitService";

// >>> NOVOS IMPORTS
import { calcularBudget } from "../../Finance/FinancingCalculator";
import { T as WappTmpl } from "../../Agents/templates/whatsappTemplates";
import { scoreLead } from "../../Leads/scoreLead";
// <<< NOVOS IMPORTS

/** -------------- Prompt dinâmico por segmento -------------- */
async function safeImport(modulePath: string): Promise<any | null> {
  try {
    // @ts-ignore
    const dynImport = (Function("p", "return import(p)")) as (p: string) => Promise<any>;
    return await dynImport(modulePath);
  } catch {
    try { return require(modulePath); } catch { return null; }
  }
}

// Usa o compositor (prioriza prompt do painel + guardrails por segmento)
async function composeSystemPrompt(companyId: number, userPromptFromDB?: string) {
  try {
    const mod = await safeImport("../../Prompt/composeSystemPrompt");
    if (mod?.composeSystemPrompt) {
      return await mod.composeSystemPrompt({ companyId, userPromptFromDB });
    }
  } catch {}
  // fallback mínimo
  const company = await Company.findByPk(companyId);
  const nomeEmpresa = company?.name || "sua empresa";
  const base = (userPromptFromDB || "").trim() || `Você é consultor(a) humano(a) da ${nomeEmpresa}.`;
  const guardrails = `Tom: claro, caloroso, direto, sem jargões. Fale em 1ª pessoa.
Nunca prometa aprovação de crédito. Pergunte no MÁXIMO 2 coisas por mensagem.
Se o pedido fugir do escopo jurídico/contábil, explique limites e direcione.`;
  return [base, guardrails].join("\n\n");
}

/** -------------- renderers fallback -------------- */
function defaultWhatsAppRenderer(items: any[], maxItems = 3): string {
  if (!Array.isArray(items) || items.length === 0) {
    return "Não encontrei opções com esses critérios agora. Quer ajustar bairro, faixa de preço ou número de quartos para te mostrar alternativas?";
  }
  const take = items.slice(0, maxItems).map((p: any, i: number) => {
    const title = p.TituloSite || p.Titulo || p.title || p.titulo || p.name || p.nome || `Imóvel ${i + 1}`;
    const bairro = p.Bairro || p.bairro || p.neighborhood || p.location?.neighborhood || "";
    const cidade = p.Cidade || p.cidade || p.city || p.location?.city || "";
    const area = p.AreaPrivativa || p.area || p.area_m2 || p.m2 || p.areaUtil || undefined;
    const dorm = p.Dormitorios || p.Dormitórios || p.dormitorios || p.quartos || p.bedrooms || undefined;
    const vagas = p.Vagas || p.VagasGaragem || p.vagas || p.garagens || p.parking || undefined;
    const preco = p.ValorVenda || p.Preco || p.Preço || p.price || p.preco || p.valor || undefined;
    const link = p.url || p.link || p.permalink || p.slug || "";

    const lines = [
      `*${i + 1}) ${title}*`,
      (bairro || cidade) && `• ${[bairro, cidade].filter(Boolean).join(" / ")}`,
      area && `• ${String(area).replace(".", ",")} m²`,
      (dorm || vagas) && `• ${dorm ?? "?"} dorm · ${vagas ?? "?"} vaga(s)`,
      preco && `• ${String(preco).toString().startsWith("R$") ? preco : `R$ ${preco}`}`,
      link && `• ${link}`
    ].filter(Boolean);

    return lines.join("\n");
  });

  return `🌟 *Opções selecionadas para você!*\n\n${take.join("\n\n")}\n\n👉 Quer ver por dentro? Agendo sua visita agora.`;
}

function defaultWhatsAppDetails(item: any): string {
  if (!item) return "Não encontrei esse imóvel. Quer tentar outro código ou me dar mais detalhes?";
  const title = item.TituloSite || item.Titulo || item.title || item.titulo || item.name || "Imóvel";
  const bairro = item.Bairro || item.bairro || item.neighborhood || item.location?.neighborhood || "";
  const cidade = item.Cidade || item.cidade || item.city || item.location?.city || "";
  const area = item.AreaPrivativa || item.area || item.area_m2 || item.m2 || item.areaUtil;
  const dorm = item.Dormitorios || item.Dormitórios || item.dormitorios || item.quartos || item.bedrooms;
  const vagas = item.Vagas || item.VagasGaragem || item.vagas || item.garagens || item.parking;
  const banh = item.Banheiros || item.banheiros || item.bathrooms;
  const preco = item.ValorVenda || item.Preco || item.Preço || item.price || item.preco || item.valor;
  const link = item.url || item.link || item.permalink || item.slug || "";
  const desc = item.description || item.descricao || item.Descricao || "";

  const parts = [
    `*${title}*`,
    (bairro || cidade) && `${[bairro, cidade].filter(Boolean).join(" / ")}`,
    area && `Área: ${String(area).replace(".", ",")} m²`,
    (dorm || vagas) && `Dorms/Vagas: ${dorm ?? "?"}/${vagas ?? "?"}`,
    banh && `Banheiros: ${banh}`,
    preco && `Preço: ${String(preco).toString().startsWith("R$") ? preco : `R$ ${preco}`}`,
    desc && `—\n${desc}`,
    link && `🔗 ${link}`,
  ].filter(Boolean);

  return `${parts.join("\n")}\n\n👉 Quer agendar uma visita? Posso te sugerir dois horários.`;
}

/** -------------- polimento opcional com LLM -------------- */
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

/** -------------- prompt lookup -------------- */
type PromptConfig = {
  prompt?: string;
  temperature?: number;
  maxTokens?: number;
  name?: string;
  apiKey?: string;
};

async function getPromptForTicket(companyId: number | null | undefined, queueId?: number | null): Promise<PromptConfig> {
  if (!companyId) return {};
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
    if (PromptModel && companyId) {
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
  return {};
}

/** -------------- classificação e filtros -------------- */
async function callPlanner(args: any) {
  const anyPlanner: any = Planner as any;
  if (typeof anyPlanner.plan === "function") return anyPlanner.plan(args);
  if (anyPlanner.default && typeof anyPlanner.default.plan === "function") return anyPlanner.default.plan(args);
  const text: string = (args?.text || "").toLowerCase();
  const inv = /(im[óo]vel|apart|casa|terreno|kitnet|estoque|produto|pre[çc]o|dispon[ií]vel)/.test(text);
  return { intent: inv ? "browse_inventory" : "smalltalk", query_ready: inv, slots: {}, followups: inv ? [] : ["Me conta um pouco mais, por favor."] };
}

async function chooseIntegrationByTextCompat(companyId: number | null | undefined, text: string) {
  if (!companyId) return null;
  const all = await InventoryIntegration.findAll({ where: { companyId }, order: [["id", "ASC"]] });
  if (!all.length) return null;
  if (all.length === 1) return all[0];
  const t = (text || "").toLowerCase();
  const scored = all.map((intg: any) => {
    const hint = (intg.categoryHint || "").toLowerCase();
    let score = 0;
    if (hint && t.includes(hint)) score += 2;
    if (/im[óo]veis|imovel|apart|casa|terreno/.test(t) && /im[óo]veis|imovel/.test(hint)) score += 1;
    return { intg, score };
  }).sort((a,b) => b.score - a.score);
  return (scored[0]?.score || 0) > 0 ? scored[0].intg : all[0];
}

type Criteria = {
  cidade?: string; bairro?: string; tipo?: string;
  dormitorios?: number | string; vagas?: number | string;
  precoMin?: number | string; precoMax?: number | string;
  areaMin?: number | string; areaMax?: number | string;
  texto?: string;

  // Campos “financeiros” opcionais (se teu parser já extrair)
  renda?: number | string;
  entrada?: number | string;
  fgts?: boolean;
  idade?: number | string;
  momento?: "agora"|"1-3m"|"3-6m"|"pesquisando";
};

function normalizeCriteria(anyC: any): Criteria {
  if (!anyC) return {};
  const c: Criteria = {};
  c.cidade = anyC.cidade || anyC.city;
  c.bairro = anyC.bairro || anyC.neighborhood;
  c.tipo = anyC.tipo || anyC.tipo_imovel || anyC.type || anyC.typeHint;
  c.dormitorios = anyC.dormitorios || anyC.quartos || anyC.bedrooms;
  c.vagas = anyC.vagas || anyC.garagem || anyC.parking;
  c.precoMin = anyC.precoMin || anyC.preco_min || anyC.priceMin;
  c.precoMax = anyC.precoMax || anyC.preco_max || anyC.priceMax;
  c.areaMin = anyC.areaMin || anyC.area_min || anyC.areaMin;
  c.areaMax = anyC.areaMax || anyC.area_max || anyC.areaMax;
  c.texto = anyC.texto || anyC.text;

  // extras
  c.renda = anyC.renda || anyC.income;
  c.entrada = anyC.entrada || anyC.downPayment;
  c.fgts = anyC.fgts ?? undefined;
  c.idade = anyC.idade || anyC.age;
  c.momento = anyC.momento || anyC.moment;

  return c;
}
function mergeCriteria(a: Criteria, b: Criteria): Criteria {
  return {
    cidade: b.cidade || a.cidade,
    bairro: b.bairro || a.bairro,
    tipo: b.tipo || a.tipo,
    dormitorios: b.dormitorios || a.dormitorios,
    vagas: b.vagas || a.vagas,
    precoMin: b.precoMin || a.precoMin,
    precoMax: b.precoMax || a.precoMax,
    areaMin: b.areaMin || a.areaMin,
    areaMax: b.areaMax || a.areaMax,
    texto: b.texto || a.texto,
    renda: b.renda || a.renda,
    entrada: b.entrada || a.entrada,
    fgts: typeof b.fgts === "boolean" ? b.fgts : a.fgts,
    idade: b.idade || a.idade,
    momento: b.momento || a.momento
  };
}
function enoughForSearch(c: Criteria): boolean {
  const hasLocal = !!(c.bairro || c.cidade);
  const hasSpec = !!(c.tipo || c.dormitorios || c.precoMax || c.precoMin || c.areaMin || c.areaMax);
  return hasLocal && hasSpec;
}
function missingSlot(c: Criteria): string | null {
  if (!c.bairro && !c.cidade) return "local";
  if (!c.tipo && !c.dormitorios) return "tipo_ou_dormitorios";
  if (!c.precoMax && !c.precoMin) return "preco";
  return null;
}

async function callParseCriteria(companyId: number | null | undefined, text: string, slots: Record<string, any>) {
  try {
    const svc = await safeImport("../../InventoryServices/PlannerService");
    if (svc?.parseCriteria) return normalizeCriteria(await svc.parseCriteria(companyId, text, slots));
  } catch {}
  try {
    // usa o parser do NLFilter (versão atual)
    const anyNF: any = NLFilter as any;
    if (typeof anyNF.parseCriteriaFromText === "function") return normalizeCriteria(await anyNF.parseCriteriaFromText(text));
    if (typeof anyNF.parseCriteria === "function") return normalizeCriteria(await anyNF.parseCriteria(text));
    if (typeof anyNF.parse === "function") return normalizeCriteria(await anyNF.parse(text));
  } catch {}
  return normalizeCriteria({ texto: text, ...slots });
}

/** -------------- intenções extras -------------- */
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
  const mHash = text.match(/#\s*(\d{1,2})/);
  if (mHash) return parseInt(mHash[1], 10);
  const m = text.toLowerCase().match(/detalh(?:e|es)\s+(\d{1,2})|ver\s+(\d{1,2})/);
  if (m) return parseInt((m[1] || m[2]), 10);
  return null;
}
function detectCode(text: string): string | null {
  const m = text.toLowerCase().match(/(c[oó]d(?:igo)?|ref(?:er[êe]ncia)?)\s*[:#]?\s*([a-z0-9\-]+)/i);
  return (m && m[2]) ? m[2] : null;
}

// >>> Detectores novos
function detectFinanceIntent(text: string) {
  const t = (text || "").toLowerCase();
  return /(financi|simula|sac|price|fgts|mcmv|parcela|juros)/.test(t);
}
function detectSellerIntent(text: string) {
  const t = (text || "").toLowerCase();
  return /(vender|avaliar|anunciar|colocar à venda|colocar a venda|colocar a venda)/.test(t);
}
// <<< Detectores novos

/** -------------- lead básico -------------- */
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

/** -------------- busca -------------- */
async function callRunSearch(args: any) {
  try {
    if (typeof (RunSearchService as any).default === "function") return await (RunSearchService as any).default(args);
    if (typeof (RunSearchService as any).run === "function") return await (RunSearchService as any).run(args);
  } catch (err) {
    logger.error({ ctx: "callRunSearch", err });
  }
  return { items: [], total: 0, page: 1, pageSize: args?.limit || 5, raw: null };
}

/** -------------- normalização de parâmetros -------------- */
function normalizeArgs(args: any[]) {
  if (args.length === 1 && typeof args[0] === "object") return args[0];
  const [msg, wbot, contact, ticket, companyId, , , , flow, isMenu, whatsapp] = args as any[];
  return { msg, wbot, contact, ticket, companyId, flow, isMenu, whatsapp };
}

/** -------------- resolve companyId robusto -------------- */
async function resolveCompanyId(ticket: any, contact?: any, fallback?: number | null): Promise<number | null> {
  if (ticket?.companyId) return Number(ticket.companyId);
  if (contact?.companyId) return Number(contact.companyId);
  try {
    if (ticket?.id) {
      const t = await Ticket.findByPk(ticket.id);
      if (t?.companyId) return Number(t.companyId);
      if ((t as any)?.whatsappId) {
        const w = await Whatsapp.findByPk((t as any).whatsappId);
        if (w?.companyId) return Number(w.companyId);
      }
      if ((t as any)?.queueId) {
        const q = await Queue.findByPk((t as any).queueId);
        if ((q as any)?.companyId) return Number((q as any).companyId);
      }
    }
  } catch {}
  if (fallback) return Number(fallback);
  try {
    if (ticket?.whatsappId) {
      const w = await Whatsapp.findByPk(ticket.whatsappId);
      if (w?.companyId) return Number(w.companyId);
    }
  } catch {}
  try {
    if (ticket?.queueId) {
      const q = await Queue.findByPk(ticket.queueId);
      if ((q as any)?.companyId) return Number((q as any).companyId);
    }
  } catch {}
  return null;
}

/** -------------- extrator de fatos estruturados -------------- */
async function extractStructuredFacts(text: string, reply: string) {
  try {
    const mod = await safeImport("../../AI/FactExtractors");
    if (mod?.extractStructuredFactsPtBR) return mod.extractStructuredFactsPtBR(text, reply);
  } catch {}
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

/** -------------- OpenAI client cache -------------- */
const sessionsOpenAi: { id?: number; client: OpenAI }[] = [];
const limiter = RateLimiter.forGlobal();

async function getOpenAiClient(companyId: number, overrideKey?: string) {
  const apiKey = overrideKey || process.env.OPENAI_API_KEY;
  if (!apiKey) throw new Error("OPENAI_API_KEY not set");
  if (overrideKey) return new OpenAI({ apiKey });
  let session = sessionsOpenAi.find(s => s.id === companyId);
  if (!session) {
    session = { id: companyId, client: new OpenAI({ apiKey }) };
    sessionsOpenAi.push(session);
  }
  return session.client;
}

/** Mapeia nossos Criteria -> Criteria do NLFilter para ranking consistente */
function toNLFilterCriteria(c: Criteria): NLFilter.Criteria {
  return {
    city: c.cidade || undefined,
    neighborhood: c.bairro || undefined,
    typeHint: c.tipo || undefined,
    bedrooms: c.dormitorios ? Number(String(c.dormitorios).replace(/\D/g, "")) : undefined,
    priceMin: c.precoMin ? Number(String(c.precoMin).replace(/[^\d]/g, "")) : undefined,
    priceMax: c.precoMax ? Number(String(c.precoMax).replace(/[^\d]/g, "")) : undefined,
    areaMin: c.areaMin ? Number(String(c.areaMin).replace(/[^\d]/g, "")) : undefined,
    areaMax: c.areaMax ? Number(String(c.areaMax).replace(/[^\d]/g, "")) : undefined,
  };
}

/** -------------- núcleo -------------- */
async function handleOpenAiCore(params: {
  msg: proto.IWebMessageInfo;
  wbot: any;
  contact: any;
  ticket: any;
  companyId?: number;
  flow?: any;
  isMenu?: boolean;
  whatsapp?: any;
}) {
  const { msg, wbot, contact, ticket } = params;

  try {
    if (contact?.disableBot) return;

    try { await limiter.consume(`ai:${ticket?.companyId ?? "unknown"}`, 1); } catch {}

    const bodyMessage =
      msg && msg.message
        ? ((msg.message.conversation || (msg.message as any).extendedTextMessage?.text) as string)
        : "";
    if (!bodyMessage) return;
    const text = (bodyMessage || "").trim();

    await maybeCaptureLead(text, contact);

    // resolve companyId
    const companyId = await resolveCompanyId(ticket, contact, params.companyId ?? null);
    if (!companyId) {
      logger.error({ ctx: "handleOpenAi", reason: "companyId_unresolved", ticketId: ticket?.id }, "companyId is undefined");
      const last = await loadState(ticket.id).catch(() => null);
      const now = Date.now();
      if (!last?.__lastErrorTs || now - last.__lastErrorTs > 20000) {
        await wbot.sendMessage(msg.key.remoteJid!, { text: "Tive um problema agora há pouco. Pode repetir, por favor?" });
        await saveState(ticket.id, { ...(last || {}), __lastErrorTs: now });
      }
      return;
    }

    // PROMPT dinâmico por segmento + prompt do painel
    const promptCfg = await getPromptForTicket(companyId, ticket.queueId);
    let segment: string = "imoveis";
    try {
      const company = await Company.findByPk(companyId);
      if (company?.segment) segment = String(company.segment);
    } catch {}
    const systemPrompt = await composeSystemPrompt(companyId, promptCfg.prompt);

    const temperature = typeof promptCfg.temperature === "number" ? promptCfg.temperature : 0.4;
    const maxTokens = typeof promptCfg.maxTokens === "number" ? promptCfg.maxTokens : 256;

    const client = await getOpenAiClient(companyId, promptCfg.apiKey);
    const ltm = new LongTermMemory(promptCfg.apiKey || process.env.OPENAI_API_KEY!);
    const model = process.env.OPENAI_MODEL || "gpt-4o-mini";

    const convoState: any = await loadState(ticket.id).catch(() => null);
    const longMem = await ltm.read(companyId, contact?.id);

    const memoryContext = longMem.length
      ? `Memória do cliente: ${longMem.map(m => `${m.key}=${m.value}`).join(", ")}` : "";

    // ===== Extrai e acumula critérios (slots) =====
    const parsedNow = await callParseCriteria(companyId, text, {});
    const lastCriteria: Criteria = convoState?.lastCriteria || {};
    const mergedCriteria = mergeCriteria(lastCriteria, parsedNow);
    await saveState(ticket.id, { ...(convoState || {}), lastCriteria: mergedCriteria });

    // Decide intenção
    let plan = await callPlanner({
      text, memoryContext, lastState: convoState, longMem, companyId
    });

    // Força inventário se já der para buscar
    if (segment === "imoveis" && enoughForSearch(mergedCriteria)) {
      plan = { intent: "browse_inventory", query_ready: true, slots: {}, followups: [] };
    }

    // ===== atalhos: detalhes / paginação se já houve busca =====
    if (segment === "imoveis" && convoState?.lastSearch?.items?.length) {
      const idx = detectDetailsByIndex(text);
      if (idx !== null && idx > 0) {
        const arr = (convoState.lastSearch.pageItems as any[]) || (convoState.lastSearch.items as any[]);
        const item = arr[idx - 1];
        let detailsText = defaultWhatsAppDetails(item);
        try {
          const rmod = await safeImport("../../InventoryServices/Renderers/WhatsAppRenderer");
          if (rmod?.renderPropertyDetails) detailsText = rmod.renderPropertyDetails(item);
        } catch {}
        const sent = await wbot.sendMessage(msg.key.remoteJid!, { text: detailsText });
        try { const { verifyMessage } = await import("./mediaHelpers"); await verifyMessage(sent, ticket, contact); } catch {}
        return;
      }
      const code = detectCode(text);
      if (code) {
        const allItems = (convoState.lastSearch.items as any[]) || [];
        const item = allItems.find(it =>
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
      if (detectShowMore(text)) {
        const chosen = await chooseIntegrationByTextCompat(companyId, text);
        const nextPage = (convoState.lastSearch.page || 1) + 1;
        const pageSize = convoState.lastSearch.pageSize || 10;
        const criteria = convoState.lastSearch.criteria || {};

        const searchRes = await callRunSearch({
          companyId,
          integrationId: chosen?.id || convoState.lastSearch.integrationId,
          criteria,
          page: nextPage,
          limit: pageSize,
          sort: "relevance:desc",
          locale: "pt-BR"
        });

        // HARD-FILTER + RANKING antes de mostrar
        const nlCrit = toNLFilterCriteria(criteria);
        const ranked = NLFilter.filterAndRankItems(searchRes.items || [], nlCrit);
        const pageItems = NLFilter.paginateRanked(ranked, 1, 3);

        let rendered = defaultWhatsAppRenderer(pageItems, 3);
        try {
          const rmod = await safeImport("../../InventoryServices/Renderers/WhatsAppRenderer");
          if (rmod?.renderWhatsAppList)
            rendered = rmod.renderWhatsAppList(pageItems, { maxItems: 3 });
        } catch {}

        if (rendered && process.env.POLISH_WITH_LLM === "true") {
          rendered = await polishWithLLM(client, model, systemPrompt, rendered);
        }

        await saveState(ticket.id, {
          ...(convoState || {}),
          lastSearch: {
            integrationId: chosen?.id || convoState.lastSearch.integrationId,
            criteria,
            page: nextPage,
            pageSize,
            total: searchRes.total || 0,
            items: ranked,       // guarda ordenado
            pageItems            // guarda os 3 mostrados
          }
        });

        const sent = await wbot.sendMessage(msg.key.remoteJid!, { text: rendered });
        try { const { verifyMessage } = await import("./mediaHelpers"); await verifyMessage(sent, ticket, contact); } catch {}
        return;
      }
    }

    // ===== FLUXO DE FINANCIAMENTO (SAC/PRICE + faixa estimada) =====
    if (detectFinanceIntent(text)) {
      const renda = Number(String((mergedCriteria as any).renda || "").replace(/[^\d]/g, "")) || 0;
      const entrada = Number(String((mergedCriteria as any).entrada || "").replace(/[^\d]/g, "")) || 0;
      const fgtsFlag = !!(mergedCriteria as any).fgts;
      const idade = Number(String((mergedCriteria as any).idade || "").replace(/[^\d]/g, "")) || undefined;

      const budget = calcularBudget({
        rendaMensal: renda,
        entrada,
        fgts: fgtsFlag ? 0 : 0, // caso você some FGTS em 'entrada', mantém 0 aqui; ajuste se separar
        idade,
        prazoPreferidoMeses: 420,
        taxaMensal: Number(process.env.DEFAULT_TAXA_MENSAL || 0.010),
        comprometimentoMax: Number(process.env.DEFAULT_COMPROMETIMENTO || 0.30)
      });

      const resumo = WappTmpl.financiamentoResumo(
        budget.faixaImovel.minimo,
        budget.faixaImovel.maximo,
        budget.prazoMeses,
        budget.parcelaMax
      );

      // guarda memória útil
      try {
        await ltm.upsert(companyId, contact.id, [
          { key: "orcamento_min", value: String(budget.faixaImovel.minimo), confidence: 0.9 },
          { key: "orcamento_max", value: String(budget.faixaImovel.maximo), confidence: 0.9 }
        ]);
      } catch {}

      const sent = await wbot.sendMessage(msg.key.remoteJid!, { text: resumo + "\n\n" + WappTmpl.agendamento() });
      try { const { verifyMessage } = await import("./mediaHelpers"); await verifyMessage(sent, ticket, contact); } catch {}

      // Score do lead após resposta de financiamento
      try {
        const sc = scoreLead({
          income: renda || null,
          downPaymentPct: null,
          hasFGTS: fgtsFlag,
          moment: (mergedCriteria as any).momento || null,
          hasObjectiveCriteria: !!((mergedCriteria as any).tipo || (mergedCriteria as any).dormitorios),
          hasClearGeo: !!((mergedCriteria as any).bairro || (mergedCriteria as any).cidade),
          engagementFast: true
        });
        let stage: string | null = null;
        if (sc >= 80) stage = "A"; else if (sc >= 60) stage = "B"; else stage = "C";
        try { await ticket.update({ leadScore: sc, leadStage: stage }); } catch {}
        try { await ltm.upsert(companyId, contact.id, [{ key: "lead_score", value: String(sc), confidence: 0.9 }]); } catch {}
      } catch {}

      // Puxa 2–3 imóveis aderentes à faixa
      try {
        const chosen = await chooseIntegrationByTextCompat(companyId, text);
        if (chosen) {
          const searchRes = await callRunSearch({
            companyId,
            integrationId: chosen.id,
            criteria: { ...mergedCriteria, precoMin: budget.faixaImovel.minimo, precoMax: budget.faixaImovel.maximo },
            page: 1,
            limit: 12,
            sort: "relevance:desc",
            locale: "pt-BR"
          });
          const nlCrit = toNLFilterCriteria({
            ...mergedCriteria,
            precoMin: budget.faixaImovel.minimo,
            precoMax: budget.faixaImovel.maximo
          } as any);
          const ranked = NLFilter.filterAndRankItems(searchRes.items || [], nlCrit);
          const pageItems = ranked.slice(0, 3);
          if (pageItems.length) {
            let rendered = defaultWhatsAppRenderer(pageItems, 3);
            try {
              const rmod = await safeImport("../../InventoryServices/Renderers/WhatsAppRenderer");
              if (rmod?.renderWhatsAppList) rendered = rmod.renderWhatsAppList(pageItems, { maxItems: 3 });
            } catch {}
            await wbot.sendMessage(msg.key.remoteJid!, { text: rendered });
          }
        }
      } catch {}

      return;
    }

    // ===== FLUXO “VENDER IMÓVEL” =====
    if (detectSellerIntent(text)) {
      const reply = [
        "Perfeito! 🙌 Para avaliação ágil, me diga:",
        "• Endereço/bairro do imóvel",
        "• Tipologia (apto/casa) e metragem aproximada",
        "• Estado (novo, reformado, precisa reforma)",
        "Se tiver, me envie *matrícula* e *IPTU* (pode ser foto legível).",
        "",
        "Posso já *agendar uma visita técnica* para avaliação? Tenho quarta 18h ou sábado 10h."
      ].join("\n");
      const sent = await wbot.sendMessage(msg.key.remoteJid!, { text: reply });
      try { const { verifyMessage } = await import("./mediaHelpers"); await verifyMessage(sent, ticket, contact); } catch {}

      // Score mínimo (vendedor costuma receber handoff rápido)
      try {
        const sc = scoreLead({
          income: null,
          downPaymentPct: null,
          hasFGTS: null,
          moment: "1-3m",
          hasObjectiveCriteria: true,
          hasClearGeo: true,
          engagementFast: true
        });
        let stage: string | null = (sc >= 80 ? "A" : sc >= 60 ? "B" : "C");
        try { await ticket.update({ leadScore: sc, leadStage: stage }); } catch {}
        try { await ltm.upsert(companyId, contact.id, [{ key: "lead_score", value: String(sc), confidence: 0.8 }]); } catch {}
      } catch {}

      return;
    }

    // ===== SMALLTALK / Q&A =====
    if (plan.intent !== "browse_inventory") {
      const messages: { role: "system" | "user" | "assistant"; content: string }[] = [];
      messages.push({ role: "system", content: systemPrompt });

      const lgpd = askLGPDOnce(convoState);
      if (lgpd) messages.push({ role: "system", content: `Mensagem obrigatória: ${lgpd}` });

      if (memoryContext) messages.push({ role: "system", content: memoryContext });
      if (convoState?.history?.length) messages.push(...(convoState.history as any[]));

      const chat = await client.chat.completions.create({
        model,
        temperature,
        max_tokens: maxTokens,
        messages: [...messages, { role: "user", content: maskPII(text) }]
      });

      let answer = chat.choices?.[0]?.message?.content?.trim();

      // Pergunta focada (no máx. 2 slots) se necessário
      if (!answer || /qual bairro|qual tipo|está procurando\?/i.test(answer)) {
        const miss = missingSlot(mergedCriteria);
        if (miss === "local") answer = "Perfeito! Me diga a *cidade ou bairro* de preferência 😉";
        else if (miss === "tipo_ou_dormitorios") answer = "Ótimo! Prefere *casa, apartamento ou studio*? E quantos *dormitórios*?";
        else if (miss === "preco") answer = "Tem uma *faixa de preço* em mente? Posso te sugerir ótimas opções dentro do seu orçamento.";
      }

      if (!answer) return;

      if (shouldTransferToHuman(answer)) {
        await wbot.sendMessage(msg.key.remoteJid!, { text: "Vou transferir para um atendente humano para te ajudar melhor. 🙏" });
        return;
      }

      // anti-loop
      const lastQ = convoState?.lastQuestion || "";
      if (answer === lastQ) {
        const miss = missingSlot(mergedCriteria);
        if (miss === "tipo_ou_dormitorios") answer = "Beleza! Quantos *dormitórios* você precisa?";
        else if (miss === "local") answer = "Show! Qual *bairro* (ou cidade) você prefere?";
        else answer = "Me dá só mais um detalhe (bairro/cidade, tipo ou faixa de preço) que eu já te mando as melhores opções. 😉";
      }

      const sent = await wbot.sendMessage(msg.key.remoteJid!, { text: answer });
      try { const { verifyMessage } = await import("./mediaHelpers"); await verifyMessage(sent, ticket, contact); } catch {}

      try {
        const facts = await extractStructuredFacts(text, answer);
        if (facts?.length) await ltm.upsert(companyId, contact?.id, facts);
      } catch {}

      await saveState(ticket.id, {
        ...(convoState || {}),
        lgpdShown: true,
        lastQuestion: answer,
        lastCriteria: mergedCriteria,
        history: [
          ...(convoState?.history || []),
          { role: "user", content: text },
          { role: "assistant", content: answer }
        ].slice(-12)
      } as any);
      return;
    }

    // ===== INVENTÁRIO =====
    const chosen = await chooseIntegrationByTextCompat(companyId, text);
    const criteria = mergedCriteria;

    // Agendamento direto
    if (segment === "imoveis" && detectVisitIntent(text)) {
      await VisitService.requestVisit({
        companyId,
        ticketId: ticket.id,
        contactId: contact.id,
        propertyRef: (convoState?.lastSearch?.items?.[0]?.codigo || null),
        notes: `Lead pediu visita via chat. Msg: "${text}".`
      });

      const reply = "Perfeito! 😊 Me envie *duas janelas de horário* (ex.: “sexta 15h ou sábado 10h”), que eu já valido e agendo pra você.";
      const sent = await wbot.sendMessage(msg.key.remoteJid!, { text: reply });
      try { const { verifyMessage } = await import("./mediaHelpers"); await verifyMessage(sent, ticket, contact); } catch {}

      // Score rápido após intenção clara de visita
      try {
        const sc = scoreLead({
          income: Number(String((criteria as any).renda || "").replace(/[^\d]/g, "")) || null,
          downPaymentPct: null,
          hasFGTS: !!(criteria as any).fgts,
          moment: "agora",
          hasObjectiveCriteria: !!(criteria as any).tipo || !!(criteria as any).dormitorios,
          hasClearGeo: !!(criteria as any).bairro || !!(criteria as any).cidade,
          engagementFast: true
        });
        let stage: string | null = (sc >= 80 ? "A" : sc >= 60 ? "B" : "C");
        try { await ticket.update({ leadScore: sc, leadStage: stage }); } catch {}
        try { await ltm.upsert(companyId, contact.id, [{ key: "lead_score", value: String(sc), confidence: 0.9 }]); } catch {}
      } catch {}

      return;
    }

    const searchRes = await callRunSearch({
      companyId,
      integrationId: chosen?.id,
      criteria,
      page: 1,
      limit: 20,
      sort: "relevance:desc",
      locale: "pt-BR"
    });

    // HARD-FILTER + RANKING + paginação (mostra 3)
    const nlCrit = toNLFilterCriteria(criteria);
    const ranked = NLFilter.filterAndRankItems(searchRes.items || [], nlCrit);
    const pageItems = NLFilter.paginateRanked(ranked, 1, 3);

    await saveState(ticket.id, {
      ...(convoState || {}),
      lastCriteria: criteria,
      lastSearch: {
        integrationId: chosen?.id || null,
        criteria,
        page: 1,
        pageSize: 10,
        total: searchRes.total || ranked.length || 0,
        items: ranked,
        pageItems
      }
    });

    let renderedText: string | undefined;
    if (segment === "imoveis") {
      try {
        const rmod = await safeImport("../../InventoryServices/Renderers/WhatsAppRenderer");
        const renderFn =
          rmod?.renderWhatsAppList ||
          ((items: any[]) => defaultWhatsAppRenderer(items, 3));
        renderedText = renderFn(pageItems, {
          headerTitle: "🌟 Opções selecionadas",
          categoryHint: "imóveis",
          maxItems: 3,
          showIndexEmojis: true
        });
      } catch {
        renderedText = defaultWhatsAppRenderer(pageItems, 3);
      }
    }

    if (!renderedText) {
      if ((InventoryFormatter as any).formatInventoryReplyWithPrompt && systemPrompt) {
        renderedText = (InventoryFormatter as any).formatInventoryReplyWithPrompt(
          { items: pageItems, total: searchRes.total || ranked.length || 0, criteria }, systemPrompt);
      } else if ((InventoryFormatter as any).formatInventoryReply) {
        renderedText = (InventoryFormatter as any).formatInventoryReply(
          { items: pageItems, total: searchRes.total || ranked.length || 0, criteria });
      } else {
        renderedText = JSON.stringify({ items: pageItems, total: searchRes.total || ranked.length || 0 }, null, 2);
      }
    }

    if (renderedText && process.env.POLISH_WITH_LLM === "true") {
      renderedText = await polishWithLLM(client, model, systemPrompt, renderedText);
    }

    const sent = await wbot.sendMessage(msg.key.remoteJid!, {
      text: renderedText || "Não encontrei opções ideais ainda. Me dê mais detalhes?"
    });
    try { const { verifyMessage } = await import("./mediaHelpers"); await verifyMessage(sent, ticket, contact); } catch {}

    try {
      const facts = await extractStructuredFacts(text, renderedText || "");
      if (facts?.length) await ltm.upsert(companyId, contact?.id, facts);
    } catch {}

    // >>> Score do lead após mostra de opções
    try {
      const sc = scoreLead({
        income: Number(String((criteria as any).renda || "").replace(/[^\d]/g, "")) || null,
        downPaymentPct: null,
        hasFGTS: !!(criteria as any).fgts,
        moment: (criteria as any).momento || null,
        hasObjectiveCriteria: !!(criteria as any).tipo || !!(criteria as any).dormitorios,
        hasClearGeo: !!(criteria as any).bairro || !!(criteria as any).cidade,
        engagementFast: true
      });
      let stage: string | null = (sc >= 80 ? "A" : sc >= 60 ? "B" : "C");
      try { await ticket.update({ leadScore: sc, leadStage: stage }); } catch {}
      try { await ltm.upsert(companyId, contact.id, [{ key: "lead_score", value: String(sc), confidence: 0.9 }]); } catch {}
    } catch {}
    // <<< Score

    const newState: any = await loadState(ticket.id).catch(() => (convoState || {}));
    await saveState(ticket.id, {
      ...(newState || {}),
      lastQuestion: null,
      history: [
        ...((newState?.history as any[]) || []),
        { role: "user", content: text },
        { role: "assistant", content: renderedText! }
      ].slice(-12)
    } as any);
    return;
  } catch (err: any) {
    logger.error({ ctx: "handleOpenAi", err: err?.message || err });
    try {
      const last = await loadState(params.ticket.id).catch(() => null);
      const now = Date.now();
      if (!last?.__lastErrorTs || now - last.__lastErrorTs > 20000) {
        const sent = await params.wbot.sendMessage(params.msg.key.remoteJid!, {
          text: "Tive um problema agora há pouco. Pode repetir, por favor?"
        });
        try { const { verifyMessage } = await import("./mediaHelpers"); await verifyMessage(sent, params.ticket, params.contact); } catch {}
        await saveState(params.ticket.id, { ...(last || {}), __lastErrorTs: now });
      }
    } catch {}
  }
}

/** exports */
export const handleOpenAi = async (...args: any[]) => {
  const params = normalizeArgs(args);
  if (!params?.ticket) throw new Error("handleOpenAi: ticket indefinido na chamada");
  return handleOpenAiCore(params);
};

export default handleOpenAi;
