// backend/src/services/Agents/tools/RealEstateAgentOrchestrator.ts
import OpenAI from "openai";
import { REAL_ESTATE_SYSTEM_PROMPT } from "../templates/realEstatePrompt";
import { searchProperties, formatCards, renderWhatsAppList, SearchCriteria } from "./realEstateTools";

type RunInput = {
  companyId: number;
  text: string;
  context?: {
    lastCriteria?: SearchCriteria;
  };
};

function extractJSON<T = any>(text: string): T | null {
  if (!text) return null;
  // tenta pegar trecho entre ```json ... ```
  const fenced = text.match(/```json\s*([\s\S]*?)```/i);
  const raw = fenced ? fenced[1] : text;
  try { return JSON.parse(raw as string) as T; } catch {}
  // tenta pegar primeiro {...}
  const obj = raw.match(/\{[\s\S]*\}/);
  if (obj) { try { return JSON.parse(obj[0]) as T; } catch {} }
  return null;
}

export async function handleRealEstateMessage(input: RunInput) {
  const { companyId, text, context } = input;

  const classificationPrompt = `
  Texto do lead: "${text}"

  Classifique a intenção como UMA de:
  - "saudacao"
  - "qualificacao" (perguntas sobre preferências ou dados para filtrar)
  - "listar" (quer ver imóveis / opções)
  - "detalhe" (citou código/slug/link específico)
  - "outro"

  Responda ESTRITAMENTE em JSON no formato:
  {"intent":"...", "criteria":{"cidade":"?", "bairro":"?", "minPrice":0, "maxPrice":0, "dormitorios":0, "vagas":0, "areaMin":0, "areaMax":0, "texto":"?"}}
  Campos de criteria são opcionais; inclua somente quando conseguir inferir algo do texto.
  `;

  // chama OpenAI diretamente
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) throw new Error("OPENAI_API_KEY not set");
  const openai = new OpenAI({ apiKey });

  const chat = await openai.chat.completions.create({
    model: process.env.OPENAI_MODEL || "gpt-4o-mini",
    messages: [
      { role: "system", content: REAL_ESTATE_SYSTEM_PROMPT },
      { role: "user", content: classificationPrompt }
    ],
    temperature: 0.1,
    max_tokens: 200
  });

  const raw = chat.choices?.[0]?.message?.content ?? "";
  const parsed = extractJSON<{ intent?: string; criteria?: Partial<SearchCriteria> }>(raw) || {};
  const intent = parsed.intent || "outro";
  const criteria: SearchCriteria = {
    ...(context?.lastCriteria || {}),
    ...(parsed.criteria || {})
  };

  if (intent === "saudacao" || intent === "qualificacao") {
    return {
      text: "Oi! 👋 Sou da Barbi Imóveis. Me conta rapidinho: cidade/bairro de interesse, nº de dormitórios e faixa de preço? Com isso já te mostro as melhores opções 😉",
      state: { lastCriteria: criteria }
    };
  }

  if (intent === "detalhe") {
    criteria.texto = text;
  }

  if (intent === "listar" || intent === "detalhe") {
    const results = await searchProperties(companyId, { ...criteria, limit: 5 });
    const cards = formatCards(results);
    const msg = renderWhatsAppList(cards);
    return { text: msg, state: { lastCriteria: criteria }, results: cards };
  }

  return {
    text: "Perfeito! Posso te ajudar a encontrar um imóvel ideal. Qual cidade/bairro você prefere e qual faixa de preço pretende investir?",
    state: { lastCriteria: criteria }
  };
}
