// backend/src/services/WbotServices/listeners/messageHelpers.ts
import * as Sentry from "@sentry/node";
import { extractMessageContent, getContentType, proto } from "baileys";
import { logger } from "../../../utils/logger";

// ---------- TIPOS BÁSICOS ----------
export type IWebMsg = proto.IWebMessageInfo;

// ---------- HELPERS INTERNOS ----------
function getBodyButton(msg: IWebMsg): string | undefined {
  const v1 = msg?.message?.viewOnceMessage?.message;

  if (msg.key.fromMe && v1?.buttonsMessage?.contentText) {
    let bodyMessage = `*${v1.buttonsMessage.contentText}*`;
    for (const but of v1.buttonsMessage.buttons || []) {
      bodyMessage += `\n\n${but.buttonText?.displayText}`;
    }
    return bodyMessage;
  }

  if (msg.key.fromMe && v1?.listMessage) {
    let bodyMessage = `*${v1.listMessage.description || ""}*`;
    for (const section of v1.listMessage.sections || []) {
      for (const row of section.rows || []) bodyMessage += `\n\n${row.title}`;
    }
    return bodyMessage;
  }
}

function msgLocation(
  image?: Uint8Array | null,
  latitude?: number | null,
  longitude?: number | null
): string | undefined {
  if (!image) return;
  const b64 = Buffer.from(image).toString("base64");
  return `data:image/png;base64, ${b64} | https://maps.google.com/maps?q=${latitude}%2C${longitude}&z=17&hl=pt-BR|${latitude}, ${longitude} `;
}

// ---------- EXPORTS PRINCIPAIS ----------

// tipo de mensagem (de dentro do proto)
export const getTypeMessage = (msg: IWebMsg): string => {
  try {
    return getContentType(msg.message as any) || "";
  } catch {
    return "";
  }
};

// corpo “humano” da mensagem para salvar/exibir
export const getBodyMessage = (msg: IWebMsg): string | null => {
  try {
    const type = getTypeMessage(msg);
    const types: Record<string, any> = {
      conversation: msg?.message?.conversation,
      editedMessage:
        msg?.message?.editedMessage?.message?.protocolMessage?.editedMessage
          ?.conversation,
      imageMessage: msg.message?.imageMessage?.caption,
      videoMessage: msg.message?.videoMessage?.caption,
      extendedTextMessage: msg.message?.extendedTextMessage?.text,
      buttonsResponseMessage: msg.message?.buttonsResponseMessage?.selectedButtonId,
      templateButtonReplyMessage: msg.message?.templateButtonReplyMessage?.selectedId,
      messageContextInfo:
        msg.message?.buttonsResponseMessage?.selectedButtonId ||
        msg.message?.listResponseMessage?.title,
      buttonsMessage:
        getBodyButton(msg) ||
        msg.message?.listResponseMessage?.singleSelectReply?.selectedRowId,
      viewOnceMessage:
        getBodyButton(msg) ||
        msg.message?.listResponseMessage?.singleSelectReply?.selectedRowId,
      stickerMessage: "sticker",
      contactMessage: msg.message?.contactMessage?.vcard,
      contactsArrayMessage: "varios contatos",
      locationMessage: msgLocation(
        msg.message?.locationMessage?.jpegThumbnail,
        msg.message?.locationMessage?.degreesLatitude,
        msg.message?.locationMessage?.degreesLongitude
      ),
      liveLocationMessage: `Latitude: ${msg.message?.liveLocationMessage?.degreesLatitude} - Longitude: ${msg.message?.liveLocationMessage?.degreesLongitude}`,
      documentMessage: msg.message?.documentMessage?.caption,
      documentWithCaptionMessage:
        msg.message?.documentWithCaptionMessage?.message?.documentMessage?.caption,
      audioMessage: "Áudio",
      listMessage:
        getBodyButton(msg) || msg.message?.listResponseMessage?.title,
      listResponseMessage:
        msg.message?.listResponseMessage?.singleSelectReply?.selectedRowId,
      reactionMessage: msg.message?.reactionMessage?.text || "reaction"
    };

    const val = types[type];
    if (typeof val === "undefined") {
      logger.warn(`#### Tipo não mapeado em getBodyMessage: ${type}`);
      Sentry.setExtra("Mensagem", { BodyMsg: msg.message, msg, type });
      Sentry.captureException(new Error("Novo tipo em getBodyMessage"));
    }
    return val ?? null;
  } catch (err) {
    Sentry.setExtra("Error getBodyMessage", { msg, BodyMsg: msg?.message });
    Sentry.captureException(err);
    return null;
  }
};

// quoted completo (quando houver)
export const getQuotedMessage = (msg: IWebMsg): any => {
  const body =
    msg.message?.imageMessage?.contextInfo ||
    msg.message?.videoMessage?.contextInfo ||
    msg.message?.documentMessage ||
    msg.message?.extendedTextMessage?.contextInfo ||
    msg.message?.buttonsResponseMessage?.contextInfo ||
    msg.message?.listResponseMessage?.contextInfo ||
    msg.message?.templateButtonReplyMessage?.contextInfo ||
    msg.message?.buttonsResponseMessage?.contextInfo ||
    (msg as any)?.message?.buttonsResponseMessage?.selectedButtonId ||
    msg.message?.listResponseMessage?.singleSelectReply?.selectedRowId ||
    (msg as any)?.message?.listResponseMessage?.singleSelectReply?.selectedRowId ||
    msg.message?.listResponseMessage?.contextInfo;

  if (!body) return null;
  const key = Object.keys(body).values().next().value;
  return extractMessageContent(body[key]);
};

// ID da mensagem citada (quando houver)
export const getQuotedMessageId = (msg: IWebMsg): string | undefined => {
  const key = Object.keys(msg?.message || {}).values().next().value;
  const body = extractMessageContent(msg.message as any)[key];
  return body?.contextInfo?.stanzaId;
};

// valida se é um tipo que tratamos
export const isValidMsg = (msg: IWebMsg): boolean => {
  if (msg.key.remoteJid === "status@broadcast") return false;
  try {
    const t = getTypeMessage(msg);
    if (!t) return false;

    const ok =
      t === "conversation" ||
      t === "extendedTextMessage" ||
      t === "editedMessage" ||
      t === "audioMessage" ||
      t === "videoMessage" ||
      t === "imageMessage" ||
      t === "documentMessage" ||
      t === "documentWithCaptionMessage" ||
      t === "stickerMessage" ||
      t === "buttonsResponseMessage" ||
      t === "buttonsMessage" ||
      t === "messageContextInfo" ||
      t === "locationMessage" ||
      t === "liveLocationMessage" ||
      t === "contactMessage" ||
      t === "voiceMessage" ||
      t === "mediaMessage" ||
      t === "contactsArrayMessage" ||
      t === "reactionMessage" ||
      t === "ephemeralMessage" ||
      t === "protocolMessage" ||
      t === "listResponseMessage" ||
      t === "listMessage" ||
      t === "viewOnceMessage";

    if (!ok) {
      logger.warn(`#### Tipo não mapeado em isValidMsg: ${t}`);
      Sentry.setExtra("Mensagem", { BodyMsg: msg.message, msg, t });
      Sentry.captureException(new Error("Novo tipo em isValidMsg"));
    }
    return !!ok;
  } catch (e) {
    Sentry.setExtra("Error isValidMsg", { msg });
    Sentry.captureException(e);
    return false;
  }
};

// só o nome exibido pelo WA (às vezes útil)
export const Push = (msg: IWebMsg) => msg.pushName;
