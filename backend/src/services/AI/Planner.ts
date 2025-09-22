import OpenAI from "openai";

/**
 * Planejador de intenção híbrido (regras + LLM).
 * - Primeiro passa por heurísticas determinísticas (barato e rápido).
 * - Se ainda assim houver dúvida, usa o LLM pra classificar e extrair slots.
 *
 * Env tunáveis:
 *   AI_PLANNER_MODE = "rules-only" | "hybrid" (default: "hybrid")
 *   AI_PLANNER_MIN_CONF = 0.6
 *   OPENAI_MODEL (fallback gpt-4o-mini)
 */

type PlanInput = {
  text: string;
  last_state?: Record<string, any>;
  model?: string;
  systemPrompt?: string; // persona do cadastro (opcional, mas recomendado)
};

type PlanOutput = {
  intent: "smalltalk" | "browse_inventory" | "handoff" | "other";
  confidence: number; // 0..1
  query_ready: boolean;
  slots: {
    tipo?: string;
    cidade?: string;
    bairro?: string;
    precoMin?: number;
    precoMax?: number;
    quartos?: number;
    [k: string]: any;
  };
  missing_slots: string[];
  followups: string[];
};

const GREET_RE = /(^|\s)(oi|ol[aá]|e[ai]|bom dia|boa tarde|boa noite)(!|\.|,|\s|$)/i;
const THANKS_RE = /\b(obrigad[ao]|valeu)\b/i;

/** Palavras que disparam forte o “estoque” (imóveis/produtos genérico) */
const INV_TRIGGERS = [
  "imóv", "imovel", "apart", "casa", "kitnet", "sobrado",
  "alugar", "aluguel", "comprar", "vender",
  "estoque", "produto", "disponível", "disponiveis",
  "preço", "valor", "metrag", "quartos", "suíte", "garagem",
  "bairro", "centro", "região", "localização"
];

/** Heurística determinística inicial */
function rulesHeuristic(text: string): PlanOutput | null {
  const t = (text || "").toLowerCase().trim();

  // Saudações → smalltalk
  if (GREET_RE.test(t)) {
    return {
      intent: "smalltalk",
      confidence: 0.9,
      query_ready: false,
      slots: {},
      missing_slots: [],
      followups: []
    };
  }

  // Agradecimentos → smalltalk
  if (THANKS_RE.test(t)) {
    return {
      intent: "smalltalk",
      confidence: 0.8,
      query_ready: false,
      slots: {},
      missing_slots: [],
      followups: []
    };
  }

  // Contagem de gatilhos de inventário
  const trigHits = INV_TRIGGERS.reduce((acc, w) => acc + (t.includes(w) ? 1 : 0), 0);

  // “ver mais” etc. (paginador) — a camada superior já trata, mas aqui evita ruído
  if (/^(ver mais|mais|próxima|proxima|next)$/i.test(t)) {
    return {
      intent: "other",
      confidence: 0.9,
      query_ready: false,
      slots: {},
      missing_slots: [],
      followups: []
    };
  }

  // Se muitos gatilhos, já tende a inventário
  if (trigHits >= 2) {
    const slots: PlanOutput["slots"] = {};
    // regras simples pra extrair numerais e dinheiro
    const quartos = t.match(/(\d+)\s*(qtd|qts|quartos?)/i) || t.match(/(\d+)\s*quartos?/i);
    if (quartos) slots.quartos = Number(quartos[1]);

    const maxMatch = t.match(/(até|no máximo|max)\s*([\d\.\,]+[kKmM]?)/i);
    const minMatch = t.match(/(a partir de|mínimo|min)\s*([\d\.\,]+[kKmM]?)/i);

    const toNumber = (s: string) => {
      const raw = s.replace(/[^\d,\.kKmM]/g, "");
      if (/k$/i.test(raw)) return Math.round(parseFloat(raw) * 1000);
      if (/m$/i.test(raw)) return Math.round(parseFloat(raw) * 1000000);
      return Number(raw.replace(/\./g, "").replace(",", "."));
    };

    if (maxMatch) slots.precoMax = toNumber(maxMatch[2]);
    if (minMatch) slots.precoMin = toNumber(minMatch[2]);

    // cidade/bairro muito rudimentar (NLFilter depois refina)
    const bairro = t.match(/\b(bairro\s+([a-z\u00C0-\u017F\s]+))$/i);
    if (bairro) slots.bairro = bairro[2].trim();

    return {
      intent: "browse_inventory",
      confidence: 0.65, // suficiente se ainda vier o classificador
      query_ready: true,
      slots,
      missing_slots: [],
      followups: []
    };
  }

  // caso contrário, trata como smalltalk/other e delega pro LLM decidir
  return null;
}

/** Classificação com LLM (OpenAI) — robusto mas opcional */
async function llmClassify(text: string, systemPrompt?: string, modelOverride?: string): Promise<PlanOutput | null> {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) return null;

  const client = new OpenAI({ apiKey });
  const model = modelOverride || process.env.OPENAI_MODEL || "gpt-4o-mini";
  const persona = (systemPrompt || "").trim();

  const sys =
    (persona ? `${persona}\n\n` : "") +
    `Você é um roteador de intenções. Classifique a mensagem do usuário (pt-BR) para:
- "smalltalk": saudações, conversa geral, agradecimentos
- "browse_inventory": quando há interesse em listar/consultar itens (imóveis/produtos), extrair critérios
- "handoff": quando claramente pede humano
Retorne JSON estrito: { "intent": "...", "confidence": 0..1, "slots": { ... }, "query_ready": bool, "missing_slots": [..], "followups": [..] }.
Nunca invente, só infira quando for claro.`.trim();

  const user = `Mensagem: """${text}"""`;

  const resp = await client.chat.completions.create({
    model,
    temperature: 0,
    messages: [
      { role: "system", content: sys },
      { role: "user", content: user }
    ]
  });

  const content = resp.choices?.[0]?.message?.content?.trim();
  if (!content) return null;

  try {
    const json = JSON.parse(content) as Partial<PlanOutput>;
    // saneamento
    const out: PlanOutput = {
      intent: (json.intent as any) || "other",
      confidence: typeof json.confidence === "number" ? Math.max(0, Math.min(1, json.confidence)) : 0.5,
      query_ready: !!json.query_ready,
      slots: (json.slots || {}) as any,
      missing_slots: Array.isArray(json.missing_slots) ? json.missing_slots : [],
      followups: Array.isArray(json.followups) ? json.followups : []
    };
    return out;
  } catch {
    // se não for JSON puro, tenta um fallback simples
    if (/browse_inventory/.test(content)) {
      return { intent: "browse_inventory", confidence: 0.6, query_ready: true, slots: {}, missing_slots: [], followups: [] };
    }
    if (/smalltalk/.test(content)) {
      return { intent: "smalltalk", confidence: 0.6, query_ready: false, slots: {}, missing_slots: [], followups: [] };
    }
    return null;
  }
}

/** API pública */
export async function plan({ text, last_state, model, systemPrompt }: PlanInput): Promise<PlanOutput> {
  const mode = (process.env.AI_PLANNER_MODE || "hybrid").toLowerCase();
  const minConf = Number(process.env.AI_PLANNER_MIN_CONF || "0.6");

  // 1) regras primeiro
  const rules = rulesHeuristic(text);
  if (mode === "rules-only" && rules) return rules;

  // 2) se regras já foram fortes o suficiente e intenção não é inventário por engano, devolve
  if (rules && rules.intent !== "browse_inventory") return rules;

  // 3) se estamos inclinados a inventário, valida com LLM (ou complementa)
  let llm: PlanOutput | null = null;
  if (mode !== "rules-only") {
    try {
      llm = await llmClassify(text, systemPrompt, model);
    } catch {
      llm = null;
    }
  }

  // Combinação final
  if (!llm && rules) return rules;

  if (llm && rules && rules.intent === "browse_inventory" && llm.intent !== "browse_inventory") {
    // conflito: prioriza llm se confiança alta, senão fica em smalltalk
    if (llm.confidence >= minConf) return llm;
    return { intent: "smalltalk", confidence: 0.55, query_ready: false, slots: {}, missing_slots: [], followups: [] };
  }

  if (llm) {
    // garante followups quando query_ready = false
    const fu = llm.followups && llm.followups.length
      ? llm.followups
      : llm.intent === "browse_inventory" && !llm.query_ready
        ? ["Pode me dizer tipo, região/bairro e orçamento aproximado para eu filtrar melhor?"]
        : [];
    return { ...llm, followups: fu };
  }

  // fallback total
  return {
    intent: "smalltalk",
    confidence: 0.5,
    query_ready: false,
    slots: {},
    missing_slots: [],
    followups: []
  };
}

export default { plan };
