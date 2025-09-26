import { WAMessage, AnyMessageContent } from "baileys";
import * as Sentry from "@sentry/node";
import fs from "fs";
import path from "path";
import { lookup as mimeLookup } from "mime-types";
import AppError from "../../errors/AppError";
import GetTicketWbot from "../../helpers/GetTicketWbot";
import Ticket from "../../models/Ticket";
import formatBody from "../../helpers/Mustache";

// ✅ service de criação (já no projeto)
import CreateMessageService from "../MessageServices/CreateMessageService";

interface Request {
  media: Express.Multer.File;
  ticket: Ticket;
  body?: string;
  // se for reply/quote de uma mensagem específica
  quotedId?: string;
}

/**
 * Utilitário compartilhado por outras partes do sistema
 * para montar o objeto de envio conforme o arquivo.
 */
export const getMessageOptions = async (
  mediaName: string,
  absoluteFilePath: string,
  caption?: string
): Promise<AnyMessageContent> => {
  const mimetype = mimeLookup(absoluteFilePath) || "";
  const buffer = fs.readFileSync(absoluteFilePath);

  if (typeof mimetype === "string" && mimetype.startsWith("image/")) {
    return { image: buffer, caption: caption };
  }
  if (typeof mimetype === "string" && mimetype.startsWith("video/")) {
    return { video: buffer, caption: caption };
  }
  if (typeof mimetype === "string" && mimetype.startsWith("audio/")) {
    return { audio: buffer, ptt: false };
  }
  // PDF ou genérico como documento
  return {
    document: buffer,
    fileName: mediaName || path.basename(absoluteFilePath),
    mimetype: typeof mimetype === "string" ? mimetype : undefined,
    caption: caption
  } as AnyMessageContent;
};

const SendWhatsAppMedia = async ({ media, ticket, body, quotedId }: Request): Promise<WAMessage> => {
  try {
    const wbot = await GetTicketWbot(ticket);

    const jid = `${ticket.contact.number}@${ticket.isGroup ? "g.us" : "s.whatsapp.net"}`;
    const bodyMessage = formatBody(body || "", ticket.contact);

    // resolve caminho absoluto do arquivo
    const tempFilePath = (media as any).path ?? (media as any).filepath ?? media.filename;
    const absolutePath = path.isAbsolute(tempFilePath)
      ? tempFilePath
      : path.join(process.cwd(), tempFilePath);

    // monta conteúdo de mídia
    const mimetype = media.mimetype || (mimeLookup(absolutePath) as string) || "";
    let options: AnyMessageContent;

    if (mimetype.startsWith("image/")) {
      options = { image: fs.readFileSync(absolutePath), caption: bodyMessage };
    } else if (mimetype.startsWith("video/")) {
      options = { video: fs.readFileSync(absolutePath), caption: bodyMessage };
    } else if (mimetype.startsWith("audio/")) {
      options = { audio: fs.readFileSync(absolutePath), ptt: false };
    } else if (mimetype === "application/pdf") {
      options = {
        document: fs.readFileSync(absolutePath),
        fileName: media.originalname || path.basename(absolutePath),
        mimetype,
        caption: bodyMessage
      };
    } else {
      // genérico como documento
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
      const MessageModel = (await import("../../models/Message")).default;
      const quoted = await MessageModel.findByPk(quotedId);
      if (quoted?.dataJson) {
        const msgFound = JSON.parse(quoted.dataJson as any);
        sendOpts.quoted = { key: msgFound.key, message: msgFound.message };
      }
    }

    const sentMessage = await wbot.sendMessage(jid, options, { ...sendOpts });

    // 🔸 Persistência imediata em "Messages"
    const messageId = sentMessage?.key?.id || (sentMessage as any)?.messageID || `${Date.now()}`;

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
      read: false,
      mediaType,
      mediaUrl: null,
      ack: 1,
      queueId: ticket.queueId ?? null,
      remoteJid: sentMessage?.key?.remoteJid ?? jid,
      dataJson: JSON.stringify(sentMessage),
      companyId: ticket.companyId // ⬅️ incluir no próprio objeto
    };

    // ✅ Ajuste do TS: o serviço espera o objeto do tipo MessageData diretamente,
    // e não um wrapper { messageData: ... }. Assim elimina o erro TS2353.
    await CreateMessageService(payload as any);

    await ticket.update({ lastMessage: bodyMessage });

    return sentMessage;
  } catch (err) {
    Sentry.captureException(err);
    // manter log para diagnóstico local
    // eslint-disable-next-line no-console
    console.log(err);
    throw new AppError("ERR_SENDING_WAPP_MSG");
  }
};

export default SendWhatsAppMedia;
