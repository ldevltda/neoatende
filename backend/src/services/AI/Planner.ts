import OpenAI from "openai";

/**
 * Planner LLM-first com cache e “short-circuit” para saudações.
 * Intenções cobertas:
 *  - "comprar" (browse_inventory)
 *  - "vender"
 *  - "financiamento"
 *  - "agendar_visita"
 *  - "duvida_geral"
 *  - "smalltalk"
 *  - "handoff"
 *
 * ENV:
 *   OPENAI_API_KEY (obrigatório)
 *   AI_PLANNER_MODEL (ex: gpt-4o-mini)
 *   AI_PLANNER_TEMPERATURE=0
 *   AI_PLANNER_MAX_TOKENS=320
 *   AI_PLANNER_GREETING_FAST=true
 *   AI_PLANNER_MIN_CONF=0.6
 */

type PlanInput = {
  text: string;
  persona?: string;
  memory?: Record<string, any>;
};

type PlanSlots = {
  // Geo
  cidade?: string;
  bairro?: string;
  estado?: string;

  // Imóvel
  tipo?: string;            // apartamento|casa|studio…
  dormitorios?: number;
  vagas?: number;
  suite?: number;
  areaMin?: number;
  areaMax?: number;
  novoUsado?: "novo" | "usado" | "indiferente";
  andar?: number;
  pet?: boolean;

  // Financeiro
  renda?: number;           // renda bruta familiar (R$)
  entrada?: number;         // valor absoluto
  fgts?: boolean;
  momento?: "agora" | "1-3m" | "3-6m" | "pesquisando";
  precoMin?: number;
  precoMax?: number;

  // Contato
  nome?: string;
  email?: string;
  whatsapp?: string;
  melhorHorario?: string;

  // Preferências
  elevador?: boolean;
  varanda?: boolean;
  lazer?: boolean;
  vagaCoberta?: boolean;

  // Vendedor
  imovelEndereco?: string;
  estadoConservacao?: string; // novo, reformado, precisa reforma
};

type PlanOutput = {
  intent:
    | "comprar"
    | "vender"
    | "financiamento"
    | "agendar_visita"
    | "duvida_geral"
    | "smalltalk"
    | "handoff";
  confidence: number;
  query_ready: boolean;
  slots: PlanSlots;
  missing_slots: string[];
  followups: string[];
};

const GREET_RE = /(^|\s)(oi|ol[aá]|e[ai]|bom dia|boa tarde|boa noite)(!|\.|,|\s|$)/i;

// LRU simples
const LRU: Map<string, { exp: number; value: PlanOutput }> = new Map();
const TTL_MS = 5 * 60 * 1000;
function cacheGet(k: string) {
  const hit = LRU.get(k);
  if (!hit) return null;
  if (Date.now() > hit.exp) {
    LRU.delete(k);
    return null;
  }
  return hit.value;
}
function cacheSet(k: string, v: PlanOutput) {
  LRU.set(k, { exp: Date.now() + TTL_MS, value: v });
  if (LRU.size > 3000) LRU.delete(LRU.keys().next().value as string);
}

function fewShots() {
  return [
`Exemplo A (comprar):
Usuário: "Quero apê 2 dorm no Kobrasol, até 420 mil, tenho FGTS, mudo em 2 meses."
JSON:
{"intent":"comprar","confidence":0.9,"query_ready":true,
 "slots":{"tipo":"apartamento","dormitorios":2,"bairro":"Kobrasol","cidade":"São José","fgts":true,"precoMax":420000,"momento":"1-3m"},
 "missing_slots":[],"followups":[]}`,

`Exemplo B (financiamento):
Usuário: "Dá pra simular PRICE com renda 8 mil e FGTS 30k?"
JSON:
{"intent":"financiamento","confidence":0.9,"query_ready":true,
 "slots":{"renda":8000,"fgts":true,"entrada":30000},
 "missing_slots":[],"followups":["Prefere prazo 360 ou 420 meses?"]}`,

`Exemplo C (vender):
Usuário: "Quero vender meu apê no Campinas; está reformado."
JSON:
{"intent":"vender","confidence":0.9,"query_ready":true,
 "slots":{"imovelEndereco":"Campinas, São José/SC","estadoConservacao":"reformado","tipo":"apartamento"},
 "missing_slots":["metragem","vaga"],"followups":["Pode me enviar matrícula e IPTU?"]}`,

`Exemplo D (agendar):
Usuário: "Consigo visitar sábado às 10h?"
JSON:
{"intent":"agendar_visita","confidence":0.9,"query_ready":true,
 "slots":{},"missing_slots":[],"followups":[]}`,

`Exemplo E (duvida geral):
Usuário: "Pode pet no condomínio?"
JSON:
{"intent":"duvida_geral","confidence":0.7,"query_ready":false,
 "slots":{},"missing_slots":["imóvel_alvo"],"followups":["Você tem um código/bairro pra eu conferir?"]}`
  ].join("\n\n");
}

function normalizeText(t: string) {
  return (t || "").trim().replace(/\s+/g, " ");
}

export async function plan({ text, persona }: PlanInput): Promise<PlanOutput> {
  const raw = normalizeText(text);

  // Saudações rápidas (não gasta token)
  if (process.env.AI_PLANNER_GREETING_FAST === "true" && GREET_RE.test(raw)) {
    return {
      intent: "smalltalk",
      confidence: 0.7,
      query_ready: false,
      slots: {},
      missing_slots: [],
      followups: ["Me diz bairro de interesse e faixa de preço que já te mostro as melhores opções 😉"]
    };
  }

  const cacheKey = raw.slice(0, 200).toLowerCase();
  const hit = cacheGet(cacheKey);
  if (hit) return hit;

  const apiKey = process.env.OPENAI_API_KEY!;
  const model = process.env.AI_PLANNER_MODEL || "gpt-4o-mini";
  const maxTokens = Number(process.env.AI_PLANNER_MAX_TOKENS ?? 320);
  const temperature = Number(process.env.AI_PLANNER_TEMPERATURE ?? 0);

  const system = [
    persona ? `${persona}\n` : "",
    `Você é um roteador de intenções e extrator de slots para atendimento imobiliário (pt-BR).
Responda APENAS com um JSON válido nesse formato:
{
  "intent": "comprar|vender|financiamento|agendar_visita|duvida_geral|smalltalk|handoff",
  "confidence": 0..1,
  "query_ready": boolean,
  "slots": { ... },
  "missing_slots": ["..."],
  "followups": ["..."]
}

- slots aceitos: cidade,bairro,estado,tipo,dormitorios,vagas,suite,areaMin,areaMax,novoUsado,andar,pet,
                 renda,entrada,fgts,momento,precoMin,precoMax,nome,email,whatsapp,melhorHorario,
                 elevador,varanda,lazer,vagaCoberta,imovelEndereco,estadoConservacao
- "query_ready" = true quando já dá para consultar inventário OU executar simulação OU agendar.
- retorne followups curtos (no máx. 2!) se faltar algo essencial.
${fewShots()}`
  ].join("\n");

  const client = new OpenAI({ apiKey });
  const resp = await client.chat.completions.create({
    model,
    temperature,
    max_tokens: maxTokens,
    response_format: { type: "json_object" },
    messages: [{ role: "system", content: system }, { role: "user", content: `Mensagem: """${raw}"""` }]
  });

  let out: PlanOutput;
  try {
    const content = resp.choices?.[0]?.message?.content?.trim() || "{}";
    out = JSON.parse(content) as PlanOutput;
  } catch {
    out = {
      intent: "duvida_geral",
      confidence: 0.6,
      query_ready: false,
      slots: {},
      missing_slots: [],
      followups: ["Pode me dar mais detalhes, por favor?"]
    };
  }

  if (Number(out.confidence || 0) < Number(process.env.AI_PLANNER_MIN_CONF ?? 0.6)) {
    out.intent = "duvida_geral";
  }

  cacheSet(cacheKey, out);
  return out;
}

export default { plan };
