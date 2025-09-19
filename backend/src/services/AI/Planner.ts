// src/services/AI/Planner.ts
import OpenAI from "openai";

export type SlotDict = Record<string, string | number | boolean>;
export type PlannerOutput = {
  intent: "browse_inventory" | "smalltalk" | "other";
  domain?: string;              // ex.: "imóveis", "carros", "planos", "produtos"
  slots?: SlotDict;             // ex.: { cidade: "sao jose", uf:"SC", bairro:"campinas", dormitorios:2, precoMax: 500000 }
  missing_slots?: string[];     // o que falta pra buscar
  followups?: string[];         // perguntas naturais sugeridas
  query_ready: boolean;         // pode chamar a API?
  confidence: number;           // 0..1
};

const SYS_PROMPT = `
Você é um planner de conversa comercial. 
Tarefa: interpretar a mensagem do cliente, inferir domínio (imóveis, carros, planos, produtos etc.), extrair "slots" úteis, 
e decidir se já dá para consultar um inventário externo.

Regras:
- Seja genérico. Não presuma um único setor. 
- Se o cliente fala "apartamento em campinas, são josé/sc", domínio=imóveis, slots: cidade, uf, bairro. 
  Pergunte por quartos, preço, e qualquer coisa relevante (garagem, área, etc.) se não vierem.
- Se for "carro até 45 mil", domínio=carros, slots: precoMax=45000. Sugira followups: marca preferida, portas, câmbio, ano mínimo, opcionais, combustível.
- Sempre normalize slots de forma simples: tudo minúsculo; números como number.
- "query_ready" = true se tiver material mínimo para buscar algo útil (p. ex., ao menos domínio + um critério relevante).
- Sempre responda **APENAS** JSON no formato pedido.

Campos do JSON:
{
 "intent": "browse_inventory" | "smalltalk" | "other",
 "domain": string | null,
 "slots": { ... },
 "missing_slots": [ ... ],
 "followups": [ ... ],
 "query_ready": boolean,
 "confidence": number
}
`;

const DEFAULT_MODEL = process.env.OPENAI_MODEL || "gpt-4o-mini";

export class Planner {
  private client: OpenAI;

  constructor(apiKey?: string) {
    this.client = new OpenAI({ apiKey: apiKey || process.env.OPENAI_API_KEY! });
  }

  async infer(userText: string, priorSlots: SlotDict = {}): Promise<PlannerOutput> {
    const promptUser = [
      "Mensagem do cliente:",
      userText,
      "",
      "Slots já conhecidos (JSON):",
      JSON.stringify(priorSlots)
    ].join("\n");

    const resp = await this.client.chat.completions.create({
      model: DEFAULT_MODEL,
      response_format: { type: "json_object" },
      temperature: 0.2,
      messages: [
        { role: "system", content: SYS_PROMPT },
        { role: "user", content: promptUser }
      ],
      max_tokens: 300
    });

    let out: PlannerOutput;
    try {
      out = JSON.parse(resp.choices?.[0]?.message?.content || "{}");
    } catch {
      out = { intent: "other", query_ready: false, confidence: 0, slots: {}, followups: [], missing_slots: [] };
    }

    // "merge" simples com priorSlots (sem sobrescrever valores já confirmados)
    out.slots = { ...(priorSlots || {}), ...(out.slots || {}) };
    return out;
  }
}
