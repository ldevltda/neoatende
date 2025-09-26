// backend/src/services/WbotServices/listeners/handleOpenAi.ts
import OpenAI from "openai";
import * as Planner from "../../AI/Planner";
import { loadState, saveState } from "../../InventoryServices/ConversationState";
import * as InventoryFormatter from "../../InventoryServices/InventoryFormatter";
import * as RunSearchService from "../../InventoryServices/RunSearchService";
import * as NLFilter from "../../InventoryServices/NLFilter";
import InventoryIntegration from "../../../models/InventoryIntegration";
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

// === NOVOS IMPORTS (financiamento + templates + score) ===
import { calcularBudget } from "../../Finance/FinancingCalculator";
import { T as WappTmpl } from "../../Agents/templates/whatsappTemplates";
import { scoreLead } from "../../Leads/scoreLead";

import { scheduleLeadFollowups, cancelLeadFollowups } from "../../FollowUpService/LeadFollowupQueue";
// (removido) import { shouldHandoff } from "../../OpenAiService/handoffRules";

// ---------------------------------------------------------
/** utils: dynamic import com fallback require */
async function safeImport(modulePath: string): Promise<any | null> {
  try {
    // @ts-ignore
    const dynImport = (Function("p", "return import(p)")) as (p: string) => Promise<any>;
    return await dynImport(modulePath);
  } catch {
    try { return require(modulePath); } catch { return null; }
  }
}

/** Prompt dinâmico (persona + guardrails) */
async function composeSystemPrompt(companyId: number, userPromptFromDB?: string) {
  try {
    const mod = await safeImport("../../Prompt/composeSystemPrompt");
    if (mod?.composeSystemPrompt) return await mod.composeSystemPrompt({ companyId, userPromptFromDB });
  } catch {}
  const company = await Company.findByPk(companyId);
  const nomeEmpresa = company?.name || "sua empresa";
  const base = (userPromptFromDB || "").trim() || `Você é consultor(a) humano(a) da ${nomeEmpresa}.`;
  const guardrails =
    `Tom: claro, caloroso, direto, sem jargões. 1ª pessoa. Máx. 2 perguntas por mensagem.
- Não invente preço, número de vagas ou prazos. Se não souber, pergunte.
- Não prometa “vou buscar e retorno”; sempre peça o próximo passo no chat.
- Nunca prometa aprovação de crédito.
- Se sair do escopo jurídico/contábil, explique limites e direcione.`;
  return [base, guardrails].join("\n\n");
}

/** Render WhatsApp (fallback) */
function defaultWhatsAppRenderer(items: any[], maxItems = 3): string {
  if (!Array.isArray(items) || items.length === 0) {
    return "Não encontrei opções com esses critérios agora. Quer ajustar *bairro/cidade* e *tipo ou nº de dormitórios* pra eu te mostrar alternativas?";
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

  return `🌟 *Opções selecionadas pra você*\n\n${take.join("\n\n")}\n\n👉 Quer ver por dentro? Agendo sua visita agora.`;
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

/** Polimento opcional */
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
            "\nReescreva sem inventar dados. Remova frases como 'vou buscar e retorno'."
        },
        {
          role: "user",
          content:
            `Reescreva levemente mantendo *todos os números/links* iguais. Finalize com CTA curto.\n\n===\n${text}\n===`
        }
      ]
    });
    const out = pol.choices?.[0]?.message?.content?.trim();
    return out || text;
  } catch {
    return text;
  }
}

/** Prompt Lookup */
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

/** Planner compat */
async function callPlanner(args: any) {
  const anyPlanner: any = Planner as any;
  if (typeof anyPlanner.plan === "function") return anyPlanner.plan(args);
  if (anyPlanner.default && typeof anyPlanner.default.plan === "function") return anyPlanner.default.plan(args);
  const text: string = (args?.text || "").toLowerCase();
  const inv = /(im[óo]vel|apart|casa|terreno|kitnet|estoque|produto|pre[çc]o|dispon[ií]vel)/.test(text);
  return { intent: inv ? "browse_inventory" : "smalltalk", query_ready: inv, slots: {}, followups: inv ? [] : ["Me conta um pouco mais, por favor."] };
}

/** Escolha de integração */
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

/** Criteria */
type Criteria = {
  cidade?: string; bairro?: string; tipo?: string;
  dormitorios?: number | string; vagas?: number | string;
  precoMin?: number | string; precoMax?: number | string;
  areaMin?: number | string; areaMax?: number | string;
  texto?: string;
  // financeiros (opcionais)
  renda?: number | string; entrada?: number | string; fgts?: boolean; idade?: number | string;
  momento?: "agora"|"1-3m"|"3-6m"|"pesquisando";
};

/** extração básica sem depender do teu parser (melhora recall) */
function crudeExtract(text: string) {
  const t = (text || "").toLowerCase();
  const slots: any = {};
  const mDorm = t.match(/(\d+)\s*(dorm|quartos?)/);
  if (mDorm) slots.dormitorios = Number(mDorm[1]);
  const mBairro = t.match(/\b(campinas|kobrasol|estreito|trindade|capoeiras|itacorubi)\b/i);
  if (mBairro) slots.bairro = mBairro[1];
  const mCidade = t.match(/\b(flori(an[óo]polis|opolis)|s[aã]o jos[eé])\b/i);
  if (mCidade) slots.cidade = /flori/.test(mCidade[0].toLowerCase()) ? "Florianópolis" : "São José";
  if (/apart|ap[eê]|apto/.test(t)) slots.tipo = "apartamento";
  if (/casa/.test(t)) slots.tipo = "casa";
  const mPrecoMax = t.match(/at[ée]\s*R?\$?\s*([\d\.\,]+)/i);
  if (mPrecoMax) slots.precoMax = mPrecoMax[1];
  const mRenda = t.match(/renda\s*(de|~|aprox\.?|:)?\s*R?\$?\s*([\d\.\,]+)/i);
  if (mRenda) slots.renda = mRenda[2];
  const mEntrada = t.match(/entrada\s*(de|~|aprox\.?|:)?\s*R?\$?\s*([\d\.\,]+)/i);
  if (mEntrada) slots.entrada = mEntrada[2];
  if (/\bfgts\b/i.test(text)) slots.fgts = true;
  return slots;
}

function normalizeCriteria(anyC: any): Criteria {
  const crude = crudeExtract(anyC?.texto || "");
  const cIn = { ...(anyC || {}), ...crude };

  const c: Criteria = {};
  c.cidade = cIn.cidade || cIn.city;
  c.bairro = cIn.bairro || cIn.neighborhood;
  c.tipo = cIn.tipo || cIn.tipo_imovel || cIn.type || cIn.typeHint;
  c.dormitorios = cIn.dormitorios || cIn.quartos || cIn.bedrooms;
  c.vagas = cIn.vagas || cIn.garagem || cIn.parking;
  c.precoMin = cIn.precoMin || cIn.preco_min || cIn.priceMin;
  c.precoMax = cIn.precoMax || cIn.preco_max || cIn.priceMax;
  c.areaMin = cIn.areaMin || cIn.area_min || cIn.areaMin;
  c.areaMax = cIn.areaMax || cIn.area_max || cIn.areaMax;
  c.texto = cIn.texto || cIn.text;

  c.renda = cIn.renda || cIn.income;
  c.entrada = cIn.entrada || cIn.downPayment;
  c.fgts = cIn.fgts ?? undefined;
  c.idade = cIn.idade || cIn.age;
  c.momento = cIn.momento || cIn.moment;

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
function missingSlot(c: Criteria): "local" | "tipo_ou_dormitorios" | "preco" | null {
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
    const anyNF: any = NLFilter as any;
    if (typeof anyNF.parseCriteriaFromText === "function") return normalizeCriteria(await anyNF.parseCriteriaFromText(text));
    if (typeof anyNF.parseCriteria === "function") return normalizeCriteria(await anyNF.parseCriteria(text));
    if (typeof anyNF.parse === "function") return normalizeCriteria(await anyNF.parse(text));
  } catch {}
  return normalizeCriteria({ texto: text, ...slots });
}

/** intenções auxiliares */
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
function detectFinanceIntent(text: string) {
  const t = (text || "").toLowerCase();
  return /(financi|simula|sac|price|fgts|mcmv|parcela|juros)/.test(t);
}
function detectSellerIntent(text: string) {
  const t = (text || "").toLowerCase();
  return /(vender|avaliar|anunciar|colocar à venda|colocar a venda)/.test(t);
}

/** captura email/telefone */
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

/** run search */
async function callRunSearch(args: any) {
  try {
    if (typeof (RunSearchService as any).default === "function") return await (RunSearchService as any).default(args);
    if (typeof (RunSearchService as any).run === "function") return await (RunSearchService as any).run(args);
  } catch (err) {
    logger.error({ ctx: "callRunSearch", err });
  }
  return { items: [], total: 0, page: 1, pageSize: args?.limit || 5, raw: null };
}

/** normalização dos args */
function normalizeArgs(args: any[]) {
  if (args.length === 1 && typeof args[0] === "object") return args[0];
  const [msg, wbot, contact, ticket, companyId, , , , flow, isMenu, whatsapp] = args as any[];
  return { msg, wbot, contact, ticket, companyId, flow, isMenu, whatsapp };
}

/** companyId resolver robusto */
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

/** fatos estruturados simples */
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
  const dorm = text.match(/(\d+)\s*(dormit[óo]rios?|quartos?)/i);
  if (dorm) facts.push({ key: "dormitorios", value: dorm[1] });
  const bairro = text.match(/\b(campinas|kobrasol|estreito|trindade|capoeiras|itacorubi)\b/i);
  if (bairro) facts.push({ key: "bairro", value: bairro[1] });
  const precoMax = text.match(/at[ée]\s*R?\$?\s*([\d\.\,]+)/i);
  if (precoMax) facts.push({ key: "precoMax", value: precoMax[1] });
  return facts;
}

/** OpenAI client cache */
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

/** NLFilter criteria mapper */
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

/** helpers de mapeamento para scoreLead (evita TS 2353) */
function mapMomentoToMeses(m?: Criteria["momento"] | null): number | undefined {
  if (!m) return undefined;
  if (m === "agora") return 0;
  if (m === "1-3m") return 3;
  if (m === "3-6m") return 6;
  return 999; // pesquisando
}
function truthy(v: any): boolean { return !!v; }

/** CORE */
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

    // 🔔 qualquer resposta do cliente cancela follow-ups pendentes
    try { await cancelLeadFollowups(ticket); } catch {}

    await maybeCaptureLead(text, contact);

    // company
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

    // prompt & client
    const promptCfg = await getPromptForTicket(companyId, ticket.queueId);
    let segment: string = "imoveis";
    try { const company = await Company.findByPk(companyId); if (company?.segment) segment = String(company.segment); } catch {}
    const systemPrompt = await composeSystemPrompt(companyId, promptCfg.prompt);

    const temperature = typeof promptCfg.temperature === "number" ? promptCfg.temperature : 0.4;
    const maxTokens = typeof promptCfg.maxTokens === "number" ? promptCfg.maxTokens : 256;

    const client = await getOpenAiClient(companyId, promptCfg.apiKey);
    const ltm = new LongTermMemory(promptCfg.apiKey || process.env.OPENAI_API_KEY!);
    const model = process.env.OPENAI_MODEL || "gpt-4o-mini";

    const convoState: any = await loadState(ticket.id).catch(() => null);
    const longMem = await ltm.read(companyId, contact?.id);

    const memoryContext = longMem.length ? `Memória do cliente: ${longMem.map(m => `${m.key}=${m.value}`).join(", ")}` : "";

    // slots
    const parsedNow = await callParseCriteria(companyId, text, {});
    const lastCriteria: Criteria = convoState?.lastCriteria || {};
    const mergedCriteria = mergeCriteria(lastCriteria, parsedNow);
    await saveState(ticket.id, { ...(convoState || {}), lastCriteria: mergedCriteria });

    // intenção
    let plan = await callPlanner({ text, memoryContext, lastState: convoState, longMem, companyId });

    // força inventário quando der pra buscar
    if (segment === "imoveis" && enoughForSearch(mergedCriteria)) {
      plan = { intent: "browse_inventory", query_ready: true, slots: {}, followups: [] };
    }

    // atalhos (detalhes/paginação)
    if (segment === "imoveis" && convoState?.lastSearch?.items?.length) {
      const idx = detectDetailsByIndex(text);
      if (idx !== null && idx > 0) {
        const arr = (convoState.lastSearch.pageItems as any[]) || (convoState.lastSearch.items as any[]);
        const item = arr[idx - 1];
        let detailsText = defaultWhatsAppDetails(item);
        try { const rmod = await safeImport("../../InventoryServices/Renderers/WhatsAppRenderer");
          if (rmod?.renderPropertyDetails) detailsText = rmod.renderPropertyDetails(item); } catch {}
        const sent = await wbot.sendMessage(msg.key.remoteJid!, { text: detailsText });
        try { const { verifyMessage } = await import("./mediaHelpers"); await verifyMessage(sent, ticket, contact); } catch {}
        return;
      }
      const code = detectCode(text);
      if (code) {
        const allItems = (convoState.lastSearch.items as any[]) || [];
        const item = allItems.find(it => String(it.codigo || it.code || it.slug || it.id).toLowerCase() === code.toLowerCase());
        if (item) {
          let detailsText = defaultWhatsAppDetails(item);
          try { const rmod = await safeImport("../../InventoryServices/Renderers/WhatsAppRenderer");
            if (rmod?.renderPropertyDetails) detailsText = rmod.renderPropertyDetails(item); } catch {}
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

        const nlCrit = toNLFilterCriteria(criteria);
        const ranked = NLFilter.filterAndRankItems(searchRes.items || [], nlCrit);
        const pageItems = NLFilter.paginateRanked(ranked, 1, 3);

        let rendered = defaultWhatsAppRenderer(pageItems, 3);
        try { const rmod = await safeImport("../../InventoryServices/Renderers/WhatsAppRenderer");
          if (rmod?.renderWhatsAppList) rendered = rmod.renderWhatsAppList(pageItems, { maxItems: 3 }); } catch {}

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
            items: ranked,
            pageItems
          }
        });

        const sent = await wbot.sendMessage(msg.key.remoteJid!, { text: rendered });
        try { const { verifyMessage } = await import("./mediaHelpers"); await verifyMessage(sent, ticket, contact); } catch {}
        return;
      }
    }

    // ===== FINANCIAMENTO =====
    if (detectFinanceIntent(text)) {
      const rendaNum = Number(String((mergedCriteria as any).renda || "").replace(/[^\d]/g, "")) || 0;
      const entradaNum = Number(String((mergedCriteria as any).entrada || "").replace(/[^\d]/g, "")) || 0;
      const hasFGTS = !!(mergedCriteria as any).fgts;
      const idadeNum = Number(String((mergedCriteria as any).idade || "").replace(/[^\d]/g, "")) || undefined;

      // se não tem renda -> pedir renda + entrada/FGTS (máx 2 perguntas)
      if (!rendaNum) {
        const ask = `Pra simular com precisão: qual é a *renda familiar mensal* (aprox.)? ` +
          `Você tem *entrada* (valor) ou vai usar *FGTS*?`;
        const sent = await wbot.sendMessage(msg.key.remoteJid!, { text: ask });
        try { const { verifyMessage } = await import("./mediaHelpers"); await verifyMessage(sent, ticket, contact); } catch {}
        return;
      }

      const budget = calcularBudget({
        rendaMensal: rendaNum,
        entrada: entradaNum,
        fgts: 0, // se você somar FGTS à entrada, mantenha 0 aqui
        idade: idadeNum,
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

      try {
        await ltm.upsert(companyId, contact.id, [
          { key: "orcamento_min", value: String(budget.faixaImovel.minimo), confidence: 0.9 },
          { key: "orcamento_max", value: String(budget.faixaImovel.maximo), confidence: 0.9 }
        ]);
      } catch {}

      const sent = await wbot.sendMessage(msg.key.remoteJid!, { text: resumo + "\n\n" + WappTmpl.agendamento() });
      try { const { verifyMessage } = await import("./mediaHelpers"); await verifyMessage(sent, ticket, contact); } catch {}

      // ✅ score do lead (mapeando corretamente para LeadInputs)
      try {
        const { score: sc, stage } = scoreLead({
          rendaFamiliar: rendaNum,
          entradaPercent: entradaNum > 0 ? Math.round((entradaNum / Math.max(budget.faixaImovel.maximo, 1)) * 100) : undefined,
          temFGTS: hasFGTS,
          momentoMeses: mapMomentoToMeses((mergedCriteria as any).momento || null),
          criteriosClaros: truthy((mergedCriteria as any).tipo || (mergedCriteria as any).dormitorios),
          localDefinido: truthy((mergedCriteria as any).bairro || (mergedCriteria as any).cidade),
          engajamentoRapido: true
        });
        try { await ticket.update({ leadScore: sc, leadStage: stage } as any); } catch {}
        try { await ltm.upsert(companyId, contact.id, [{ key: "lead_score", value: String(sc), confidence: 0.9 }]); } catch {}
      } catch {}

      // se já temos local/tipo, buscar 2–3 opções na faixa
      try {
        if (enoughForSearch(mergedCriteria)) {
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
              try { const rmod = await safeImport("../../InventoryServices/Renderers/WhatsAppRenderer");
                if (rmod?.renderWhatsAppList) rendered = rmod.renderWhatsAppList(pageItems, { maxItems: 3 }); } catch {}
              await wbot.sendMessage(msg.key.remoteJid!, { text: rendered });
              // agenda follow-ups porque houve proposta real
              try { await scheduleLeadFollowups(ticket); } catch {}
            }
          }
        } else {
          // Senão, pedir local + tipo em 1 mensagem
          await wbot.sendMessage(msg.key.remoteJid!, {
            text: "Show! Agora me diz *bairro/cidade* e *casa/apto + nº de dormitórios* pra eu te mostrar 2–3 opções nessa faixa 😉"
          });
        }
      } catch {}

      return;
    }

    // ===== VENDER =====
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

      // ✅ score A/B/C coerente com venda (sem renda obrigatória)
      try {
        const { score: sc, stage } = scoreLead({
          criteriosClaros: true,
          localDefinido: true,
          momentoMeses: 3,
          engajamentoRapido: true
        });
        try { await ticket.update({ leadScore: sc, leadStage: stage } as any); } catch {}
        try { await ltm.upsert(companyId, contact.id, [{ key: "lead_score", value: String(sc), confidence: 0.8 }]); } catch {}
      } catch {}
      return;
    }

    // ===== SMALLTALK / Q&A =====
    if (plan.intent !== "browse_inventory") {
      // TIPAGEM CORRETA para corrigir TS2769
      const messages: OpenAI.Chat.Completions.ChatCompletionMessageParam[] = [];
      messages.push({ role: "system", content: systemPrompt });

      const lgpd = askLGPDOnce(convoState);
      if (lgpd) messages.push({ role: "system", content: `Mensagem obrigatória: ${lgpd}` });

      if (memoryContext) messages.push({ role: "system", content: memoryContext });
      if (convoState?.history?.length) {
        for (const h of (convoState.history as any[])) {
          const r = (h?.role === "user" || h?.role === "assistant" || h?.role === "system") ? h.role : "user";
          messages.push({ role: r as any, content: String(h?.content || "") });
        }
      }

      const chat = await client.chat.completions.create({
        model,
        temperature,
        max_tokens: maxTokens,
        messages: [...messages, { role: "user", content: maskPII(text) }]
      });

      let answer = chat.choices?.[0]?.message?.content?.trim() || "";

      // Guardrail: não permitir "vou buscar e retorno"
      answer = answer.replace(/(vou|irei)\s+(procurar|buscar).{0,40}(retorn|voltar|te aviso)[^.!\n]*[.!]?/gi, "")
                     .replace(/\n{3,}/g, "\n\n")
                     .trim();

      // Pergunta focada (no máx. 2 slots)
      const miss = missingSlot(mergedCriteria);
      if (miss === "local") {
        answer = "Perfeito! Me diga a *cidade ou bairro* de preferência 😉";
      } else if (miss === "tipo_ou_dormitorios") {
        answer = "Ótimo! Prefere *casa, apartamento ou studio*? E quantos *dormitórios*?";
      } else if (!answer) {
        answer = "Me dá só mais um detalhe (bairro/cidade, tipo ou nº de dormitórios) e eu já te mostro 2–3 opções.";
      }

      if (shouldTransferToHuman(answer)) {
        await wbot.sendMessage(msg.key.remoteJid!, { text: "Vou te passar com um especialista pra agilizar, combinado? 🙏" });
        return;
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

    // se o usuário pediu visita direto
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

      // ✅ score rápido
      try {
        const { score: sc, stage } = scoreLead({
          rendaFamiliar: Number(String((criteria as any).renda || "").replace(/[^\d]/g, "")) || undefined,
          entradaPercent: undefined,
          temFGTS: !!(criteria as any).fgts,
          momentoMeses: 0, // pediu visita agora
          criteriosClaros: truthy((criteria as any).tipo || (criteria as any).dormitorios),
          localDefinido: truthy((criteria as any).bairro || (criteria as any).cidade),
          engajamentoRapido: true
        });
        try { await ticket.update({ leadScore: sc, leadStage: stage } as any); } catch {}
        try { await ltm.upsert(companyId, contact.id, [{ key: "lead_score", value: String(sc), confidence: 0.9 }]); } catch {}
      } catch {}
      return;
    }

    // se ainda não tem slots mínimos, pergunte e NÃO finja buscar
    if (!enoughForSearch(criteria)) {
      const miss = missingSlot(criteria);
      const ask =
        miss === "local" ? "Pra te mandar opções certeiras: qual *bairro ou cidade* prefere? 🙂"
        : miss === "tipo_ou_dormitorios" ? "Prefere *casa ou apartamento*? E quantos *dormitórios*?"
        : "Tem uma *faixa de preço* em mente? (posso ajustar por renda/entrada também)";
      const sent = await wbot.sendMessage(msg.key.remoteJid!, { text: ask });
      try { const { verifyMessage } = await import("./mediaHelpers"); await verifyMessage(sent, ticket, contact); } catch {}
      return;
    }

    // buscar
    const searchRes = await callRunSearch({
      companyId,
      integrationId: chosen?.id,
      criteria,
      page: 1,
      limit: 20,
      sort: "relevance:desc",
      locale: "pt-BR"
    });

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
    try {
      const rmod = await safeImport("../../InventoryServices/Renderers/WhatsAppRenderer");
      const renderFn = rmod?.renderWhatsAppList || ((items: any[]) => defaultWhatsAppRenderer(items, 3));
      renderedText = renderFn(pageItems, { headerTitle: "🌟 Opções selecionadas", categoryHint: "imóveis", maxItems: 3, showIndexEmojis: true });
    } catch {
      renderedText = defaultWhatsAppRenderer(pageItems, 3);
    }

    if (renderedText && process.env.POLISH_WITH_LLM === "true") {
      renderedText = await polishWithLLM(client, model, systemPrompt, renderedText);
    }

    const sent = await wbot.sendMessage(msg.key.remoteJid!, {
      text: renderedText || "Não encontrei opções ideais ainda. Me dá mais detalhes?"
    });
    try { const { verifyMessage } = await import("./mediaHelpers"); await verifyMessage(sent, ticket, contact); } catch {}

    try {
      const facts = await extractStructuredFacts(text, renderedText || "");
      if (facts?.length) await ltm.upsert(companyId, contact?.id, facts);
    } catch {}

    // ✅ score após lista
    try {
      const { score: sc, stage } = scoreLead({
        rendaFamiliar: Number(String((criteria as any).renda || "").replace(/[^\d]/g, "")) || undefined,
        entradaPercent: undefined,
        temFGTS: !!(criteria as any).fgts,
        momentoMeses: mapMomentoToMeses((criteria as any).momento || null),
        criteriosClaros: truthy((criteria as any).tipo || (criteria as any).dormitorios),
        localDefinido: truthy((criteria as any).bairro || (criteria as any).cidade),
        engajamentoRapido: true
      });
      try { await ticket.update({ leadScore: sc, leadStage: stage } as any); } catch {}
      try { await ltm.upsert(companyId, contact.id, [{ key: "lead_score", value: String(sc), confidence: 0.9 }]); } catch {}
    } catch {}

    // agenda follow-ups porque houve proposta/lista real
    try { await scheduleLeadFollowups(ticket); } catch {}

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

/** export */
export const handleOpenAi = async (...args: any[]) => {
  const params = normalizeArgs(args);
  if (!params?.ticket) throw new Error("handleOpenAi: ticket indefinido na chamada");
  return handleOpenAiCore(params);
};

export default handleOpenAi;
