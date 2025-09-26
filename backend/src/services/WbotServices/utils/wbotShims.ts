import { proto, WASocket } from "baileys";

// Extrai texto da mensagem
export function getBodyMessage(msg: proto.IWebMessageInfo): string {
  const m: any = msg?.message || {};
  return (
    m.conversation ||
    m.extendedTextMessage?.text ||
    m.imageMessage?.caption ||
    m.videoMessage?.caption ||
    ""
  ).toString();
}

export function isNumeric(v: any): boolean {
  return typeof v === "string" ? /^\d+$/.test(v) : typeof v === "number";
}

export function sleep(ms: number): Promise<void> {
  return new Promise(res => setTimeout(res, ms));
}

// Validação simples (placeholder)
export function validaCpfCnpj(v: string): boolean {
  const s = (v || "").replace(/\D/g, "");
  if (s.length === 11) return /^\d{11}$/.test(s);  // CPF
  if (s.length === 14) return /^\d{14}$/.test(s);  // CNPJ
  return false;
}

// Mapeia extensão -> mimetype (básico o suficiente)
function extToMime(ext?: string): string {
  const e = (ext || "").toLowerCase();
  switch (e) {
    case "pdf":  return "application/pdf";
    case "png":  return "image/png";
    case "jpg":
    case "jpeg": return "image/jpeg";
    case "webp": return "image/webp";
    case "gif":  return "image/gif";
    case "txt":  return "text/plain";
    case "csv":  return "text/csv";
    case "doc":  return "application/msword";
    case "docx": return "application/vnd.openxmlformats-officedocument.wordprocessingml.document";
    case "xls":  return "application/vnd.ms-excel";
    case "xlsx": return "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";
    case "mp4":  return "video/mp4";
    case "zip":  return "application/zip";
    default:     return "application/octet-stream";
  }
}

function guessExtFromPathOrUrl(pathOrUrl: string): string | undefined {
  try {
    // remove query/hash
    const clean = pathOrUrl.split("?")[0].split("#")[0];
    const idx = clean.lastIndexOf(".");
    if (idx === -1) return undefined;
    return clean.slice(idx + 1);
  } catch {
    return undefined;
  }
}

// Envia imagem por URL pública
export async function sendMessageImage(
  wbot: WASocket,
  contact: any,
  ticket: any,
  imageUrl: string,
  caption?: string
) {
  const jid = `${ticket?.contact?.number || contact?.number}@${ticket?.isGroup ? "g.us" : "s.whatsapp.net"}`;
  await wbot.sendMessage(jid, { image: { url: imageUrl }, caption: caption || "" });
}

// Envia documento por caminho/URL (inclui mimetype exigido pelo Baileys)
export async function sendMessageLink(
  wbot: WASocket,
  contact: any,
  ticket: any,
  filePathOrUrl: string,
  fileName?: string
) {
  const jid = `${ticket?.contact?.number || contact?.number}@${ticket?.isGroup ? "g.us" : "s.whatsapp.net"}`;

  const ext = guessExtFromPathOrUrl(filePathOrUrl) || (fileName?.split(".").pop());
  const mimetype = extToMime(ext);
  const finalName = fileName || `arquivo.${ext || "bin"}`;

  try {
    await wbot.sendMessage(jid, {
      document: { url: filePathOrUrl },
      mimetype,
      fileName: finalName
    });
    return;
  } catch {
    // fallback: manda como link de texto
    await wbot.sendMessage(jid, { text: filePathOrUrl });
  }
}

export function makeid(len = 8): string {
  const chars = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789";
  let r = "";
  for (let i = 0; i < len; i++) r += chars.charAt(Math.floor(Math.random() * chars.length));
  return r;
}
