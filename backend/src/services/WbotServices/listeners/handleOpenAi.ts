// backend/src/services/WbotServices/listeners/handleOpenAi.ts
import OpenAI from "openai";
import { Planner } from "../../AI/Planner";
import { loadState, saveState } from "../../InventoryServices/ConversationState";
import OpenAIRolemapService from "../../InventoryServices/OpenAIRolemapService";
import { sanitizeName, keepOnlySpecifiedChars, ensurePublicFolder, deleteFileSync } from "./helpers";
import ffmpeg from "fluent-ffmpeg";
import fs from "fs";
import axios from "axios";
import { logger } from "../../../utils/logger";
import { proto } from "baileys";

interface ChatMsg { role: "system" | "user" | "assistant"; content: string; }

const sessionsOpenAi: { id?: number; client: OpenAI }[] = [];

/** Wrapper: converte o OpenAIRolemapService (objeto) em uma função simples que retorna string */
async function simpleReply(args: { systemRole: string; userText: string; fallback: string }): Promise<string> {
  try {
    // O default export é um objeto com método inferFromSamplePayload
    const res: any = await OpenAIRolemapService.inferFromSamplePayload({
      sample: {
        systemRole: args.systemRole,
        userText: args.userText
      }
    });
    // tenta extrair o texto em diferentes campos comuns
    return res?.text ?? res?.reply ?? res?.message ?? args.fallback;
  } catch {
    return args.fallback;
  }
}

export async function handleOpenAi(
  msg: proto.IWebMessageInfo,
  wbot: any,
  ticket: any,
  contact: any,
  mediaSent?: any,
  ticketTraking?: any,
  openAiSettings: any = null
): Promise<void> {
  if (contact?.disableBot) return;

  const bodyMessage =
    msg && msg.message
      ? ((msg.message.conversation || msg.message.extendedTextMessage?.text) as string)
      : "";

  if (!bodyMessage) return;

  const text = (bodyMessage || "").trim();

  const whatsappConn = await (await import("../../WhatsappService/ShowWhatsAppService"))
    .default(wbot.id, ticket.companyId)
    .catch(() => null);

  let prompt = whatsappConn?.prompt || null;
  if (openAiSettings) prompt = openAiSettings;
  if (!prompt && !ticket?.queue?.prompt) prompt = ticket?.queue?.prompt;

  const isGreet = /\b(oi|ola|ol[aá]|opa|e ai|eae|fala|bom dia|boa tarde|boa noite|tudo bem|td bem|como vai)\b/i.test(text);

  if (!prompt) {
    if (isGreet) {
      const sentMessage = await wbot.sendMessage(msg.key.remoteJid!, {
        text: buildDefaultGreeting(contact?.name, process.env.BRAND_NAME || process.env.APP_NAME)
      });
      const { verifyMessage } = await import("./mediaHelpers").catch(() => ({ verifyMessage: null as any }));
      if (verifyMessage) await verifyMessage(sentMessage, ticket, contact);
      return;
    }

    const sentMessage = await wbot.sendMessage(msg.key.remoteJid!, {
      text: [
        "Oi! 👋",
        "Posso te ajudar com dúvidas ou buscar informações/alternativas para você.",
        "Se puder, me dê alguns detalhes (ex.: o que procura, faixa de valor, prazo) que eu já avanço por aqui."
      ].join("\n")
    });
    const { verifyMessage } = await import("./mediaHelpers").catch(() => ({ verifyMessage: null as any }));
    if (verifyMessage) await verifyMessage(sentMessage, ticket, contact);
    return;
  }

  if (msg.messageStubType) return;

  // ===== inventory via Planner =====
  try {
    const planner = new Planner(prompt?.apiKey);
    const existing: any = (await loadState(ticket)) || { mode: "smalltalk", page: 1, pageSize: 5, slots: {} };

    const textNorm = String(text || "").trim();

    const isGreeting = (s: string) =>
      /\b(oi|ola|ol[aá]|opa|e ai|eae|fala|bom dia|boa tarde|boa noite|tudo bem|td bem|como vai)\b/i.test(s);
    const isThanks = (s: string) => /\b(obrigad[oa]|vlw|valeu|thanks)\b/i.test(s);
    const likelyInventory = (s: string) =>
      /\b(produto|item|lista|listar|im[óo]vel|venda|aluguel|pre[çc]o|preco)\b/i.test(s);

    if (isGreeting(textNorm) && existing.mode !== "inventory") {
      const welcome = await simpleReply({
        systemRole: "Você é um atendente imobiliário simpático, breve e objetivo.",
        userText: textNorm,
        fallback: "Olá! Tudo bem? Posso te ajudar a encontrar um imóvel. Prefere aluguel ou compra?"
      });
      await saveState(ticket as any, { ...existing, mode: "smalltalk" } as any);
      const sent = await wbot.sendMessage(msg.key.remoteJid!, { text: welcome });
      const { verifyMessage } = await import("./mediaHelpers").catch(() => ({ verifyMessage: null as any }));
      if (verifyMessage) await verifyMessage(sent, ticket, contact);
      return;
    }

    if (isThanks(textNorm) && !likelyInventory(textNorm)) {
      const thanks = await simpleReply({
        systemRole: "Você é um atendente cordial.",
        userText: textNorm,
        fallback: "Imagina! Qualquer coisa é só falar 😊"
      });
      const sent = await wbot.sendMessage(msg.key.remoteJid!, { text: thanks });
      const { verifyMessage } = await import("./mediaHelpers").catch(() => ({ verifyMessage: null as any }));
      if (verifyMessage) await verifyMessage(sent, ticket, contact);
      return;
    }

    const plan: any = await planner.infer(textNorm, existing.slots || {});
    logger.info({ ctx: "Planner", plan }, "planner-output");

    const intent = String(plan?.intent || "");

    if (intent === "browse_inventory" && existing.mode !== "inventory" && !likelyInventory(textNorm)) {
      const reply = await simpleReply({
        systemRole: "Você é um atendente humano e natural.",
        userText: textNorm,
        fallback: "Me conta rapidinho: cidade/bairro, tipo do imóvel e um orçamento aproximado?"
      });
      await saveState(ticket as any, { ...existing, mode: "smalltalk" } as any);
      const sent = await wbot.sendMessage(msg.key.remoteJid!, { text: reply });
      const { verifyMessage } = await import("./mediaHelpers").catch(() => ({ verifyMessage: null as any }));
      if (verifyMessage) await verifyMessage(sent, ticket, contact);
      return;
    }

    // book_visit handling
    if (intent === "book_visit") {
      const idx = plan?.slots?.indice || plan?.slots?.numero || null;
      const last = existing.lastList || [];
      const mapping = existing.lastMapping || {};

      if (!idx) {
        const ask =
          "Perfeito! Qual opção você quer visitar? Pode me dizer o número (1, 2, 3...) ou enviar o link.";
        const sent = await wbot.sendMessage(msg.key.remoteJid!, { text: ask });
        const { verifyMessage } = await import("./mediaHelpers").catch(() => ({ verifyMessage: null as any }));
        if (verifyMessage) await verifyMessage(sent, ticket, contact);
        await saveState(ticket as any, { ...existing, mode: "booking" } as any);
        return;
      }
      const key = mapping[Number(idx)];
      const chosen =
        last.find((i: any) => i.codigo === key || i.slug === key || i.url === key) ||
        last[Number(idx) - 1];
      if (!chosen) {
        const sorry =
          "Não achei essa opção. Pode me mandar o número que aparece na lista ou o link do imóvel?";
        const sent = await wbot.sendMessage(msg.key.remoteJid!, { text: sorry });
        const { verifyMessage } = await import("./mediaHelpers").catch(() => ({ verifyMessage: null as any }));
        if (verifyMessage) await verifyMessage(sent, ticket, contact);
        return;
      }

      const ok = `Show! Vou falar com o corretor e já retorno com horários para visita em: ${chosen.title} – ${chosen.url}`;
      const sent = await wbot.sendMessage(msg.key.remoteJid!, { text: ok });
      const { verifyMessage } = await import("./mediaHelpers").catch(() => ({ verifyMessage: null as any }));
      if (verifyMessage) await verifyMessage(sent, ticket, contact);
      await saveState(ticket as any, { ...existing, mode: "smalltalk" } as any);
      return;
    }

    // browse_inventory (search)
    if (intent === "browse_inventory") {
      const newPage = /\b(ver mais|proxima pagina|pr[oó]xima p[aá]gina)\b/i.test(textNorm)
        ? (existing.page || 1) + 1
        : (existing.page || 1);

      const state: any = {
        mode: "inventory",
        domain: plan.domain || existing.domain || "imóveis",
        slots: { ...existing.slots, ...(plan.slots || {}) },
        page: newPage,
        pageSize: existing.pageSize || 5,
        lastList: existing.lastList || [],
        lastMapping: existing.lastMapping || {}
      };
      await saveState(ticket as any, state as any);

      if (!plan.query_ready) {
        const qs = (plan.followups || []).slice(0, 2);
        const txt = qs.length
          ? qs.join("\n")
          : "Quer me dizer suas preferências? (ex.: orçamento, nº de quartos, bairro/cidade)";
        const sent = await wbot.sendMessage(msg.key.remoteJid!, { text: txt });
        const { verifyMessage } = await import("./mediaHelpers").catch(() => ({ verifyMessage: null as any }));
        if (verifyMessage) await verifyMessage(sent, ticket, contact);
        return;
      }

      try {
        const base = (process.env.BACKEND_URL || "http://localhost:3000").replace(/\/$/, "");
        const bearer = `Bearer ${(process.env.SERVICE_JWT_SECRET || "").toString()}`;

        const payload: any = {
          companyId: ticket.companyId,
          text: textNorm,
          page: state.page || 1,
          pageSize: state.pageSize || 5,
          categoryHint: state.domain,
          filtros: state.slots
        };

        const { data: auto } = await axios.post(`${base}/inventory/agent/auto`, payload, {
          headers: { Authorization: bearer, "Content-Type": "application/json" },
          timeout: 8000
        });

        const mapping: Record<number, string> = {};
        (auto.items || []).forEach((it: any, i: number) => {
          mapping[i + 1] = it.codigo || it.slug || it.url;
        });

        const state2: any = { ...state, lastList: auto.items || [], lastMapping: mapping };
        await saveState(ticket as any, state2 as any);

        const total = auto?.items?.length || 0;
        if (total > 0) {
          const reply =
            auto?.previewMessage && String(auto.previewMessage).trim()
              ? auto.previewMessage
              : formatInventoryReply({
                  ...auto,
                  page: state.page,
                  pageSize: state.pageSize,
                  category: state.domain
                });

          const sent = await wbot.sendMessage(msg.key.remoteJid!, { text: reply });
          const { verifyMessage } = await import("./mediaHelpers").catch(() => ({ verifyMessage: null as any }));
          if (verifyMessage) await verifyMessage(sent, ticket, contact);
          return;
        }

        const sent = await wbot.sendMessage(msg.key.remoteJid!, {
          text:
            "Não encontrei resultados com essas preferências. Quer ajustar? Posso filtrar por preço, localização e características."
        });
        const { verifyMessage } = await import("./mediaHelpers").catch(() => ({ verifyMessage: null as any }));
        if (verifyMessage) await verifyMessage(sent, ticket, contact);
        return;
      } catch (err: any) {
        logger.error(
          { ctx: "InventoryAuto", error: err?.message, status: err?.response?.status },
          "inventory-call-failed"
        );
      }
    }

    // fallback small talk via LLM
    {
      const reply = await simpleReply({
        systemRole: "Você é um atendente humano, prestativo, que oferece ajuda em imóveis.",
        userText: textNorm,
        fallback: "Claro! Quer me dizer o que procura? cidade/bairro, tipo e orçamento aproximado."
      });
      const sent = await wbot.sendMessage(msg.key.remoteJid!, { text: reply });
      const { verifyMessage } = await import("./mediaHelpers").catch(() => ({ verifyMessage: null as any }));
      if (verifyMessage) await verifyMessage(sent, ticket, contact);
      return;
    }
  } catch (err) {
    console.error("handleOpenAi error:", err);
  }
}

// helper: formatInventoryReply (copiado e adaptado do seu monolito)
function pick(obj: any, keys: string[]) {
  return keys.find(k => obj?.[k] != null && obj?.[k] !== "" && obj?.[k] !== "0");
}

const formatInventoryReply = (payload: any) => {
  const items: any[] = payload?.items || [];
  const page = payload?.page || 1;
  const pageSize = payload?.pageSize || Math.min(items.length, 5) || 0;
  const total = payload?.total ?? items.length ?? 0;

  const crit = payload?.criteria || payload?.query?.criteria || {};
  const filtros = payload?.query?.filtros || {};
  const whereBits = [crit.neighborhood || filtros.neighborhood, crit.city || filtros.city, crit.state || filtros.state]
    .filter(Boolean)
    .join(", ");
  const where = whereBits ? ` em ${whereBits}` : "";

  const head = total > 0 ? `🌟 Encontrei algumas opções${where}:\n` : "Não encontrei itens para esse critério.";

  const top = items.slice(0, Math.min(pageSize || 5, 5));

  const lines = top.map((it, idx) => {
    const titleKey =
      pick(it, ["title", "name", "TituloSite", "Titulo", "Nome", "Descrição", "Descricao", "Codigo", "codigo"]) ||
      "title";
    const title = String(it[titleKey] ?? `Item ${idx + 1}`);

    const priceKey = pick(it, ["price", "valor", "preco", "Preço", "ValorVenda", "Valor", "amount"]);
    const priceStr = priceKey ? `\n💰 ${String(it[priceKey]).toString().replace(/[^\d.,a-zA-Z\$€£R$ ]/g, "")}` : "";

    const urlKey = pick(it, ["url", "URL", "link", "Link", "slug"]);
    const linkStr = urlKey ? `\n🔗 Ver detalhes ➜ ${it[urlKey]}` : "";

    const attrs: string[] = [];
    const attrPairs: Array<[string, string]> = [
      ["color", "🎨"],
      ["cor", "🎨"],
      ["size", "📏"],
      ["tamanho", "📏"],
      ["memory", "💾"],
      ["ram", "💾"],
      ["storage", "💽"],
      ["warranty", "🛡"],
      ["garantia", "🛡"],
      ["brand", "🏷"],
      ["marca", "🏷"],
      ["model", "🔧"],
      ["modelo", "🔧"],
      ["dormitorios", "🛏"],
      ["quartos", "🛏"],
      ["vagas", "🚗"],
      ["area", "📐"],
      ["metragem", "📐"]
    ];
    for (const [k, icon] of attrPairs) {
      if (it[k] != null && String(it[k]).trim() !== "") attrs.push(`${icon} ${it[k]}`);
    }

    const idxEmoji = ["1️⃣", "2️⃣", "3️⃣", "4️⃣", "5️⃣"][idx] || `${idx + 1}.`;

    return `${idxEmoji} *${title}*\n${attrs.join(" | ")}${priceStr}${linkStr}`;
  });

  const footer = total > page * pageSize ? `\n👉 *Diga "ver mais"* para ver a próxima página.` : "";

  return `${head}\n${lines.join("\n\n")}${footer}`.trim();
};

function buildDefaultGreeting(contactName?: string, brandName?: string) {
  const nome = (contactName || "tudo bem").trim();
  const marca = (brandName || "").trim();

  const intro = marca ? `Sou o assistente da ${marca}.` : "Sou seu assistente virtual.";

  return [
    `Oi, ${nome}! 👋`,
    `${intro} Posso te ajudar com o que você precisar.`,
    "Se preferir, me diga em poucas palavras o que quer fazer e eu já te guio 😉"
  ].join("\n");
}
