import { Request, Response } from "express";
import { logger } from "../utils/logger";
import { Op } from "sequelize";

import Whatsapp from "../models/Whatsapp";
import Company from "../models/Company";
import Contact from "../models/Contact";
import Ticket from "../models/Ticket";
import Prompt from "../models/Prompt";

import CreateOrUpdateContactService from "../services/ContactServices/CreateOrUpdateContactService";
import FindOrCreateTicketService from "../services/TicketServices/FindOrCreateTicketService";
import SendWhatsAppMessage from "../services/WbotServices/SendWhatsAppMessage";
import ShowWhatsAppService from "../services/WhatsappService/ShowWhatsAppService";
import { createOpenAIClient } from "../libs/openaiClient";

const WEBHOOK_KEY = process.env.WEBHOOK_KEY || "Neoatende@2025$$$";

// ---------- utils de log/redação ----------
const SENSITIVE_HEADERS = ["authorization", "key", "x-api-key", "cookie", "set-cookie"];
const DIGITS = /\D+/g;

function redact(v: any) {
  if (v == null) return v;
  const s = String(v);
  if (s.length <= 6) return "***";
  return `${s.slice(0, 3)}***${s.slice(-2)}`;
}
function sanitizeHeaders(h: Record<string, any> | undefined) {
  const out: Record<string, any> = {};
  for (const [k, v] of Object.entries(h || {})) {
    if (SENSITIVE_HEADERS.includes(k.toLowerCase())) {
      out[k] = Array.isArray(v) ? v.map(redact) : redact(v);
    } else out[k] = v;
  }
  return out;
}
function shrink(obj: any, max = 12000) {
  try {
    const s = JSON.stringify(obj);
    if (s.length <= max) return obj;
    return { _truncated: true, length: s.length, preview: s.slice(0, max) };
  } catch {
    return obj;
  }
}

function normalizeBRPhone(raw?: string | null): string | null {
  if (!raw) return null;
  const d = String(raw).replace(DIGITS, "");
  if (!d) return null;
  if (d.startsWith("55")) return d;
  if (d.length === 10 || d.length === 11) return "55" + d;
  return d;
}
function onlyDigits(v?: string | null): string {
  return (v || "").replace(DIGITS, "");
}
function valToString(v: any): string {
  if (v == null) return "";
  if (Array.isArray(v)) return valToString(v[0]);
  let s = String(v).trim();
  // remove aspas duplas extras que vêm escapadas do GHL
  if ((s.startsWith('"') && s.endsWith('"')) || (s.startsWith("'") && s.endsWith("'"))) {
    s = s.slice(1, -1).trim();
  }
  return s;
}
function pick(...vals: any[]): string | undefined {
  for (const v of vals) {
    const s = valToString(v);
    if (s) return s;
  }
  return undefined;
}

// ---------- tipos ----------
type NormalizedLead = {
  sender: string;            // conexão (Whatsapp.name)
  phone: string;             // E164 BR (55 + dígitos)
  full_name?: string;
  email?: string;
  income?: string;
  when?: string;
  down_payment?: string;
  project?: string;
  description?: string;
};

// ---------- core compartilhado ----------
async function processLeadNormalized(
  norm: NormalizedLead,
  ctx: { t0: bigint; requestId: string; req: Request; res: Response }
): Promise<Response> {
  const { t0, requestId, res } = ctx;

  // 1) achar conexão por sender (aceita com e sem 55)
  const rawSenderDigits = onlyDigits(norm.sender);
  const senderCandidates = rawSenderDigits.startsWith("55")
    ? [rawSenderDigits, rawSenderDigits.slice(2)]
    : [rawSenderDigits, "55" + rawSenderDigits];

  const whatsapp = await Whatsapp.findOne({
    where: { name: { [Op.in]: senderCandidates } }
  });

  if (!whatsapp) {
    const durationMs = Number((process.hrtime.bigint() - t0) / BigInt(1e6));
    logger.warn({
      ctx: "LeadWebhook",
      phase: "end",
      requestId,
      status: 404,
      reason: "sender_not_found",
      senderTried: senderCandidates
    });
    return res.status(404).json({ ok: false, error: "sender_not_found" });
  }

  const companyId = whatsapp.companyId;
  const whatsappId = whatsapp.id;

  // 2) já existe ticket para esse número?
  const existing = await Ticket.findOne({
    where: { companyId },
    include: [{ model: Contact, where: { number: norm.phone } }]
  });

  if (existing) {
    const durationMs = Number((process.hrtime.bigint() - t0) / BigInt(1e6));
    logger.info({
      ctx: "LeadWebhook",
      phase: "end",
      requestId,
      status: 200,
      action: "skipped_existing_ticket",
      ticketId: existing.id,
      phone: norm.phone,
      durationMs
    });
    return res.status(200).json({
      ok: true,
      skipped_existing_ticket: true,
      ticketId: existing.id
    });
  }

  // 3) criar/atualizar contato
  const contact = await CreateOrUpdateContactService({
    name: norm.full_name || "Novo contato",
    number: norm.phone,
    isGroup: false,
    email: norm.email || "",
    companyId,
    whatsappId
  });

  // 4) criar ticket
  const ticket = await FindOrCreateTicketService(contact, whatsappId, 0, companyId);

  // 5) IA – usa Prompt da conexão, se houver
  const wppFull = await ShowWhatsAppService(String(whatsappId), companyId);
  const promptObj = (wppFull as any)?.prompt as Prompt | null;

  const openai = createOpenAIClient((promptObj as any)?.apiKey);
  const model = (promptObj as any)?.model || "gpt-4o-mini";
  const max_tokens = Number((promptObj as any)?.maxTokens || 350);
  const temperature = Number((promptObj as any)?.temperature ?? 0.4);

  const company = await Company.findByPk(companyId);
  const businessName = company?.name || "Sua empresa";

  const systemBase = (promptObj as any)?.prompt || `
Você é um assistente de atendimento imobiliário educado, direto ao ponto e humano.
Foque em: acolhimento, entendimento da dor, orientação prática e próximo passo claro.
Jamais solicite dados sensíveis (CPF, RG, etc.) na primeira mensagem.
`;

  const system = [
    systemBase,
    `Tarefa: escrever a PRIMEIRA MENSAGEM para um novo lead captado por formulário.
- Estilo: amigável, profissional, curto (5–8 linhas), com formatação leve quando ajudar.
- Objetivo: agradecer, contextualizar (imóvel/projeto), propor o próximo passo e incluir CTA simples.
- Se houver "project" ou "description", personalize sem parecer robô.
- Não peça documentos; evite links desnecessários.`
  ].join("\n");

  const userContent = `
DADOS DO NEGÓCIO:
- Nome da empresa: ${businessName}

DADOS DO LEAD:
- Nome: ${norm.full_name || "(não informado)"}
- Telefone: ${norm.phone}
- E-mail: ${norm.email || "(não informado)"}
- Projeto: ${norm.project || "(não informado)"}
- Descrição: ${norm.description || "(não informado)"}
- Renda: ${norm.income || "(não informado)"}
- Entrada disponível: ${norm.down_payment || "(não informado)"}
- Quando pretende mudar: ${norm.when || "(não informado)"}

INSTRUÇÕES FINAIS:
- Termine com um CTA convidando a continuar pelo WhatsApp (ex.: "Posso te enviar agora as melhores opções?").
- Se faltar contexto, faça uma abertura neutra.
`.trim();

  let text: string;
  try {
    const chat = await openai.chat.completions.create({
      model,
      max_tokens,
      temperature,
      messages: [
        { role: "system", content: system },
        { role: "user", content: userContent }
      ]
    });
    text =
      chat.choices?.[0]?.message?.content?.trim() ||
      `Olá! Aqui é da ${businessName}. Recebemos seu interesse e já posso te enviar as opções ideais. Posso te mandar agora?`;
  } catch {
    text = `Olá! Aqui é da ${businessName}. Recebemos seu interesse e já posso te enviar as opções ideais. Posso te mandar agora?`;
  }

  // 6) enviar e registrar
  await SendWhatsAppMessage({ body: text, ticket } as any);

  // 7) habilitar bot no ticket
  try {
    const updates: any = { chatbot: true };
    if ((promptObj as any)?.id) updates.promptId = (promptObj as any).id;
    await ticket.update(updates);
  } catch {}

  const durationMs = Number((process.hrtime.bigint() - t0) / BigInt(1e6));
  logger.info({
    ctx: "LeadWebhook",
    phase: "end",
    requestId,
    status: 200,
    action: "sent",
    ticketId: ticket.id,
    to: norm.phone,
    durationMs
  });

  return res.status(200).json({
    ok: true,
    ticketId: ticket.id,
    sent: true,
    preview_message: text
  });
}

// =========================================================
// ===============  HANDLERS EXPORTADOS  ===================
// =========================================================

// -------- GENÉRICO (já existente) --------
type LeadBody = {
  full_name?: string;
  email?: string;
  phone?: string;
  income?: string;
  when?: string;
  down_payment?: string;
  project?: string;
  description?: string;
  sender?: string;
};

export const handleIncomingLead = async (req: Request, res: Response): Promise<Response> => {
  const t0 = process.hrtime.bigint();
  const requestId = Math.random().toString(36).slice(2, 8);

  logger.info({
    ctx: "LeadWebhook",
    phase: "start",
    requestId,
    method: req.method,
    url: req.originalUrl,
    ip: req.ip,
    headers: sanitizeHeaders(req.headers as Record<string, any>),
    query: shrink(req.query),
    body: shrink(req.body)
  });

  const key =
    (req.headers["key"] ||
      (req.headers as any)["Key"] ||
      (req.headers as any)["KEY"]) as string | undefined;

  if (!key || key !== WEBHOOK_KEY) {
    logger.warn({ ctx: "LeadWebhook", phase: "end", requestId, status: 401, reason: "invalid_key" });
    return res.status(401).json({ ok: false, error: "Invalid key" });
  }

  const b = (req.body || {}) as LeadBody;

  if (!b.sender || !b.phone) {
    logger.warn({
      ctx: "LeadWebhook",
      phase: "end",
      requestId,
      status: 422,
      reason: "missing_required_fields",
      missing: { sender: !b.sender, phone: !b.phone }
    });
    return res.status(422).json({ ok: false, error: "sender and phone are required" });
  }

  const phone = normalizeBRPhone(b.phone);
  if (!phone) return res.status(422).json({ ok: false, error: "invalid phone" });

  const norm: NormalizedLead = {
    sender: b.sender!,
    phone,
    full_name: b.full_name,
    email: b.email,
    income: b.income,
    when: b.when,
    down_payment: b.down_payment,
    project: b.project,
    description: b.description
  };

  logger.info({ ctx: "LeadWebhook", phase: "derived", requestId, norm: shrink(norm) });

  return processLeadNormalized(norm, { t0, requestId, req, res });
};

// --------- ESPECÍFICO GHL (NOVO) ---------
export const handleIncomingLeadGHL = async (req: Request, res: Response): Promise<Response> => {
  const t0 = process.hrtime.bigint();
  const requestId = Math.random().toString(36).slice(2, 8);

  logger.info({
    ctx: "LeadWebhook",
    phase: "start",
    requestId,
    method: req.method,
    url: req.originalUrl,
    ip: req.ip,
    headers: sanitizeHeaders(req.headers as Record<string, any>),
    query: shrink(req.query),
    body: shrink(req.body)
  });

  const key =
    (req.headers["key"] ||
      (req.headers as any)["Key"] ||
      (req.headers as any)["KEY"]) as string | undefined;

  if (!key || key !== WEBHOOK_KEY) {
    logger.warn({ ctx: "LeadWebhook", phase: "end", requestId, status: 401, reason: "invalid_key" });
    return res.status(401).json({ ok: false, error: "Invalid key" });
  }

  const body: any = req.body || {};
  const cd: any = body.customData || body.custom_data || {};

  // mapear nomes “loucos” do GHL (fallback se customData não vier completo)
  const incomePT = body["Renda Familiar"];
  const whenPT = body["Quando pretende se mudar?"];
  const downPT = body["Você possui algum valor para Entrada?"];

  const fullName =
    pick(cd["full_name "], cd.full_name, body.full_name, `${body.first_name || ""} ${body.last_name || ""}`) ||
    pick(body.name);

  // phone: preferir customData.phone; senão body.phone
  const phoneRaw = pick(cd.phone, body.phone);
  const phone = normalizeBRPhone(phoneRaw || "");

  if (!phone) {
    logger.warn({ ctx: "LeadWebhook", phase: "end", requestId, status: 422, reason: "invalid_phone", raw: phoneRaw });
    return res.status(422).json({ ok: false, error: "invalid phone" });
  }

  const sender =
    pick(cd.sender, body.sender, req.query.sender) ||
    ""; // obrigatório – validamos já já

  if (!sender) {
    logger.warn({ ctx: "LeadWebhook", phase: "end", requestId, status: 422, reason: "missing_sender" });
    return res.status(422).json({ ok: false, error: "sender is required" });
  }

  const norm: NormalizedLead = {
    sender,
    phone,
    full_name: fullName,
    email: pick(cd.email, body.email),
    income: pick(cd.income, incomePT),
    when: pick(cd.when, whenPT),
    down_payment: pick(cd.down_payment, downPT),
    project: pick(cd.project, body.project),
    description: pick(cd.description, body.description)
  };

  logger.info({ ctx: "LeadWebhook", phase: "derived", requestId, norm: shrink(norm) });

  return processLeadNormalized(norm, { t0, requestId, req, res });
};
