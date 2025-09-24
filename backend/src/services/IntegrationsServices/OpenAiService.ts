// backend/src/services/IntegrationsServices/OpenAiService.ts
import { proto, WASocket } from "baileys";
// ❌ removidos imports inexistentes de ../WbotServices/wbotMessageListener

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
import { randomUUID } from "crypto";
import jwt from "jsonwebtoken";

type Session = WASocket & { id?: number };
type SessionOpenAi = OpenAI & { id?: number };
const sessionsOpenAi: SessionOpenAi[] = [];

interface IOpenAi {
  name: string;
  prompt: string;
  voice: string;       // "texto" = sem TTS
  voiceKey: string;
  voiceRegion: string;
  maxTokens: number;
  temperature: number;
  apiKey: string;
  queueId: number;
  maxMessages: number;
  model?: string;      // default gpt-4o-mini
}

const deleteFileSync = (p: string): void => {
  try { fs.unlinkSync(p); } catch {}
};

const sanitizeName = (name: string): string => {
  let sanitized = (name || "").split(" ")[0];
  sanitized = sanitized.replace(/[^a-zA-Z0-9]/g, "");
  return sanitized.substring(0, 60);
};

// === helpers locais (compat) ===
const keepOnlySpecifiedChars = (text: string): string =>
  (text || "").replace(/[^\p{L}\p{N}\s\.,;:!?\-@#%&()\[\]'"\/\\_]/gu, "").trim();

const getBodyMessage = (msg: proto.IWebMessageInfo): string | undefined => {
  if (!msg?.message) return undefined;
  const m: any = msg.message;
  return m.conversation || m.extendedTextMessage?.text || m.ephemeralMessage?.message?.extendedTextMessage?.text;
};

/** Import dinâmico e opcional dos helpers do listener (se existirem no projeto) */
async function getWbotHelpers() {
  try {
    // @ts-ignore
    const dynImport = (Function("p", "return import(p)")) as (p: string) => Promise<any>;
    const mod = await dynImport("../WbotServices/wbotMessageListener");
    const anyMod = mod || {};
    return {
      transferQueue: anyMod.transferQueue as (queueId: number, ticket: Ticket, contact: Contact) => Promise<void>,
      verifyMessage: anyMod.verifyMessage as (m: any, t: Ticket, c: Contact) => Promise<void>,
      verifyMediaMessage: anyMod.verifyMediaMessage as (m: any, t: Ticket, c: Contact, tr: TicketTraking, a: boolean, b: boolean, w: WASocket) => Promise<void>,
      convertTextToSpeechAndSaveToFile:
        anyMod.convertTextToSpeechAndSaveToFile as (
          text: string,
          basePath: string,
          voiceKey: string,
          voiceRegion: string,
          voice: string,
          ext: "mp3" | "wav"
        ) => Promise<void>
    };
  } catch {
    return {
      transferQueue: undefined,
      verifyMessage: undefined,
      verifyMediaMessage: undefined,
      convertTextToSpeechAndSaveToFile: undefined
    };
  }
}

/** Assina um JWT de serviço para /inventory/agent/lookup */
function makeServiceBearer(companyId: number): string {
  const secret =
    process.env.SERVICE_JWT_SECRET ||
    process.env.JWT_SECRET ||
    process.env.JWT_KEY;

  if (!secret) {
    logger.error(
      { ctx: "OpenAiService", step: "makeServiceBearer", companyId },
      "JWT secret ausente (defina SERVICE_JWT_SECRET ou JWT_SECRET)"
    );
    return "";
  }

  const payload: any = {
    id: 0,
    name: "inventory-bot",
    email: "inventory-bot@system.local",
    profile: "admin",
    companyId
  };

  return `Bearer ${jwt.sign(payload, secret, { expiresIn: "5m" })}`;
}

/** Gera tools dinamicamente com base nas integrações da empresa */
async function buildTools(companyId: number): Promise<ChatCompletionTool[]> {
  const integrations = await InventoryIntegration.findAll({ where: { companyId } });
  const tools = integrations.map((i) =>
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

  logger.info(
    { ctx: "OpenAiService", companyId, tools: tools.map(t => t.function?.name) },
    "tools built from integrations"
  );

  return tools;
}

/** Executa a integração via /inventory/agent/lookup */
async function executeIntegration(
  integrationId: number,
  args: any,
  companyId: number
) {
  const base = (process.env.BACKEND_URL || "").replace(/\/$/, "");
  const url = base ? `${base}/inventory/agent/lookup` : `http://127.0.0.1:3000/inventory/agent/lookup`;

  const t0 = Date.now();
  try {
    const bearer = makeServiceBearer(companyId);
    const { data } = await axios.post(
      url,
      {
        integrationId,
        companyId,
        text: args.text,
        filtros: args.filtros || {},
        page: args.page || 1,
        pageSize: args.pageSize || 10
      },
      {
        headers: {
          Authorization: bearer,
          "Content-Type": "application/json",
          Accept: "application/json"
        },
        timeout: 10000,
        validateStatus: () => true
      }
    );

    const tookMs = Date.now() - t0;

    if ((data as any)?.statusCode === 401 || (data as any)?.error === "ERR_SESSION_EXPIRED") {
      logger.warn(
        { ctx: "OpenAiService", step: "executeIntegration:unauthorized", integrationId, tookMs },
        "inventory/agent/lookup não autorizada"
      );
    }

    logger.info(
      {
        ctx: "OpenAiService",
        step: "executeIntegration:response",
        integrationId,
        tookMs,
        total: (data as any)?.total ?? (data as any)?.items?.length ?? 0,
        hasError: !!(data as any)?.error
      },
      "integration executed"
    );

    return data; // { items, total, ... }
  } catch (err: any) {
    const tookMs = Date.now() - t0;
    logger.error(
      {
        ctx: "OpenAiService",
        step: "executeIntegration:error",
        integrationId,
        tookMs,
        error: err?.message,
        status: err?.response?.status,
        data: err?.response?.data
      },
      "integration execution failed"
    );
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
  try {
    if (contact.disableBot) return;

    const bodyMessage = getBodyMessage(msg);
    if (!bodyMessage) return;
    if (!openAiSettings) return;
    if (msg.messageStubType) return;

    const corrId = `${ticket.id}:${randomUUID()}`;

    logger.info(
      { corrId, ctx: "OpenAiService", step: "incoming", ticketId: ticket.id, companyId: ticket.companyId, from: contact.number, hasText: !!bodyMessage },
      "wa_incoming"
    );

    const publicFolder: string = path.resolve(__dirname, "..", "..", "..", "public", `company${ticket.companyId}`);

    // cache de sessão do OpenAI v4
    let openai: SessionOpenAi;
    const idx = sessionsOpenAi.findIndex(s => s.id === ticket.id);
    if (idx === -1) {
      openai = new OpenAI({ apiKey: openAiSettings.apiKey }) as SessionOpenAi;
      openai.id = ticket.id;
      sessionsOpenAi.push(openai);
      logger.debug({ corrId, ctx: "OpenAiService", ticketId: ticket.id }, "created OpenAI session");
    } else {
      openai = sessionsOpenAi[idx];
    }

    // histórico
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

    // tools dinâmicas a partir das integrações
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

    // helpers opcionais do listener
    const { transferQueue, verifyMessage, verifyMediaMessage, convertTextToSpeechAndSaveToFile } = await getWbotHelpers();

    // Transferência automática, se o modelo pedir
    if (response?.includes("Ação: Transferir para o setor de atendimento") && transferQueue) {
      await transferQueue(openAiSettings.queueId, ticket, contact);
      response = response.replace("Ação: Transferir para o setor de atendimento", "").trim();
    }

    // envio da resposta
    if (openAiSettings.voice === "texto" || !convertTextToSpeechAndSaveToFile) {
      const sentMessage = await wbot.sendMessage(msg.key.remoteJid!, { text: `\u200e ${response || ""}` });
      if (verifyMessage) await verifyMessage(sentMessage!, ticket, contact);
    } else {
      const fileName = `${ticket.id}_${Date.now()}`;
      await convertTextToSpeechAndSaveToFile(
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
          if (verifyMediaMessage) {
            await verifyMediaMessage(sendMessage!, ticket, contact, ticketTraking, false, false, wbot);
          }
          deleteFileSync(`${publicFolder}/${fileName}.mp3`);
        } catch (error) {
          logger.error({ ctx: "OpenAiService", ticketId: ticket.id, error }, "audio send error");
        }
      });
    }
  } catch (err: any) {
    logger.error({ ctx: "OpenAiService", err }, "unhandled error in OpenAiService");
  }
};
