import axios from "axios";
import { logger } from "../../utils/logger";

export interface OpenAIRolemapResult {
  /** JSONPath do “array” de itens. Ex.: "$.raw.*", "$.data.items[*]", "$[*]" */
  listPath: string;
  /** Mapa de campos -> JSONPath relativo a cada item. Ex.: { title: "$.titulo" } */
  fields: Record<string, string>;
}

/** Regras mínimas para considerarmos um JSONPath “aceitável”. */
function isValidJsonPath(p?: string): boolean {
  if (!p || typeof p !== "string") return false;
  const s = p.trim();
  if (!s.startsWith("$")) return false;
  // evita respostas como "1", "items", etc.
  if (/^[\d.]+$/.test(s)) return false;
  // algo como $.a.b[*] ou $[*] ou $..*
  return /(\[\*\])|(\.\*)|(\$)/.test(s);
}

/** Procura um caminho que represente “lista” (array OU dicionário) e retorna JSONPath. */
function findArrayOrMapJsonPath(obj: any, base = "$"): string | null {
  try {
    if (Array.isArray(obj)) return `${base}[*]`;
    if (obj && typeof obj === "object") {
      const keys = Object.keys(obj);
      if (keys.length) {
        // dicionário (chaves numéricas ou ids)
        const looksLikeMap = keys.every(k => /^\d+$/.test(k) || /^[a-f0-9-]{6,}$/i.test(k));
        if (looksLikeMap) return `${base}.*`;
        for (const k of keys) {
          const hit = findArrayOrMapJsonPath(obj[k], `${base}.${k}`);
          if (hit) return hit;
        }
      }
    }
  } catch {}
  return null;
}

/** Sanitiza resultado vindo da OpenAI usando o payload de exemplo como fallback. */
function coerceRolemap(ai: Partial<OpenAIRolemapResult>, sample: any): OpenAIRolemapResult {
  let listPath = (ai.listPath || "").trim();
  if (!isValidJsonPath(listPath)) {
    listPath = findArrayOrMapJsonPath(sample) || "$.*";
  }
  const fields: Record<string, string> = {};
  for (const [k, v] of Object.entries(ai.fields || {})) {
    if (typeof v === "string" && v.trim()) fields[k] = v.trim();
  }
  return { listPath, fields };
}

/** Monta o prompt — sem nenhum campo fixo. */
function buildPrompt(sample: any, categoryHint?: string) {
  const sampleStr = JSON.stringify(sample, null, 2);
  return [
    "Você é um assistente que cria um rolemap para extrair listas e campos de um payload JSON.",
    "Saída DEVE ser JSON estrito com as chaves: listPath (JSONPath do array/dicionário de itens) e fields (objeto de mapeamentos campo->JSONPath relativo ao item).",
    "NUNCA retorne explicações, somente JSON válido.",
    categoryHint ? `Categoria (hint): ${categoryHint}` : "",
    "Exemplo de saída mínima válida:",
    `{"listPath":"$[*]","fields":{"id":"$.id","title":"$.title"}}`,
    "Agora gere o rolemap para o payload abaixo:",
    "```json",
    sampleStr,
    "```"
  ].filter(Boolean).join("\n");
}

export const OpenAIRolemapService = {
  async inferFromSamplePayload(sample: any, categoryHint?: string): Promise<OpenAIRolemapResult> {
    const apiKey = process.env.OPENAI_API_KEY;
    const baseURL = process.env.OPENAI_BASE_URL || "https://api.openai.com/v1";
    const model = process.env.OPENAI_MODEL || "gpt-4o-mini";

    if (!apiKey) {
      throw new Error("OPENAI_API_KEY ausente no ambiente");
    }

    const prompt = buildPrompt(sample, categoryHint);

    // Nota: usamos a API de chat completions padrão
    const resp = await axios.post(
      `${baseURL}/chat/completions`,
      {
        model,
        messages: [{ role: "user", content: prompt }],
        temperature: 0.0
      },
      {
        headers: {
          Authorization: `Bearer ${apiKey}`,
          "Content-Type": "application/json"
        },
        timeout: 20000
      }
    );

    const content: string = resp.data?.choices?.[0]?.message?.content || "{}";
    let parsed: any = {};
    try {
      parsed = JSON.parse(content);
    } catch (e) {
      logger.warn({ ctx: "OpenAIRolemapService", warn: "JSON parse failed, using empty object" });
      parsed = {};
    }

    const rolemap = coerceRolemap(parsed, sample);

    logger.info(
      {
        ctx: "OpenAIRolemapService",
        keys: Object.keys(sample || {}),
        itemsPath: rolemap.listPath,
        totalPath: (sample && typeof sample.total === "number") ? "total" : undefined
      },
      "rolemap inferred"
    );

    return rolemap;
  }
};

export default OpenAIRolemapService;
