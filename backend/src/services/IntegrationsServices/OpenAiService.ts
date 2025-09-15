// backend/src/services/IntegrationsServices/OpenAiService.ts
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

import OpenAI from "openai";
import Ticket from "../../models/Ticket";
import Contact from "../../models/Contact";
import Message from "../../models/Message";
import TicketTraking from "../../models/TicketTraking";
import { logger } from "../../utils/logger";
import InventoryIntegration from "../../models/InventoryIntegration";
import axios from "axios";
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
  model?: string;
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

/**
 * Gera a lista de tools a partir das integrações cadastradas no companyId
 */

async function buildTools(companyId: number): Promise<ChatCompletionTool[]> {
  const integrations = await InventoryIntegration.findAll({ where: { companyId } });
  return integrations.map((i) =>
    ({
      type: "function", // agora literal
      function: {
        name: `integration_${i.get("id")}`,
        description: `Consulta integração cadastrada: ${i.get("name")}`,
        parameters: {
          type: "object",
          properties: {
            text: { type: "string", description: "Texto ou critério de busca fornecido pelo cliente" },
            filtros: { type: "object", description: "Filtros adicionais (preço, bairro, modelo, etc.)" },
            page: { type: "integer", description: "Página da busca" },
            pageSize: { type: "integer", description: "Itens por página" }
          },
          required: ["text"]
        }
      }
    }) as ChatCompletionTool // 👈 força o tipo certo
  );
}

/**
 * Executa uma integração específica via /inventory/agent/lookup
 */
async function executeIntegration(
  integrationId: number,
  args: any,
  companyId: number
) {
  try {
    const result = await axios.post(
      `${process.env.BACKEND_URL || "http://localhost:3000"}/inventory/agent/lookup`,
      {
        integrationId,
        companyId,
        text: args.text,
        filtros: args.filtros || {},
        page: args.page || 1,
        pageSize: args.pageSize || 10
      }
    );
    return result.data;
  } catch (err: any) {
    logger.error({ err }, "Erro ao executar integração");
    return { error: "IntegrationExecutionFailed", message: err.message };
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
    __dirname,
    "..",
    "..",
    "..",
    "public",
    `company${ticket.companyId}`
  );

  // --------- Session cache (OpenAI v4) ----------
  let openai: SessionOpenAi;
  const idx = sessionsOpenAi.findIndex((s) => s.id === ticket.id);
  if (idx === -1) {
    openai = new OpenAI({ apiKey: openAiSettings.apiKey }) as SessionOpenAi;
    openai.id = ticket.id;
    sessionsOpenAi.push(openai);
  } else {
    openai = sessionsOpenAi[idx];
  }
  // ---------------------------------------------

  const messages = await Message.findAll({
    where: { ticketId: ticket.id },
    order: [["createdAt", "ASC"]],
    limit: openAiSettings.maxMessages
  });

  const promptSystem = `Você é um agente de atendimento. 
Use o nome ${sanitizeName(contact.name || "Amigo(a)")} para personalizar. 
Respeite o limite de ${openAiSettings.maxTokens} tokens. 
Sempre que possível, mencione o nome do cliente. 
Se precisar transferir, comece com 'Ação: Transferir para o setor de atendimento'.\n
${openAiSettings.prompt}\n`;

  let messagesOpenAi: Array<any> = [];
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

  const tools = await buildTools(ticket.companyId);

  const chat = await openai.chat.completions.create({
    model: openAiSettings.model || "gpt-4o-mini",
    messages: messagesOpenAi,
    tools, // ✅ agora compatível com ChatCompletionTool[]
    tool_choice: "auto",
    max_tokens: openAiSettings.maxTokens,
    temperature: openAiSettings.temperature
  });

  let response = chat.choices?.[0]?.message?.content;

  // Se houver tool_calls → executar e refazer completion
  if (chat.choices?.[0]?.message?.tool_calls) {
    for (const call of chat.choices[0].message.tool_calls) {
      const fnName = call.function.name; // ex.: integration_7
      const args = JSON.parse(call.function.arguments || "{}");
      const integrationId = parseInt(fnName.replace("integration_", ""), 10);

      const result = await executeIntegration(integrationId, args, ticket.companyId);

      messagesOpenAi.push({
        role: "tool",
        tool_call_id: call.id,
        content: JSON.stringify(result)
      });
    }

    // refazer completion agora com os resultados das integrações
    const chat2 = await openai.chat.completions.create({
      model: openAiSettings.model || "gpt-4o-mini",
      messages: messagesOpenAi,
      max_tokens: openAiSettings.maxTokens,
      temperature: openAiSettings.temperature
    });

    response = chat2.choices?.[0]?.message?.content;
  }

  // Transferência automática
  if (response?.includes("Ação: Transferir para o setor de atendimento")) {
    await transferQueue(openAiSettings.queueId, ticket, contact);
    response = response.replace("Ação: Transferir para o setor de atendimento", "").trim();
  }

  // enviar resposta
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
