// backend/src/services/InventoryServices/OpenAIRolemapService.ts
import axios from "axios";
import { logger } from "../../utils/logger";

/**
 * Resultado retornado pela OpenAI para criação do rolemap.
 * - rolemap: dicionário livre -> caminho no JSON de origem (dot/bracket notation)
 * - itemsPath / totalPath: sugestões opcionais caso o modelo identifique
 * - notes: explicações curtas (opcional)
 */
export interface OpenAIRolemapResult {
  rolemap: Record<string, string>;
  itemsPath?: string;
  totalPath?: string;
  notes?: string;
}

/** Entrada para a função que consulta a OpenAI. */
export interface OpenAIInferRolemapInput {
  /**
   * Objeto representativo de um item da coleção retornada pela API-alvo.
   * Ex.: primeiro item do array encontrado no payload de resposta.
   */
  sampleItem: any;

  /** Amostras brutas (opcional) — útil quando quiser dar mais contexto ao modelo. */
  samples?: any[];

  /** Dica de domínio/categoria (ex.: "Imóveis", "Veículos", "Produtos"). Opcional. */
  categoryHint?: string;

  /** Sugestão de onde está a lista (ex.: "raw" , "data.items", etc.). Opcional. */
  itemsPathSuggestion?: string;

  /** Candidatos de caminho para "total" vindos da heurística. Opcional. */
  totalPathCandidates?: string[];
}

/**
 * Utilitário seguro para stringify curto (evita payloads gigantes no prompt).
 */
function safeStringify(obj: any, cap = 18000): string {
  try {
    const s = JSON.stringify(obj, null, 2);
    if (s.length > cap) {
      return s.slice(0, cap) + "\n/* truncated */";
    }
    return s;
  } catch {
    return String(obj).slice(0, cap);
  }
}

/**
 * Faz o parse de JSON com fallback para string common-case.
 */
function tryParseJson<T = any>(raw: any): T | null {
  if (raw == null) return null as any;
  if (typeof raw === "object") return raw as T;
  if (typeof raw !== "string") return null;

  try {
    return JSON.parse(raw) as T;
  } catch {
    // Tentativa de recortar um bloco JSON dentro do texto
    const start = raw.indexOf("{");
    const end = raw.lastIndexOf("}");
    if (start >= 0 && end > start) {
      const slice = raw.slice(start, end + 1);
      try {
        return JSON.parse(slice) as T;
      } catch {
        return null as any;
      }
    }
    return null as any;
  }
}

/**
 * Gera um prompt claro para o modelo.
 * Importante: não fixamos campos. Pedimos que o modelo proponha chaves úteis para o domínio.
 */
function buildPrompt(input: OpenAIInferRolemapInput) {
  const { sampleItem, samples, categoryHint, itemsPathSuggestion, totalPathCandidates } = input;

  const guidance = `
Você é um assistente que gera um "rolemap" (mapeamento de campos) entre o JSON de um provedor externo e um esquema interno genérico.
NÃO fixe um conjunto de chaves. Proponha chaves significativas para o domínio identificado a partir do JSON (ex.: imóveis, veículos, produtos).
As chaves devem ser curtas, em inglês e snake_case (ex.: "title", "price", "city", "bedrooms", "brand", "year", "mileage", etc.).
Para cada chave sugerida, aponte o caminho do campo correspondente no objeto de exemplo (dot notation; pode usar brackets para arrays).

Regras:
- Responda **exclusivamente** em JSON no formato exigido abaixo.
- Somente inclua chaves que você **consegue mapear** com confiança no sample recebido.
- Se identificar claramente onde está a lista de itens, devolva "itemsPath".
- Se identificar onde está o total de itens, devolva "totalPath".
- Inclua uma breve justificativa em "notes" (opcional).
- NÃO invente valores.
`;

  const sampleBlock = `Sample of a single item (representative):\n${safeStringify(sampleItem)}`;

  const otherSamples =
    samples && samples.length
      ? `\nAdditional raw samples (may be truncated):\n${safeStringify(samples)}`
      : "";

  const hints =
    `\nHints:` +
    `\n- categoryHint: ${categoryHint ?? "unknown"}` +
    `\n- itemsPathSuggestion: ${itemsPathSuggestion ?? "unknown"}` +
    `\n- totalPathCandidates: ${totalPathCandidates?.join(", ") || "unknown"}`;

  const outputSchema = `
Return JSON with the following TypeScript shape:
{
  "rolemap": { [key: string]: string }, // required
  "itemsPath"?: string,                 // optional
  "totalPath"?: string,                 // optional
  "notes"?: string                      // optional
}
`;

  return `${guidance}\n\n${sampleBlock}${otherSamples}\n${hints}\n\n${outputSchema}`;
}

/**
 * Chama a OpenAI para inferir o rolemap de forma totalmente dinâmica.
 * Nada aqui assume domínio fixo.
 */
export async function inferRolemapWithOpenAI(
  input: OpenAIInferRolemapInput
): Promise<OpenAIRolemapResult> {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) {
    throw new Error("OPENAI_API_KEY not configured");
  }

  const model = process.env.OPENAI_MODEL || "gpt-4o-mini";
  const url = "https://api.openai.com/v1/chat/completions";

  const messages = [
    {
      role: "system",
      content:
        "You are a senior data-mapping assistant. Output concise JSON only. No explanations outside the JSON."
    },
    {
      role: "user",
      content: buildPrompt(input)
    }
  ];

  try {
    const resp = await axios.post(
      url,
      {
        model,
        messages,
        // Pede JSON "duro". Se a conta não suportar, o fallback de parse ainda cobre.
        response_format: { type: "json_object" },
        temperature: 0.2
      },
      {
        headers: {
          Authorization: `Bearer ${apiKey}`,
          "Content-Type": "application/json"
        },
        timeout: 25_000
      }
    );

    // Extrai o conteúdo
    const content =
      resp?.data?.choices?.[0]?.message?.content ??
      resp?.data?.choices?.[0]?.message ??
      null;

    const parsed = tryParseJson<OpenAIRolemapResult>(content);

    if (!parsed || !parsed.rolemap || typeof parsed.rolemap !== "object") {
      logger.warn(
        { ctx: "OpenAIRolemapService", reason: "InvalidJSON", raw: String(content).slice(0, 4000) },
        "OpenAI returned non-JSON or missing rolemap"
      );
      throw new Error("OpenAI did not return a valid rolemap JSON.");
    }

    // Sanitiza: garante que rolemap é um dicionário simples de strings
    const clean: Record<string, string> = {};
    Object.entries(parsed.rolemap).forEach(([k, v]) => {
      if (!k) return;
      if (typeof v === "string" && v.trim()) {
        clean[k.trim()] = v.trim();
      }
    });

    const result: OpenAIRolemapResult = {
      rolemap: clean,
      itemsPath: parsed.itemsPath,
      totalPath: parsed.totalPath,
      notes: parsed.notes
    };

    logger.info(
      {
        ctx: "OpenAIRolemapService",
        keys: Object.keys(result.rolemap).slice(0, 20),
        itemsPath: result.itemsPath,
        totalPath: result.totalPath
      },
      "rolemap inferred"
    );

    return result;
  } catch (err: any) {
    logger.error({ ctx: "OpenAIRolemapService", err: err?.message }, "OpenAI call failed");
    throw err;
  }
}

/**
 * Pequena função utilitária para normalizar caminhos (opcional).
 * Mantida simples de propósito — você pode expandir depois se quiser.
 */
export function normalizePath(path: string | undefined): string | undefined {
  if (!path) return path;
  return path.replace(/\[(\d+)\]/g, ".$1").replace(/^\.+/, "");
}
