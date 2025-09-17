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

// --------------------------------------------------
// Helpers de Inventário
// --------------------------------------------------

/** Formata a lista de itens para texto curto e útil no WhatsApp */
function formatInventoryReply(payload: {
  integrationName?: string;
  categoryHint?: string;
  criteria?: any;
  items?: any[];
  page?: number;
  pageSize?: number;
  total?: number;
}) {
  const items = Array.isArray(payload.items) ? payload.items : [];
  const headerParts: string[] = [];

  const cat = (payload.categoryHint || "").toString().toLowerCase();
  if (cat) headerParts.push(cat);

  const crit = payload.criteria || {};
  const loc: string[] = [];
  if (crit.neighborhood) loc.push(String(crit.neighborhood));
  if (crit.city) loc.push(String(crit.city));
  if (crit.state) loc.push(String(crit.state));
  if (loc.length) headerParts.push(loc.join(", "));

  const header =
    headerParts.length
      ? `Encontrei algumas opções de ${headerParts.join(" em ")}:\n`
      : "Encontrei algumas opções:\n";

  const fmtMoney = (v: any) => {
    const n = typeof v === "number" ? v : Number(String(v).replace(/\D/g, ""));
    if (!isFinite(n) || n <= 0) return "";
    return `R$ ${n.toLocaleString("pt-BR")}`;
  };

  const lines = items.slice(0, payload.pageSize || 5).map((it: any, idx: number) => {
    const title =
      it.TituloSite || it.titulo || it.title || it.Categoria || `Item ${idx + 1}`;
    const bairro = it.Bairro || it.bairro;
    const cidade = it.Cidade || it.cidade;
    const preco = it.ValorVenda ?? it.preco ?? it.Preco ?? it.valor;

    const where = [bairro, cidade].filter(Boolean).join(", ");
    const price = fmtMoney(preco);
    const parts: string[] = [`• ${title}`];
    if (where) parts.push(` – ${where}`);
    if (price) parts.push(` – ${price}`);
    return parts.join("");
  });

  const more =
    payload.total && (payload.pageSize || 5) < payload.total
      ? `\n\nQuer ver mais opções? É só mandar: "ver mais".`
      : "";

  return header + lines.join("\n") + more;
}

/** Chama o /inventory/agent/auto do próprio backend */
async function tryInventoryAuto(companyId: number, text: string, page = 1, pageSize = 5) {
  const base = (process.env.BACKEND_URL || "http://localhost:3000").replace(/\/$/, "");
  const url = `${base}/inventory/agent/auto`;

  const t0 = Date.now();
  try {
    const { data } = await axios.post(url, { companyId, text, page, pageSize });
    logger.info(
      {
        ctx: "OpenAiService",
        step: "auto_lookup_ok",
        tookMs: Date.now() - t0,
        matched: !!data?.matched,
        items: Array.isArray(data?.items) ? data.items.length : 0
      },
      "auto lookup"
    );
    return data;
  } catch (err: any) {
    logger.warn(
      {
        ctx: "OpenAiService",
        step: "auto_lookup_fail",
        tookMs: Date.now() - t0,
        error: err?.message,
        status: err?.response?.status
      },
      "auto lookup failed"
    );
    return null;
  }
}

/** Gera tools dinamicamente com base nas integrações da empresa */
async function buildTools(companyId: number): Promise<ChatCompletionTool[]> {
  const integrations = await InventoryIntegration.findAll({ where: { companyId } });
  const tools = integrations.map((i) =>
    ({
      type: "function",
      function: {
        name: `integration_${i.get("id")}`,
        description: `Consulta dados reais na integração "${i.get("name")}" (categoria: ${i.get("categoryHint") || "geral"}). Use quando o cliente pedir itens dessa categoria.`,
        parameters: {
          type: "object",
          properties: {
            text: { type: "string", description: "Texto/critério de busca do cliente" },
            filtros: { type: "object", description: "Filtros (ex.: bairro, quartos, preçoMax...)" },
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

/** Executa a integração via /inventory/agent/lookup */
async function executeIntegration(
  integrationId: number,
  args: any,
  companyId: number
) {
  const url = `${(process.env.BACKEND_URL || "http://localhost:3000").replace(/\/$/, "")}/inventory/agent/lookup`;

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

    const tookMs = Date.now() - t0;

    logger.info({
      ctx: "OpenAiService",
      step: "executeIntegration:response",
      integrationId,
      tookMs,
      total: data?.total ?? data?.items?.length ?? 0,
      hasError: !!data?.error
    }, "integration executed");

    return data; // { items, total, ... }
  } catch (err: any) {
    const tookMs = Date.now() - t0;
    logger.error({
      ctx: "OpenAiService",
      step: "executeIntegration:error",
      integrationId,
      tookMs,
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

    // cache de sessão do OpenAI v4
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

    // ------------------------------------------------------------------
    // 1) FAST-PATH: tenta inventário automático antes da LLM
    // ------------------------------------------------------------------
    const auto = await tryInventoryAuto(ticket.companyId, bodyMessage, 1, 5);
    if (auto?.matched && Array.isArray(auto.items) && auto.items.length) {
      const reply = formatInventoryReply({
        integrationName: auto.integrationName,
        categoryHint: auto.categoryHint,
        criteria: auto.criteria,
        items: auto.items,
        page: auto.page,
        pageSize: auto.pageSize,
        total: auto.total
      });

      const sentMessage = await wbot.sendMessage(msg.key.remoteJid!, { text: `\u200e ${reply}` });
      await verifyMessage(sentMessage!, ticket, contact);

      logger.info(
        { ctx: "OpenAiService", step: "auto_reply_sent", ticketId: ticket.id, count: auto.items.length },
        "auto inventory reply sent"
      );
      return; // não precisa LLM neste caso
    }
    // ------------------------------------------------------------------

    // histórico (para a LLM se precisar)
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

    // tools dinâmicas (plano B da LLM)
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

    logger.info({
      ctx: "OpenAiService",
      step: "llm_pass_1",
      ticketId: ticket.id,
      openaiId: chat.id,
      hasToolCalls: !!chat.choices?.[0]?.message?.tool_calls?.length,
      toolCalls: chat.choices?.[0]?.message?.tool_calls?.map(t => t.function?.name) || []
    }, "first completion result");

    let response = chat.choices?.[0]?.message?.content;

    // Se o modelo pedir tools, executa e refaz a completion
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

    // Transferência automática, se o modelo pedir
    if (response?.includes("Ação: Transferir para o setor de atendimento")) {
      logger.warn({ ctx: "OpenAiService", ticketId: ticket.id }, "model requested transfer");
      await transferQueue(openAiSettings.queueId, ticket, contact);
      response = response.replace("Ação: Transferir para o setor de atendimento", "").trim();
    }

    // envio da resposta
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
