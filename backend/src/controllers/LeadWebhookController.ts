import { Request, Response } from "express";
import { Op } from "sequelize";
import { logger } from "../utils/logger";

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

// — helpers —
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
  // 0) auth por header "key"
  const key = (req.headers["key"] || req.headers["Key"] || req.headers["KEY"]) as string | undefined;
  if (!key || key !== WEBHOOK_KEY) {
    return res.status(401).json({ ok: false, error: "Invalid key" });
  }

  const body = (req.body || {}) as LeadBody;

  // 1) validar campos mínimos
  if (!body.sender) return res.status(422).json({ ok: false, error: "sender is required" });
  if (!body.phone)  return res.status(422).json({ ok: false, error: "phone is required" });

  const phone = normalizeBRPhone(body.phone);
  if (!phone) return res.status(422).json({ ok: false, error: "invalid phone" });

  try {
    // 2) localizar conexão pelo "sender" (name == número da conexão)
    const whatsapp = await Whatsapp.findOne({ where: { name: body.sender } });
    if (!whatsapp) {
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
      logger.info({ ctx: "LeadWebhook", step: "skip_existing", ticketId: existing.id, phone });
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
    const promptObj = wppFull.prompt as unknown as Prompt | null;

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
- Linguagem: amigável, profissional, **curta** (5–8 linhas), com formatação leve (negritos/itens quando ajudar).
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
- Termine com um CTA simples convidando para seguir pelo WhatsApp (ex.: "Posso te enviar agora as melhores opções?").
- Se faltar contexto (ex.: sem projeto), faça uma abertura neutra (sem empurrar link).
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

    // 8) habilitar chatbot no ticket, associar prompt se fizer sentido
    try {
      const updates: any = { chatbot: true };
      if (promptObj?.id) updates.promptId = promptObj.id;
      await ticket.update(updates);
    } catch {}

    logger.info({ ctx: "LeadWebhook", step: "sent", ticketId: ticket.id, to: phone });

    return res.status(200).json({
      ok: true,
      ticketId: ticket.id,
      sent: true,
      preview_message: text
    });
  } catch (err: any) {
    logger.error({ ctx: "LeadWebhook", err: String(err?.message || err) }, "webhook error");
    return res.status(500).json({ ok: false, error: "internal_error" });
  }
};
