// backend/src/services/IntegrationsServices/OpenAiService.ts
import { MessageUpsertType, proto, WASocket } from "baileys";
import {
  convertTextToSpeechAndSaveToFile,
  getBodyMessage,
  keepOnlySpecifiedChars,
  transferQueue,
  verifyMediaMessage,
  verifyMessage
} from "../WbotServices/wbotMessageListener";

import fs from "fs";
import path from "path";

import OpenAI from "openai";
import Ticket from "../../models/Ticket";
import Contact from "../../models/Contact";
import Message from "../../models/Message";
import TicketTraking from "../../models/TicketTraking";
import { logger } from "../../utils/logger";

// Integrações (Inventory)
import { resolveByIntent } from "../InventoryServices/ResolveIntegrationService";
import InventoryIntegration from "../../models/InventoryIntegration";
import { buildParamsForApi } from "../InventoryServices/PlannerService";
import { runSearch } from "../InventoryServices/RunSearchService";

type Session = WASocket & {
  id?: number;
};

type SessionOpenAi = OpenAI & { id?: number };
const sessionsOpenAi: SessionOpenAi[] = [];

interface IOpenAi {
  name: string;
  prompt: string;
  voice: string;
  voiceKey: string;
  voiceRegion: string;
  maxTokens: number;
  temperature: number;
  apiKey: string;
  queueId: number;
  maxMessages: number;
  model?: string; // opcional: cada cliente pode escolher modelo
}

const deleteFileSync = (p: string): void => {
  try {
    fs.unlinkSync(p);
  } catch (error) {
    console.error("Erro ao deletar o arquivo:", error);
  }
};

const sanitizeName = (name: string): string => {
  let sanitized = (name || "").split(" ")[0];
  sanitized = sanitized.replace(/[^a-zA-Z0-9]/g, "");
  return sanitized.substring(0, 60);
};

// ---------- Helpers de disponibilidade via Inventory ----------
function isAvailabilityQuestion(text: string) {
  const t = (text || "").toLowerCase();
  return (
    /dispon[ií]vel/.test(t) ||
    /ainda tem/.test(t) ||
    /est[aá]\s+(a[ií]nda\s+)?dispon/.test(t) ||
    /esse im[óo]vel/.test(t)
  );
}

async function tryHandleAvailabilityByInventory(text: string, companyId: number) {
  if (!isAvailabilityQuestion(text)) return null;

  const pick = await resolveByIntent(text, companyId);
  if (!pick) return null;

  const integ = await InventoryIntegration.findByPk(pick.id);
  if (!integ) return null;

  const page = 1;
  const pageSize = 5;

  const planned = buildParamsForApi(
    { text, filtros: {}, paginacao: { page, pageSize } },
    (integ as any).pagination
  );

  const params = (planned && (planned as any).params) || {};
  const result = await runSearch(integ as any, {
    params,
    page,
    pageSize,
    text,
    filtros: {}
  } as any);

  const items = Array.isArray(result?.items) ? result.items : [];
  if (!items.length) {
    return {
      handled: true,
      reply:
        "Não encontrei imóveis disponíveis com essas características. Quer informar região ou orçamento para refinar a busca?"
    };
  }

  if (items.length === 1) {
    const im: any = items[0] || {};
    const titulo = im?.TituloSite || im?.title || "Imóvel encontrado";
    const preco = im?.Valor || im?.price;
    const precoFmt =
      typeof preco === "number"
        ? preco.toLocaleString("pt-BR", { style: "currency", currency: "BRL" })
        : (preco || "");

    const linhas = [
      `Sim, esse imóvel está **disponível** ✅`,
      `**${titulo}** ${precoFmt ? `• ${precoFmt}` : ""}`,
      "",
      `Posso te enviar mais fotos e detalhes?`
    ].filter(Boolean);

    return { handled: true, reply: linhas.join("\n") };
  }

  const tops = items.slice(0, 3).map((im: any) => {
    const titulo = im?.TituloSite || im?.title || "Imóvel";
    const preco = im?.Valor || im?.price;
    const precoFmt =
      typeof preco === "number"
        ? preco.toLocaleString("pt-BR", { style: "currency", currency: "BRL" })
        : (preco || "");
    return `• ${titulo}${precoFmt ? ` — ${precoFmt}` : ""}`;
  });

  return {
    handled: true,
    reply: [
      `Encontrei **${items.length} imóveis** semelhantes. Aqui estão alguns:`,
      ...tops,
      "",
      `Quer que eu filtre por bairro, preço ou número de quartos?`
    ].join("\n")
  };
}
// --------------------------------------------------------------

export const handleOpenAi = async (
  openAiSettings: IOpenAi,
  msg: proto.IWebMessageInfo,
  wbot: Session,
  ticket: Ticket,
  contact: Contact,
  mediaSent: Message | undefined,
  ticketTraking: TicketTraking
): Promise<void> => {
  if (contact.disableBot) return;

  const bodyMessage = getBodyMessage(msg);
  if (!bodyMessage) return;
  if (!openAiSettings) return;
  if (msg.messageStubType) return;

  const publicFolder: string = path.resolve(
    __dirname,
    "..",
    "..",
    "..",
    "public",
    `company${ticket.companyId}`
  );

  // --------- Session cache (OpenAI v4) ----------
  let openai: SessionOpenAi;
  const idx = sessionsOpenAi.findIndex(s => s.id === ticket.id);
  if (idx === -1) {
    openai = new OpenAI({ apiKey: openAiSettings.apiKey }) as SessionOpenAi;
    openai.id = ticket.id;
    sessionsOpenAi.push(openai);
  } else {
    openai = sessionsOpenAi[idx];
  }
  // ---------------------------------------------

  // HOOK: disponibilidade antes do LLM
  try {
    const tryAvail = await tryHandleAvailabilityByInventory(bodyMessage, ticket.companyId);
    if (tryAvail?.handled) {
      const sentMessage = await wbot.sendMessage(msg.key.remoteJid!, {
        text: `\u200e ${tryAvail.reply}`
      });
      await verifyMessage(sentMessage!, ticket, contact);
      return;
    }
  } catch (err) {
    logger.warn({ err }, "Availability hook falhou, continuando no LLM");
  }

  const messages = await Message.findAll({
    where: { ticketId: ticket.id },
    order: [["createdAt", "ASC"]],
    limit: openAiSettings.maxMessages
  });

  const promptSystem = `Nas respostas utilize o nome ${sanitizeName(
    contact.name || "Amigo(a)"
  )}. Respeite o limite de ${openAiSettings.maxTokens} tokens.
Sempre que possível, mencione o nome para personalizar o atendimento. 
Se precisar transferir, comece com 'Ação: Transferir para o setor de atendimento'.\n
${openAiSettings.prompt}\n`;

  let messagesOpenAi: Array<{ role: "system" | "user" | "assistant"; content: string }> = [];

  // ------------------- Texto -------------------
  if (msg.message?.conversation || msg.message?.extendedTextMessage?.text) {
    messagesOpenAi.push({ role: "system", content: promptSystem });

    for (let m of messages) {
      if (m.mediaType === "conversation" || m.mediaType === "extendedTextMessage") {
        messagesOpenAi.push({
          role: m.fromMe ? "assistant" : "user",
          content: m.body
        });
      }
    }
    messagesOpenAi.push({ role: "user", content: bodyMessage! });

    const chat = await openai.chat.completions.create({
      model: openAiSettings.model || "gpt-4o-mini", // 🔄 modelo atualizado
      messages: messagesOpenAi,
      max_tokens: openAiSettings.maxTokens,
      temperature: openAiSettings.temperature
    });

    let response = chat.choices?.[0]?.message?.content;

    if (response?.includes("Ação: Transferir para o setor de atendimento")) {
      await transferQueue(openAiSettings.queueId, ticket, contact);
      response = response.replace("Ação: Transferir para o setor de atendimento", "").trim();
    }

    if (openAiSettings.voice === "texto") {
      const sentMessage = await wbot.sendMessage(msg.key.remoteJid!, {
        text: `\u200e ${response || ""}`
      });
      await verifyMessage(sentMessage!, ticket, contact);
    } else {
      const fileName = `${ticket.id}_${Date.now()}`;
      convertTextToSpeechAndSaveToFile(
        keepOnlySpecifiedChars(response || ""),
        `${publicFolder}/${fileName}`,
        openAiSettings.voiceKey,
        openAiSettings.voiceRegion,
        openAiSettings.voice,
        "mp3"
      ).then(async () => {
        try {
          const sendMessage = await wbot.sendMessage(msg.key.remoteJid!, {
            audio: { url: `${publicFolder}/${fileName}.mp3` },
            mimetype: "audio/mpeg",
            ptt: true
          });
          await verifyMediaMessage(sendMessage!, ticket, contact, ticketTraking, false, false, wbot);
          deleteFileSync(`${publicFolder}/${fileName}.mp3`);
        } catch (error) {
          console.log(`Erro para responder com audio: ${error}`);
        }
      });
    }

    return;
  }

  // ------------------- Áudio (transcrição) -------------------
  if (msg.message?.audioMessage) {
    const mediaUrl = mediaSent!.mediaUrl!.split("/").pop();
    const file = fs.createReadStream(`${publicFolder}/${mediaUrl}`);

    const transcription = await openai.audio.transcriptions.create({
      model: "whisper-1",
      file: file as any
    });

    messagesOpenAi.push({ role: "system", content: promptSystem });
    for (let m of messages) {
      if (m.mediaType === "conversation" || m.mediaType === "extendedTextMessage") {
        messagesOpenAi.push({
          role: m.fromMe ? "assistant" : "user",
          content: m.body
        });
      }
    }
    messagesOpenAi.push({ role: "user", content: transcription.text });

    const chat = await openai.chat.completions.create({
      model: openAiSettings.model || "gpt-4o-mini", // 🔄 modelo atualizado
      messages: messagesOpenAi,
      max_tokens: openAiSettings.maxTokens,
      temperature: openAiSettings.temperature
    });

    let response = chat.choices?.[0]?.message?.content;

    if (response?.includes("Ação: Transferir para o setor de atendimento")) {
      await transferQueue(openAiSettings.queueId, ticket, contact);
      response = response.replace("Ação: Transferir para o setor de atendimento", "").trim();
    }

    if (openAiSettings.voice === "texto") {
      const sentMessage = await wbot.sendMessage(msg.key.remoteJid!, {
        text: `\u200e ${response || ""}`
      });
      await verifyMessage(sentMessage!, ticket, contact);
    } else {
      const fileName = `${ticket.id}_${Date.now()}`;
      convertTextToSpeechAndSaveToFile(
        keepOnlySpecifiedChars(response || ""),
        `${publicFolder}/${fileName}`,
        openAiSettings.voiceKey,
        openAiSettings.voiceRegion,
        openAiSettings.voice,
        "mp3"
      ).then(async () => {
        try {
          const sendMessage = await wbot.sendMessage(msg.key.remoteJid!, {
            audio: { url: `${publicFolder}/${fileName}.mp3` },
            mimetype: "audio/mpeg",
            ptt: true
          });
          await verifyMediaMessage(sendMessage!, ticket, contact, ticketTraking, false, false, wbot);
          deleteFileSync(`${publicFolder}/${fileName}.mp3`);
        } catch (error) {
          console.log(`Erro para responder com audio: ${error}`);
        }
      });
    }
  }
};
