// backend/src/services/WbotServices/listeners/mediaHelpers.ts
import {
  downloadMediaMessage,
  getContentType,
  proto,
  WAMessage
} from "baileys";
import { extension as mimeExt } from "mime-types";
import fs from "fs";
import path from "path";
import Sentry from "@sentry/node";
import { ensurePublicFolder } from "./helpers";

interface Downloaded {
  data: Buffer;
  mimetype: string;
  filename: string;
}

export const downloadMedia = async (
  msg: proto.IWebMessageInfo | WAMessage
): Promise<Downloaded> => {
  let buffer: Buffer | undefined;
  try {
    buffer = await downloadMediaMessage(msg as any, "buffer", {});
  } catch (err) {
    console.error("Erro ao baixar mídia:", err);
  }

  if (!buffer) buffer = Buffer.alloc(0);

  let filename: string =
    (msg as any).message?.documentMessage?.fileName || "";

  const mediaNode =
    (msg as any).message?.imageMessage ||
    (msg as any).message?.audioMessage ||
    (msg as any).message?.videoMessage ||
    (msg as any).message?.stickerMessage ||
    (msg as any).message?.documentMessage ||
    (msg as any).message?.documentWithCaptionMessage?.message?.documentMessage ||
    (msg as any).message?.extendedTextMessage?.contextInfo?.quotedMessage
      ?.imageMessage ||
    (msg as any).message?.extendedTextMessage?.contextInfo?.quotedMessage
      ?.videoMessage;

  if (!mediaNode) {
    Sentry.withScope(scope => {
      scope.setLevel(Sentry.Severity.Warning);
      scope.setContext("downloadMedia", {
        keyId: (msg as any)?.key?.id ?? "unknown",
        remoteJid: (msg as any)?.key?.remoteJid ?? "unknown"
      });
      Sentry.captureMessage("downloadMedia: mimetype ausente");
    });
  }

  if (!filename) {
    const ext = mediaNode?.mimetype ? mimeExt(mediaNode.mimetype) : false;
    filename = `${Date.now()}.${ext || "bin"}`;
  } else {
    filename = `${Date.now()}_${filename}`;
  }

  return {
    data: buffer,
    mimetype: mediaNode?.mimetype || "application/octet-stream",
    filename
  };
};

import Message from "../../../models/Message";
import Ticket from "../../../models/Ticket";
import Contact from "../../../models/Contact";
import { getIO } from "../../../libs/socket";
import CreateMessageService from "../../MessageServices/CreateMessageService";
import { logger } from "../../../utils/logger";
import Queue from "../../../models/Queue";
import User from "../../../models/User";

export const verifyMediaMessage = async (
  msg: proto.IWebMessageInfo,
  ticket: Ticket,
  contact: Contact,
  ticketTraking: any = null,
  isForwarded = false,
  isPrivate = false,
  wbot: any = null
): Promise<Message> => {
  const io = getIO();
  const quotedMsg = null;
  const media = await downloadMedia(msg);

  if (!media) throw new Error("ERR_WAPP_DOWNLOAD_MEDIA");

  if (!media.filename) {
    const ext = mimeExt(media.mimetype) || "bin";
    media.filename = `${Date.now()}.${ext}`;
  }

  try {
    const publicFolder = ensurePublicFolder();
    const fullPath = path.join(publicFolder, media.filename);
    // converte Buffer -> Uint8Array para agradar os types da sua versão do @types/node
    await fs.promises.writeFile(fullPath, new Uint8Array(media.data));
  } catch (err) {
    Sentry.captureException(err);
    logger.error(err);
  }

  const body =
    (msg as any).message?.imageMessage?.caption ||
    (msg as any).message?.documentMessage?.caption ||
    "-";

  const messageData = {
    waId: msg.key.id,
    id: msg.key.id,
    ticketId: ticket.id,
    contactId: msg.key.fromMe ? undefined : contact.id,
    body,
    fromMe: msg.key.fromMe,
    read: msg.key.fromMe,
    mediaUrl: media.filename,
    mediaType: media.mimetype.split("/")[0],
    quotedMsgId: quotedMsg?.id,
    ack: (msg as any).status,
    remoteJid: msg.key.remoteJid,
    participant: (msg as any).key.participant,
    dataJson: JSON.stringify(msg),
    ticketTrakingId: ticketTraking?.id
  };

  await ticket.update({ lastMessage: body || "Arquivo de mídia" });

  const newMessage = await CreateMessageService({
    ...messageData,
    companyId: ticket.companyId
  });

  if (!msg.key.fromMe && ticket.status === "closed") {
    await ticket.update({ status: "pending" });
    await ticket.reload({
      include: [
        { model: Queue, as: "queue" },
        { model: User, as: "user" },
        { model: Contact, as: "contact" }
      ]
    });

    io.to(`company-${ticket.companyId}-closed`)
      .to(`queue-${ticket.queueId}-closed`)
      .emit(`company-${ticket.companyId}-ticket`, {
        action: "delete",
        ticket,
        ticketId: ticket.id
      });

    io.to(`company-${ticket.companyId}-${ticket.status}`)
      .to(`queue-${ticket.queueId}-${ticket.status}`)
      .to(ticket.id.toString())
      .emit(`company-${ticket.companyId}-ticket`, {
        action: "update",
        ticket,
        ticketId: ticket.id
      });
  }

  return newMessage;
};

import CreateMessageSvc from "../../MessageServices/CreateMessageService";
import { getBodyMessage } from "./messageHelpers";

export const verifyMessage = async (
  msg: proto.IWebMessageInfo,
  ticket: Ticket,
  contact: Contact
): Promise<void> => {
  const io = getIO();

  const body = getBodyMessage(msg);
  const isEdited = getContentType(msg.message) === "editedMessage";

  const messageData = {
    waId: msg.key.id,
    id: isEdited
      ? ((msg?.message?.editedMessage?.message?.protocolMessage?.key?.id as unknown) as string)
      : msg.key.id,
    ticketId: ticket.id,
    contactId: msg.key.fromMe ? undefined : contact.id,
    body,
    fromMe: msg.key.fromMe,
    mediaType: getContentType(msg.message),
    read: msg.key.fromMe,
    quotedMsgId: undefined,
    ack: (msg as any).status,
    remoteJid: msg.key.remoteJid,
    participant: msg.key.participant,
    dataJson: JSON.stringify(msg),
    isEdited
  };

  await ticket.update({ lastMessage: body });

  await CreateMessageSvc({ ...messageData, companyId: ticket.companyId });

  if (!msg.key.fromMe && ticket.status === "closed") {
    await ticket.update({ status: "pending" });
    await ticket.reload({
      include: [
        { model: Queue, as: "queue" },
        { model: User, as: "user" },
        { model: Contact, as: "contact" }
      ]
    });

    io.to(`company-${ticket.companyId}-closed`)
      .to(`queue-${ticket.queueId}-closed`)
      .emit(`company-${ticket.companyId}-ticket`, {
        action: "delete",
        ticket,
        ticketId: ticket.id
      });

    io.to(`company-${ticket.companyId}-${ticket.status}`)
      .to(`queue-${ticket.queueId}-${ticket.status}`)
      .emit(`company-${ticket.companyId}-ticket`, {
        action: "update",
        ticket,
        ticketId: ticket.id
      });
  }
};
