import { WAMessage, AnyMessageContent } from "baileys";
import * as Sentry from "@sentry/node";
import fs from "fs";
import path from "path";
import { lookup as mimeLookup } from "mime-types";
import AppError from "../../errors/AppError";
import GetTicketWbot from "../../helpers/GetTicketWbot";
import Ticket from "../../models/Ticket";
import formatBody from "../../helpers/Mustache";

// ✅ service de criação (já em seu projeto)
import CreateMessageService from "../MessageServices/CreateMessageService";

interface Request {
  media: Express.Multer.File;
  ticket: Ticket;
  body?: string;
  // se for reply/quote de uma mensagem específica
  quotedId?: string;
}

const SendWhatsAppMedia = async ({
  media,
  ticket,
  body,
  quotedId
}: Request): Promise<WAMessage> => {
  try {
    const wbot = await GetTicketWbot(ticket);

    const jid = `${ticket.contact.number}@${ticket.isGroup ? "g.us" : "s.whatsapp.net"}`;
    const bodyMessage = formatBody(body || "", ticket.contact);

    // monta o conteúdo de mídia conforme o mimetype
    const tempFilePath = media.path ?? (media as any).filepath ?? media.filename;
    const absolutePath = path.isAbsolute(tempFilePath)
      ? tempFilePath
      : path.join(process.cwd(), tempFilePath);

    const mimetype = media.mimetype || mimeLookup(absolutePath) || "";
    let options: AnyMessageContent;

    if (mimetype.startsWith("image/")) {
      options = { image: fs.readFileSync(absolutePath), caption: bodyMessage };
    } else if (mimetype.startsWith("video/")) {
      options = { video: fs.readFileSync(absolutePath), caption: bodyMessage };
    } else if (mimetype.startsWith("audio/")) {
      options = { audio: fs.readFileSync(absolutePath), ptt: false }; // ptt=true vira "áudio de voz"
    } else if (mimetype === "application/pdf") {
      options = {
        document: fs.readFileSync(absolutePath),
        fileName: media.originalname || path.basename(absolutePath),
        mimetype,
        caption: bodyMessage
      };
    } else {
      // genérico: envia como documento
      options = {
        document: fs.readFileSync(absolutePath),
        fileName: media.originalname || path.basename(absolutePath),
        mimetype,
        caption: bodyMessage
      };
    }

    // quoted (opcional)
    let sendOpts: any = {};
    if (quotedId) {
      const quoted = await (await import("../../models/Message")).default.findByPk(quotedId);
      if (quoted?.dataJson) {
        const msgFound = JSON.parse(quoted.dataJson as any);
        sendOpts.quoted = { key: msgFound.key, message: msgFound.message };
      }
    }

    const sentMessage = await wbot.sendMessage(jid, options, { ...sendOpts });

    // 🔸 Persistência imediata em "Messages"
    const messageId =
      sentMessage?.key?.id || (sentMessage as any)?.messageID || `${Date.now()}`;

    // detectar tipo de mídia salvo
    let mediaType: string = "document";
    if ((options as any).image) mediaType = "image";
    else if ((options as any).video) mediaType = "video";
    else if ((options as any).audio) mediaType = "audio";
    else if ((options as any).sticker) mediaType = "sticker";
    else if ((options as any).document && mimetype === "application/pdf") mediaType = "application";
    
    const payload: any = {
      id: messageId,
      ticketId: ticket.id,
      contactId: ticket.contactId,
      body: bodyMessage || "",
      fromMe: true,
      read: true,
      mediaType,
      // 👉 se você já hospeda e expõe o arquivo publicamente, preencha aqui
      mediaUrl: null,
      ack: 1,
      queueId: ticket.queueId ?? null,
      remoteJid: sentMessage?.key?.remoteJid ?? jid,
      dataJson: JSON.stringify(sentMessage)
    };

    await CreateMessageService({
      companyId: ticket.companyId,
      messageData: payload as any
    });

    await ticket.update({ lastMessage: bodyMessage });

    return sentMessage;
  } catch (err) {
    Sentry.captureException(err);
    console.log(err);
    throw new AppError("ERR_SENDING_WAPP_MSG");
  }
};

export default SendWhatsAppMedia;
