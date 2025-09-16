import { proto, WASocket } from "baileys";
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
import axios from "axios";

import OpenAI from "openai";
import Ticket from "../../models/Ticket";
import Contact from "../../models/Contact";
import Message from "../../models/Message";
import TicketTraking from "../../models/TicketTraking";
import { logger } from "../../utils/logger";
import InventoryIntegration from "../../models/InventoryIntegration";
import { ChatCompletionTool } from "openai/resources/chat/completions";

type Session = WASocket & { id?: number };
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
  model?: string; // gpt-4o-mini default
}

const deleteFileSync = (p: string): void => {
  try { fs.unlinkSync(p); } catch {}
};

const sanitizeName = (name: string): string => {
  let sanitized = (name || "").split(" ")[0];
  sanitized = sanitized.replace(/[^a-zA-Z0-9]/g, "");
  return sanitized.substring(0, 60);
};

/**
 * Gera tools dinamicamente com base nas integrações da empresa
 */
async function buildTools(companyId: number): Promise<ChatCompletionTool[]> {
  const integrations = await InventoryIntegration.findAll({ where: { companyId } });
  return integrations.map((i) =>
    ({
      type: "function",
      function: {
        name: `integration_${i.get("id")}`,
        description: `Consulta a integração cadastrada: ${i.get("name")}`,
        parameters: {
          type: "object",
          properties: {
            text: { type: "string", description: "Texto/critério de busca do cliente" },
            filtros: { type: "object", description: "Filtros (ex.: bairro, quartos, preçoMax, marca...)" },
            page: { type: "integer", description: "Página da busca" },
            pageSize: { type: "integer", description: "Itens por página" }
          },
          required: ["text"]
        }
      }
    }) as ChatCompletionTool
  );
}

/**
 * Executa a integração via /inventory/agent/lookup
 * (passamos integrationId, text, filtros, paginação e companyId)
 */
async function executeIntegration(
  integrationId: number,
  args: any,
  companyId: number
) {
  const url = `${(process.env.BACKEND_URL || "http://localhost:3000").replace(/\/$/, "")}/inventory/agent/lookup`;
  try {
    const { data } = await axios.post(url, {
      integrationId,
      companyId,
      text: args.text,
      filtros: args.filtros || {},
      page: args.page || 1,
      pageSize: args.pageSize || 10
    });
    return data; // { items, total, ... }
  } catch (err: any) {
    logger.error({ err }, "Erro ao executar integração");
    return { error: "IntegrationExecutionFailed", message: err?.message || "Falha na execução" };
  }
}

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
    __dirname, "..", "..", "..", "public", `company${ticket.companyId}`
  );

  // cache de sessão do OpenAI v4
  let openai: SessionOpenAi;
  const idx = sessionsOpenAi.findIndex(s => s.id === ticket.id);
  if (idx === -1) {
    openai = new OpenAI({ apiKey: openAiSettings.apiKey }) as SessionOpenAi;
    openai.id = ticket.id;
    sessionsOpenAi.push(openai);
  } else {
    openai = sessionsOpenAi[idx];
  }

  // histórico como sempre
  const messages = await Message.findAll({
    where: { ticketId: ticket.id },
    order: [["createdAt", "ASC"]],
    limit: openAiSettings.maxMessages
  });

  const promptSystem = `Você é um agente de atendimento multiempresas (SaaS).
Use o nome ${sanitizeName(contact.name || "Amigo(a)")} para personalizar.
Respeite o limite de ${openAiSettings.maxTokens} tokens.
Se precisar transferir, comece com 'Ação: Transferir para o setor de atendimento'.
Quando houver integrações disponíveis, você pode chamá-las para obter dados reais.\n
${openAiSettings.prompt}\n`;

  let messagesOpenAi: Array<{ role: "system" | "user" | "assistant" | "tool"; content: string; tool_call_id?: string }> = [];
  messagesOpenAi.push({ role: "system", content: promptSystem });

  for (const m of messages) {
    if (m.mediaType === "conversation" || m.mediaType === "extendedTextMessage") {
      messagesOpenAi.push({
        role: m.fromMe ? "assistant" : "user",
        content: m.body
      });
    }
  }
  messagesOpenAi.push({ role: "user", content: bodyMessage! });

  // tools dinâmicas
  const tools = await buildTools(ticket.companyId);

  // 1ª chamada — com tools
  const chat = await openai.chat.completions.create({
    model: openAiSettings.model || "gpt-4o-mini",
    messages: messagesOpenAi as any,
    tools,
    tool_choice: "auto",
    max_tokens: openAiSettings.maxTokens,
    temperature: openAiSettings.temperature
  });

  let response = chat.choices?.[0]?.message?.content;

  // Se o modelo pedir tools, executa e refaz a completion
  if (chat.choices?.[0]?.message?.tool_calls) {
    for (const call of chat.choices[0].message.tool_calls) {
      const fnName = call.function.name; // "integration_7"
      const args = JSON.parse(call.function.arguments || "{}");
      const integrationId = parseInt(fnName.replace("integration_", ""), 10);

      const result = await executeIntegration(integrationId, args, ticket.companyId);

      messagesOpenAi.push({
        role: "tool",
        tool_call_id: call.id,
        content: JSON.stringify(result)
      });
    }

    const chat2 = await openai.chat.completions.create({
      model: openAiSettings.model || "gpt-4o-mini",
      messages: messagesOpenAi as any,
      max_tokens: openAiSettings.maxTokens,
      temperature: openAiSettings.temperature
    });

    response = chat2.choices?.[0]?.message?.content;
  }

  // Transferência automática, se o modelo pedir
  if (response?.includes("Ação: Transferir para o setor de atendimento")) {
    await transferQueue(openAiSettings.queueId, ticket, contact);
    response = response.replace("Ação: Transferir para o setor de atendimento", "").trim();
  }

  // envio da resposta
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
};
