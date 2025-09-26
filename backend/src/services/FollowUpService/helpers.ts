import Ticket from "../../models/Ticket";
import Contact from "../../models/Contact";
import Message from "../../models/Message";
// ✅ usa o serviço nativo de envio de texto do WhatsApp
import SendWhatsAppMessage from "../WbotServices/SendWhatsAppMessage";
import { logger } from "../../utils/logger";

export async function getTicketById(ticketId: number, companyId: number) {
  return Ticket.findOne({
    where: { id: ticketId, companyId },
    include: [{ model: Contact, as: "contact" }]
  });
}

export async function getLastInboundAt(ticketId: number, companyId: number) {
  const msg = await Message.findOne({
    where: { ticketId, companyId, fromMe: false },
    order: [["createdAt", "DESC"]],
    attributes: ["createdAt"]
  });
  return (msg?.getDataValue("createdAt") as Date) || undefined;
}

export async function sendWhatsAppText(ticket: any, body: string) {
  try {
    // A maioria dos forks aceita esse shape simples ({ body, ticket })
    await (SendWhatsAppMessage as any)({
      body,
      ticket
    });
  } catch (err) {
    try {
      // fallback comum em alguns forks: ({ body, ticket, quotedMsg: undefined, contactId })
      await (SendWhatsAppMessage as any)({
        body,
        ticket,
        quotedMsg: undefined,
        contactId: ticket?.contactId
      });
    } catch (e) {
      logger.error({ err: e }, "sendWhatsAppText error");
    }
  }
}
