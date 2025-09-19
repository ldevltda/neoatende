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

// ---------- helpers de LOG ----------
const SENSITIVE_HEADERS = ["authorization", "key", "x-api-key", "cookie", "set-cookie"];
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
// -----------------------------------

const DIGITS = /\D+/g;
function normalizeBRPhone(raw?: string | null): string | null {
  if (!raw) return null;
  const d = String(raw).replace(DIGITS, "");
  if (!d) return null;
  if (d.startsWith("55")) return d;
  if (d.length === 10 || d.length === 11) return "55" + d;
  return d;
}

type LeadBody = {
  full_name?: string;
  email?: string;
  phone?: string;
  income?: string;
  when?: string;
  down_payment?: string;
  project?: string;
  description?: string;
  sender?: string; // conexão do WhatsApp (name)
};

export const handleIncomingLead = async (req: Request, res: Response): Promise<Response> => {
  const t0 = process.hrtime.bigint();
  const requestId = Math.random().toString(36).slice(2, 8);

  // LOG de entrada (headers, query, body)
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

  // 0) auth por header "key"
  const key =
    (req.headers["key"] ||
      (req.headers as any)["Key"] ||
      (req.headers as any)["KEY"]) as string | undefined;

  if (!key || key !== WEBHOOK_KEY) {
    const durationMs = Number((process.hrtime.bigint() - t0) / BigInt(1e6));
    logger.warn({
      ctx: "LeadWebhook",
      phase: "end",
      requestId,
      status: 401,
      reason: "invalid_key",
      durationMs
    });
    return res.status(401).json({ ok: false, error: "Invalid key" });
  }

  const body = (req.body || {}) as LeadBody;

  // 1) validar campos mínimos
  if (!body.sender || !body.phone) {
    const durationMs = Number((process.hrtime.bigint() - t0) / BigInt(1e6));
    logger.warn({
      ctx: "LeadWebhook",
      phase: "end",
      requestId,
      status: 422,
      reason: "missing_required_fields",
      missing: { sender: !body.sender, phone: !body.phone },
      durationMs
    });
    return res.status(422).json({ ok: false, error: "sender and phone are required" });
  }

  const phone = normalizeBRPhone(body.phone);
  if (!phone) {
    const durationMs = Number((process.hrtime.bigint() - t0) / BigInt(1e6));
    logger.warn({
      ctx: "LeadWebhook",
      phase: "end",
      requestId,
      status: 422,
      reason: "invalid_phone",
      rawPhone: body.phone,
      durationMs
    });
    return res.status(422).json({ ok: false, error: "invalid phone" });
  }

  try {
    // 2) localizar conexão pelo "sender" (name == número da conexão)
    const whatsapp = await Whatsapp.findOne({ where: { name: body.sender } });
    if (!whatsapp) {
      const durationMs = Number((process.hrtime.bigint() - t0) / BigInt(1e6));
      logger.warn({
        ctx: "LeadWebhook",
        phase: "end",
        requestId,
        status: 404,
        reason: "sender_not_found",
        sender: body.sender,
        durationMs
      });
      return res.status(404).json({ ok: false, error: "sender_not_found" });
    }

    const companyId = whatsapp.companyId;
    const whatsappId = whatsapp.id;

    // 3) já existe algum ticket para esse número na empresa?
    const existing = await Ticket.findOne({
      where: { companyId },
      include: [{ model: Contact, where: { number: phone } }]
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
        phone,
        durationMs
      });
      return res.status(200).json({
        ok: true,
        skipped_existing_ticket: true,
        ticketId: existing.id
      });
    }

    // 4) criar/atualizar contato
    const name = body.full_name?.trim() || "Novo contato";
    const email = body.email || "";
    const contact = await CreateOrUpdateContactService({
      name,
      number: phone,
      isGroup: false,
      email,
      companyId,
      whatsappId
    });

    // 5) criar/encontrar ticket
    const ticket = await FindOrCreateTicketService(contact, whatsappId, 0, companyId);

    // 6) montar mensagem com IA usando o Prompt da conexão (se existir)
    const wppFull = await ShowWhatsAppService(String(whatsappId), companyId);
    const promptObj = (wppFull as any)?.prompt as Prompt | null;

    const openai = createOpenAIClient((promptObj as any)?.apiKey);
    const model = (promptObj as any)?.model || "gpt-4o-mini";
    const max_tokens = Number((promptObj as any)?.maxTokens || 350);
    const temperature = Number((promptObj as any)?.temperature ?? 0.4);

    // company
    const company = await Company.findByPk(companyId);
    const businessName = company?.name || "Sua empresa";

    const systemBase = (promptObj as any)?.prompt || `
Você é um assistente de atendimento imobiliário educado, direto ao ponto e humano.
Foque em: acolhimento, entendimento da dor, orientação prática e próximo passo claro.
Jamais solicite dados sensíveis (CPF, RG, etc.) na primeira mensagem.
`;

    const system = [
      systemBase,
      `Tarefa específica: redigir a PRIMEIRA MENSAGEM de abordagem para um novo lead vindo de formulário.
- Linguagem: amigável, profissional, curta (5–8 linhas).
- Objetivo: agradecer o interesse, contextualizar (imóvel/projeto), confirmar 1–2 dados se necessário, propor o próximo passo e incluir CTA.
- Se houver "project" ou "description", use-os para personalizar (sem soar robô).
- Não peça documentos ou fotos. Evite links excessivos.`
    ].join("\n");

    const userContent = `
DADOS DO NEGÓCIO:
- Nome da empresa: ${businessName}

DADOS DO LEAD:
- Nome: ${body.full_name || "(não informado)"}
- Telefone: ${phone}
- E-mail: ${email || "(não informado)"}
- Projeto: ${body.project || "(não informado)"}
- Descrição: ${body.description || "(não informado)"}
- Renda: ${body.income || "(não informado)"}
- Entrada disponível: ${body.down_payment || "(não informado)"}
- Quando pretende mudar: ${body.when || "(não informado)"}

INSTRUÇÕES FINAIS:
- Termine com um CTA convidando para seguir pelo WhatsApp.
- Se faltar contexto, faça uma abertura neutra.
`.trim();

    const chat = await openai.chat.completions.create({
      model,
      max_tokens,
      temperature,
      messages: [
        { role: "system", content: system },
        { role: "user", content: userContent }
      ]
    });

    const text =
      chat.choices?.[0]?.message?.content?.trim() ||
      `Olá! Aqui é da ${businessName}. Recebemos seu interesse e já posso te enviar as opções ideais. Posso te mandar agora?`;

    // 7) enviar e registrar
    await SendWhatsAppMessage({
      body: text,
      ticket
    } as any);

    // 8) habilitar chatbot no ticket, associar prompt (se houver)
    try {
      const updates: any = { chatbot: true };
      if (promptObj?.id) updates.promptId = promptObj.id;
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
      to: phone,
      durationMs
    });

    return res.status(200).json({
      ok: true,
      ticketId: ticket.id,
      sent: true,
      preview_message: text
    });
  } catch (err: any) {
    const durationMs = Number((process.hrtime.bigint() - t0) / BigInt(1e6));
    logger.error(
      { ctx: "LeadWebhook", phase: "error", requestId, durationMs, err: String(err?.message || err) },
      "webhook error"
    );
    return res.status(500).json({ ok: false, error: "internal_error" });
  }
};
