import OpenAI from "openai";

/**
 * Planner LLM-first com cache e “short-circuit” opcional para saudações.
 *
 * ENV:
 *   OPENAI_API_KEY                (obrigatório)
 *   OPENAI_MODEL                  (fallback gpt-4o-mini)
 *   AI_PLANNER_MODEL              (modelo só para classificar, ex: gpt-4o-mini)
 *   AI_PLANNER_MAX_TOKENS=320
 *   AI_PLANNER_TEMPERATURE=0
 *   AI_PLANNER_GREETING_FAST=true     // não chama LLM para “oi/olá…”
 *   AI_PLANNER_MIN_CONF=0.6
 */

type PlanInput = {
  text: string;
  last_state?: Record<string, any>;
  model?: string;
  systemPrompt?: string;   // persona do cadastro
};

export type PlanOutput = {
  intent: "smalltalk" | "browse_inventory" | "handoff" | "other";
  confidence: number;      // 0..1
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

// ---------- cache em memória com TTL ----------
const LRU: Map<string, { exp: number; value: PlanOutput }> = new Map();
const TTL_MS = 5 * 60 * 1000; // 5 min

function cacheGet(key: string): PlanOutput | null {
  const hit = LRU.get(key);
  if (!hit) return null;
  if (Date.now() > hit.exp) { LRU.delete(key); return null; }
  return hit.value;
}
function cacheSet(key: string, value: PlanOutput) {
  LRU.set(key, { exp: Date.now() + TTL_MS, value });
  // contenção simples
  if (LRU.size > 5000) {
    const first = LRU.keys().next().value;
    if (first) LRU.delete(first);
  }
}

const GREET_RE = /(^|\s)(oi|ol[aá]|e[ai]|bom dia|boa tarde|boa noite)(!|\.|,|\s|$)/i;

function normalizeText(t: string) {
  return (t || "").trim().replace(/\s+/g, " ").toLowerCase();
}

function fewShots(): string {
  // exemplos curtos que ensinam o formato/limites
  return [
    `Exemplo 1:
Usuário: "oi, tudo bem?"
JSON:
{"intent":"smalltalk","confidence":0.95,"query_ready":false,"slots":{},"missing_slots":[],"followups":["Como posso ajudar?"]}`,

    `Exemplo 2:
Usuário: "quero um apartamento 2 quartos no centro até 500k"
JSON:
{"intent":"browse_inventory","confidence":0.92,"query_ready":true,"slots":{"tipo":"apartamento","quartos":2,"bairro":"centro","precoMax":500000},"missing_slots":[],"followups":[]}`,

    `Exemplo 3:
Usuário: "me transfere para humano por favor"
JSON:
{"intent":"handoff","confidence":0.9,"query_ready":false,"slots":{},"missing_slots":[],"followups":[]}`,

    `Exemplo 4:
Usuário: "procurando opções, mas não sei região ainda"
JSON:
{"intent":"browse_inventory","confidence":0.75,"query_ready":false,"slots":{},"missing_slots":["regiao_ou_bairro"],"followups":["Pode me dizer a região/bairro e a faixa de preço?"]}`
  ].join("\n\n");
}

export async function plan({ text, last_state, model, systemPrompt }: PlanInput): Promise<PlanOutput> {
  const raw = String(text || "");
  const t = normalizeText(raw);

  // 1) atalho barato para saudações, se habilitado
  if ((process.env.AI_PLANNER_GREETING_FAST || "true").toLowerCase() === "true" && GREET_RE.test(t)) {
    return {
      intent: "smalltalk",
      confidence: 0.95,
      query_ready: false,
      slots: {},
      missing_slots: [],
      followups: ["Como posso ajudar?"]
    };
  }

  // 2) cache
  const cacheKey = `plan:v2:${t}`;
  const cached = cacheGet(cacheKey);
  if (cached) return cached;

  // 3) chamada LLM
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) {
    // fallback quando chave não está presente
    const fallback: PlanOutput = {
      intent: "smalltalk",
      confidence: 0.5,
      query_ready: false,
      slots: {},
      missing_slots: [],
      followups: []
    };
    return fallback;
  }

  const client = new OpenAI({ apiKey });
  const clfModel = process.env.AI_PLANNER_MODEL || process.env.OPENAI_MODEL || model || "gpt-4o-mini";
  const maxTokens = Number(process.env.AI_PLANNER_MAX_TOKENS || "320");
  const temperature = Number(process.env.AI_PLANNER_TEMPERATURE || "0");
  const minConf = Number(process.env.AI_PLANNER_MIN_CONF || "0.6");

  const persona = (systemPrompt || "").trim();

  const system = [
    persona ? `${persona}\n` : "",
    `Você é um **roteador de intenções** e extrator de critérios em pt-BR.
Tarefas:
1) Determine "intent" ∈ {"smalltalk","browse_inventory","handoff","other"}.
2) Preencha "slots" quando pertinente (tipo, cidade, bairro, precoMin, precoMax, quartos).
3) "query_ready": true quando já dá para consultar a API; senão, liste "missing_slots" e "followups" claros.
4) Responda **apenas** com JSON válido, sem texto extra.

${fewShots()}
`
  ].join("\n");

  const user = `Mensagem do usuário: """${raw}"""`;

  const resp = await client.chat.completions.create({
    model: clfModel,
    temperature,
    max_tokens: maxTokens,
    response_format: { type: "json_object" },
    messages: [
      { role: "system", content: system },
      { role: "user", content: user }
    ]
  });

  const content = resp.choices?.[0]?.message?.content?.trim() || "{}";
  let out: PlanOutput;

  try {
    const parsed = JSON.parse(content);
    out = {
      intent: parsed.intent || "other",
      confidence: typeof parsed.confidence === "number" ? parsed.confidence : 0.6,
      query_ready: !!parsed.query_ready,
      slots: parsed.slots || {},
      missing_slots: Array.isArray(parsed.missing_slots) ? parsed.missing_slots : [],
      followups: Array.isArray(parsed.followups) ? parsed.followups : []
    };
  } catch {
    // fallback bem conservador
    out = {
      intent: "smalltalk",
      confidence: 0.55,
      query_ready: false,
      slots: {},
      missing_slots: [],
      followups: []
    };
  }

  // conservador: se confiança baixa, degrade para smalltalk
  if (out.confidence < minConf && out.intent === "browse_inventory") {
    out = {
      intent: "smalltalk",
      confidence: 0.6,
      query_ready: false,
      slots: {},
      missing_slots: [],
      followups: ["Me conte um pouco mais pra eu entender melhor 🙂"]
    };
  }

  cacheSet(cacheKey, out);
  return out;
}

export default { plan };
