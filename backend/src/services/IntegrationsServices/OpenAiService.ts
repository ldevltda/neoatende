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
  model?: string; // default gpt-4o-mini
}

const deleteFileSync = (p: string): void => {
  try { fs.unlinkSync(p); } catch {}
};

const sanitizeName = (name: string): string => {
  let sanitized = (name || "").split(" ")[0];
  sanitized = sanitized.replace(/[^a-zA-Z0-9]/g, "");
  return sanitized.substring(0, 60);
};

/** ========= helpers de Inventory/Auto ========= */
const BASE_URL = (process.env.BACKEND_URL || "http://localhost:3000").replace(/\/$/, "");

async function tryAutoInventory(companyId: number, text: string, page = 1, pageSize = 5) {
  const url = `${BASE_URL}/inventory/agent/auto`;
  const t0 = Date.now();
  try {
    const { data } = await axios.post(url, { companyId, text, page, pageSize });
    logger.info({
      ctx: "OpenAiService",
      step: "tryAutoInventory:response",
      tookMs: Date.now() - t0,
      matched: !!data?.matched,
      total: data?.total ?? data?.items?.length ?? 0,
      integrationId: data?.integrationId
    }, "auto ok");
    return data;
  } catch (err: any) {
    logger.error({
      ctx: "OpenAiService",
      step: "tryAutoInventory:error",
      error: err?.message,
      status: err?.response?.status,
      data: err?.response?.data
    }, "auto fail");
    return null;
  }
}

function pickText(o: any, keys: string[], def = "") {
  for (const k of keys) {
    const v = o?.[k];
    if (v !== undefined && v !== null && String(v).trim() !== "") return String(v);
  }
  return def;
}

function formatInventoryItemsForReply(items: any[], categoryHint?: string) {
  if (!Array.isArray(items) || !items.length) return "";

  const lines: string[] = [];
  const header = categoryHint
    ? `Encontrei ${items.length} ${categoryHint.toLowerCase()} que combinam com o que você pediu:\n`
    : `Encontrei ${items.length} opções que combinam com o que você pediu:\n`;
  lines.push(header);

  const max = Math.min(items.length, 5);
  for (let i = 0; i < max; i++) {
    const it = items[i];
    // campos típicos do Vista
    const titulo = pickText(it, ["TituloSite", "Titulo", "title", "Descricao", "Descrição"], "Opção");
    const bairro = pickText(it, ["Bairro", "bairro"]);
    const cidade = pickText(it, ["Cidade", "cidade"]);
    const estado = pickText(it, ["Estado", "estado", "UF"]);
    const codigo = pickText(it, ["Codigo", "Código", "codigo", "id"]);
    const preco =
      pickText(it, ["ValorVenda", "Preco", "Preço", "price"])
        .replace(/\B(?=(\d{3})+(?!\d))/g, "."); // separador simples

    const loc = [bairro, cidade, estado].filter(Boolean).join(" • ");
    const line =
      `• ${titulo}${loc ? `\n   📍 ${loc}` : ""}${preco ? `\n   💰 R$ ${preco}` : ""}${codigo ? `\n   #${codigo}` : ""}`;
    lines.push(line);
  }
  if (items.length > max) {
    lines.push(`\nQuer ver mais opções? Posso listar a próxima página 😉`);
  }
  return lines.join("\n");
}

/** ========= Tools dinâmicas (mantidas) ========= */
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

  logger.debug({
    ctx: "OpenAiService",
    companyId,
    tools: tools.map(t => t.function?.name)
  }, "tools built from integrations");

  return tools;
}

/** Executa a integração via /inventory/agent/lookup (mantido para tool-call) */
async function executeIntegration(
  integrationId: number,
  args: any,
  companyId: number
) {
  const url = `${BASE_URL}/inventory/agent/lookup`;

  logger.info({
    ctx: "OpenAiService",
    step: "executeIntegration:request",
    integrationId,
    companyId,
    args
  }, "calling InventoryAgentController");

  const t0 = Date.now();
  try {
    const { data } = await axios.post(url, {
      integrationId,
      companyId,
      text: args.text,
      filtros: args.filtros || {},
      page: args.page || 1,
      pageSize: args.pageSize || 10
    });

    logger.info({
      ctx: "OpenAiService",
      step: "executeIntegration:response",
      integrationId,
      tookMs: Date.now() - t0,
      total: data?.total ?? data?.items?.length ?? 0,
      hasError: !!data?.error
    }, "integration executed");

    return data;
  } catch (err: any) {
    logger.error({
      ctx: "OpenAiService",
      step: "executeIntegration:error",
      integrationId,
      error: err?.message,
      status: err?.response?.status,
      data: err?.response?.data
    }, "integration execution failed");
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

    logger.info({
      ctx: "OpenAiService",
      step: "incoming",
      ticketId: ticket.id,
      companyId: ticket.companyId,
      from: contact.number,
      hasText: !!bodyMessage
    }, "incoming WA message");

    const publicFolder: string = path.resolve(
      __dirname, "..", "..", "..", "public", `company${ticket.companyId}`
    );

    // ❶ PRIMEIRO: tenta auto-rotear + pós-filtrar
    const auto = await tryAutoInventory(ticket.companyId, bodyMessage, 1, 5);
    if (auto?.matched && Array.isArray(auto.items) && auto.items.length) {
      const reply = formatInventoryItemsForReply(auto.items, auto.categoryHint);
      const sent = await wbot.sendMessage(msg.key.remoteJid!, { text: `\u200e ${reply}` });
      await verifyMessage(sent!, ticket, contact);
      logger.info({
        ctx: "OpenAiService",
        step: "auto_reply_sent",
        ticketId: ticket.id,
        listed: auto.items.length
      }, "sent auto-reply");
      return;
    }

    // ❷ Se não houve match, seguimos com o LLM normal + tools como fallback
    let openai: SessionOpenAi;
    const idx = sessionsOpenAi.findIndex(s => s.id === ticket.id);
    if (idx === -1) {
      openai = new OpenAI({ apiKey: openAiSettings.apiKey }) as SessionOpenAi;
      openai.id = ticket.id;
      sessionsOpenAi.push(openai);
      logger.debug({ ctx: "OpenAiService", ticketId: ticket.id }, "created OpenAI session");
    } else {
      openai = sessionsOpenAi[idx];
    }

    const messages = await Message.findAll({
      where: { ticketId: ticket.id },
      order: [["createdAt", "ASC"]],
      limit: openAiSettings.maxMessages
    });

    const promptSystem = `Você é um agente de atendimento multiempresas (SaaS).
Use o nome ${sanitizeName(contact.name || "Amigo(a)")} para personalizar.
Respeite ${openAiSettings.maxTokens} tokens.
Se precisar transferir, comece com 'Ação: Transferir para o setor de atendimento'.
Quando houver integrações disponíveis, você PODE CHAMAR as ferramentas para buscar dados reais e listar opções ao cliente (ex.: imóveis). 
Retorne respostas diretas e úteis, sem burocracia.\n
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

    const tools = await buildTools(ticket.companyId);

    const chat = await openai.chat.completions.create({
      model: openAiSettings.model || "gpt-4o-mini",
      messages: messagesOpenAi as any,
      tools,
      tool_choice: "auto",
      max_tokens: openAiSettings.maxTokens,
      temperature: openAiSettings.temperature
    });

    logger.info({
      ctx: "OpenAiService",
      step: "llm_pass_1",
      ticketId: ticket.id,
      openaiId: chat.id,
      hasToolCalls: !!chat.choices?.[0]?.message?.tool_calls?.length,
      toolCalls: chat.choices?.[0]?.message?.tool_calls?.map(t => t.function?.name) || []
    }, "first completion result");

    let response = chat.choices?.[0]?.message?.content;

    if (chat.choices?.[0]?.message?.tool_calls) {
      for (const call of chat.choices[0].message.tool_calls) {
        const fnName = call.function.name; // "integration_7"
        const args = JSON.parse(call.function.arguments || "{}");
        const integrationId = parseInt(fnName.replace("integration_", ""), 10);

        logger.info({
          ctx: "OpenAiService",
          step: "tool_call_execute",
          ticketId: ticket.id,
          integrationId,
          args
        }, "executing tool_call");

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

      logger.info({
        ctx: "OpenAiService",
        step: "llm_pass_2",
        ticketId: ticket.id,
        openaiId: chat2.id
      }, "second completion result");

      response = chat2.choices?.[0]?.message?.content;
    }

    if (response?.includes("Ação: Transferir para o setor de atendimento")) {
      logger.warn({ ctx: "OpenAiService", ticketId: ticket.id }, "model requested transfer");
      await transferQueue(openAiSettings.queueId, ticket, contact);
      response = response.replace("Ação: Transferir para o setor de atendimento", "").trim();
    }

    if (openAiSettings.voice === "texto") {
      const sentMessage = await wbot.sendMessage(msg.key.remoteJid!, {
        text: `\u200e ${response || ""}`
      });
      await verifyMessage(sentMessage!, ticket, contact);
      logger.info({ ctx: "OpenAiService", ticketId: ticket.id }, "text sent");
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
          logger.info({ ctx: "OpenAiService", ticketId: ticket.id }, "audio sent");
        } catch (error) {
          logger.error({ ctx: "OpenAiService", ticketId: ticket.id, error }, "audio send error");
        }
      });
    }
  } catch (err: any) {
    logger.error({ ctx: "OpenAiService", err }, "unhandled error in OpenAiService");
  }
};
