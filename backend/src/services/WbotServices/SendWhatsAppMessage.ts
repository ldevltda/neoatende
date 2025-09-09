import { WAMessage } from "baileys";
import * as Sentry from "@sentry/node";
import AppError from "../../errors/AppError";
import GetTicketWbot from "../../helpers/GetTicketWbot";
import Message from "../../models/Message";
import Ticket from "../../models/Ticket";
import formatBody from "../../helpers/Mustache";

// ✅ service de criação (já em seu projeto)
import CreateMessageService from "../MessageServices/CreateMessageService";

interface Request {
  body: string;
  ticket: Ticket;
  quotedMsg?: Message;
}

const SendWhatsAppMessage = async ({
  body,
  ticket,
  quotedMsg
}: Request): Promise<WAMessage> => {
  try {
    const wbot = await GetTicketWbot(ticket);

    // monta JID (grupo ou contato)
    const jid = `${ticket.contact.number}@${ticket.isGroup ? "g.us" : "s.whatsapp.net"}`;

    // quote (responder) se existir quotedMsg
    let options: any = {};
    if (quotedMsg) {
      const chatMessages = await Message.findOne({
        where: { id: quotedMsg.id }
      });

      if (chatMessages?.dataJson) {
        const msgFound = JSON.parse(chatMessages.dataJson as any);
        options = {
          quoted: {
            key: msgFound.key,
            message: msgFound.message
          }
        };
      }
    }

    // envia
    const text = formatBody(body, ticket.contact);
    const sentMessage = await wbot.sendMessage(
      jid,
      { text },
      { ...options }
    );

    // 🔸 Persistência imediata em "Messages"
    const messageId =
      sentMessage?.key?.id || (sentMessage as any)?.messageID || `${Date.now()}`;

    const payload: any = {
      id: messageId,
      ticketId: ticket.id,
      contactId: ticket.contactId,
      body: text,
      fromMe: true,
      read: true,
      mediaType: "chat",
      mediaUrl: null,
      ack: 1, // 1 = enviado/aceito pelo servidor (você pode evoluir com updates de ack)
      queueId: ticket.queueId ?? null,
      // extras úteis para debug/quote futuro
      remoteJid: sentMessage?.key?.remoteJid ?? jid,
      dataJson: JSON.stringify(sentMessage)
    };

    // TypeScript do seu CreateMessageService não tem remoteJid/dataJson tipado,
    // então fazemos cast para não quebrar o build:
    await CreateMessageService({
      companyId: ticket.companyId,
      messageData: payload as any
    });

    await ticket.update({ lastMessage: text });

    return sentMessage;
  } catch (err) {
    Sentry.captureException(err);
    console.log(err);
    throw new AppError("ERR_SENDING_WAPP_MSG");
  }
};

export default SendWhatsAppMessage;
