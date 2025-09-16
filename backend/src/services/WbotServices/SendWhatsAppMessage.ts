import { WAMessage } from "baileys";
import * as Sentry from "@sentry/node";
import AppError from "../../errors/AppError";
import GetTicketWbot from "../../helpers/GetTicketWbot";
import Message from "../../models/Message";
import Ticket from "../../models/Ticket";
import formatBody from "../../helpers/Mustache";

// service de criação já existente no projeto
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
    const sentMessage = await wbot.sendMessage(jid, { text }, { ...options });

    // dados para persistir
    const waId =
      sentMessage?.key?.id || (sentMessage as any)?.messageID || `${Date.now()}`;

    const payload = {
      // ⚠️ se você ainda não criou coluna waId, pode remover essa linha:
      waId,                           // <- manter se já criou waId
      id: waId,                       // provisório enquanto a PK == id do WhatsApp
      ticketId: ticket.id,
      contactId: ticket.contactId,
      body: text,
      fromMe: true,
      read: false,
      mediaType: "chat",
      mediaUrl: null as string | null,
      ack: 1,
      queueId: ticket.queueId ?? null,
      remoteJid: sentMessage?.key?.remoteJid ?? jid,   // campo extra, opcional no seu tipo
      dataJson: JSON.stringify(sentMessage)            // campo extra, opcional no seu tipo
    };

    // 👇 AQUI ESTAVA O ERRO: não use "messageData: payload"
    // Passe tudo "espalhado" + companyId.
    // Se o type do CreateMessageService não tipa remoteJid/dataJson,
    // fazemos um cast leve para não travar o build.
    await CreateMessageService({
      ...(payload as any),
      companyId: ticket.companyId
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
