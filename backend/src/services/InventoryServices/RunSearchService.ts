// backend/src/services/InventoryServices/RunSearchService.ts
import axios from "axios";
import InventoryIntegration from "../../models/InventoryIntegration";
import AppError from "../../errors/AppError";
import { buildParamsForApi, UniversalSearchInput } from "./PlannerService";

/**
 * Acesso seguro por path "a.b.c[0].d"
 */
function getByPath(obj: any, path?: string | null) {
  if (!obj || !path) return obj;
  const parts = path
    .replace(/\[(\d+)\]/g, ".$1")
    .split(".")
    .filter(Boolean);
  let cur: any = obj;
  for (const p of parts) {
    if (cur == null) return undefined;
    cur = cur[p];
  }
  return cur;
}

/**
 * Tenta extrair a lista de itens de várias formas:
 * - via rolemap.list_path
 * - se o retorno for um objeto com chaves numéricas ("1","2",...), converte para array
 * - se for array direto, usa como está
 */
function extractItems(raw: any, listPath?: string | null): any[] {
  if (!raw) return [];

  // 1) path explícito
  const byPath = getByPath(raw, listPath ?? undefined);
  if (Array.isArray(byPath)) return byPath;

  // 2) Vista: objeto com itens em chaves numéricas + metadados (total, paginas, etc)
  if (raw && typeof raw === "object") {
    const keys = Object.keys(raw).filter(k => /^\d+$/.test(k));
    if (keys.length) {
      return keys
        .sort((a, b) => Number(a) - Number(b))
        .map(k => (raw as any)[k]);
    }
  }

  // 3) já é array?
  if (Array.isArray(raw)) return raw;

  // 4) não deu — devolve vazio
  return [];
}

/**
 * Normaliza a resposta em um formato único pro front:
 * {
 *   items: [...],
 *   total: number | undefined,
 *   pagina: number | undefined,
 *   pageSize: number | undefined,
 *   hasNext: boolean | undefined,
 *   raw?: any
 * }
 */
function normalizeResponse(raw: any, listPath?: string | null, page?: number, pageSize?: number) {
  const items = extractItems(raw, listPath);

  // Tenta inferir metadados comuns (Vista traz total/paginas/pagina/quantidade)
  let total: number | undefined = undefined;
  let pagina: number | undefined = page;
  let size: number | undefined = pageSize;
  let hasNext: boolean | undefined = undefined;

  if (raw && typeof raw === "object") {
    if (typeof raw.total === "number") total = raw.total;
    if (typeof raw.pagina === "number") pagina = raw.pagina;
    if (typeof raw.quantidade === "number") size = raw.quantidade;
    if (typeof raw.paginas === "number" && typeof pagina === "number") {
      hasNext = pagina < raw.paginas;
    } else if (typeof total === "number" && typeof pagina === "number" && typeof size === "number") {
      const consumed = (pagina - 1) * size + items.length;
      hasNext = consumed < total;
    }
  }

  return {
    items,
    total,
    pagina,
    pageSize: size,
    hasNext,
    raw,
  };
}

/**
 * Headers planos (Record<string,string>) para evitar conflito com AxiosHeaders.
 */
type SimpleHeaders = Record<string, string>;

/**
 * Monta headers a partir da integração.
 * Suporta: none | bearer | basic | api_key (in: header)
 */
function buildHeaders(integ: InventoryIntegration): SimpleHeaders {
  const h: SimpleHeaders = {
    Accept: "application/json",
    ...(integ.endpoint?.headers as any),
  };

  const at = (integ as any).auth as
    | {
        type: "none" | "api_key" | "bearer" | "basic";
        in?: "header" | "query";
        name?: string;
        prefix?: string;
        key?: string;
        username?: string;
        password?: string;
      }
    | undefined;

  if (!at || at.type === "none") return h;

  if (at.type === "bearer" && at.key) {
    const prefix = at.prefix || "Bearer";
    h["Authorization"] = `${prefix} ${at.key}`;
  } else if (at.type === "basic" && at.username && at.password) {
    const b64 = Buffer.from(`${at.username}:${at.password}`).toString("base64");
    h["Authorization"] = `Basic ${b64}`;
  } else if (at.type === "api_key" && at.in === "header" && at.name && at.key) {
    h[at.name] = at.prefix ? `${at.prefix} ${at.key}` : at.key;
  }

  return h;
}

/**
 * Monta query/body a partir do planner + auth api_key in=query.
 */
function buildQueryAndBody(
  integ: InventoryIntegration,
  input: UniversalSearchInput
): { finalQuery: Record<string, any>; finalBody: any; page: number; pageSize: number } {
  const { params, page, pageSize } = buildParamsForApi(
    input,
    (integ as any).pagination || { strategy: "none" }
  );

  const method = (integ.endpoint?.method || "GET").toUpperCase();

  const finalQuery: Record<string, any> = {
    ...(integ.endpoint?.default_query || {}),
  };
  const finalBody: any = method === "POST" ? { ...(integ.endpoint?.default_body || {}) } : undefined;

  Object.assign(finalQuery, params);

  const at = (integ as any).auth as
    | {
        type: "none" | "api_key" | "bearer" | "basic";
        in?: "header" | "query";
        name?: string;
        prefix?: string;
        key?: string;
      }
    | undefined;

  if (at?.type === "api_key" && at.in === "query" && at.name && at.key) {
    finalQuery[at.name] = at.prefix ? `${at.prefix} ${at.key}` : at.key;
  }

  return { finalQuery, finalBody, page, pageSize };
}

/**
 * Executa a busca na API externa conforme a integração salva.
 */
export async function runSearch(integ: InventoryIntegration, input: UniversalSearchInput) {
  if (!integ?.endpoint?.url) throw new AppError("Integration missing endpoint URL", 400);

  const method = (integ.endpoint.method || "GET").toUpperCase();
  const timeout = (integ.endpoint.timeout_s || 8) * 1000;

  const headers = buildHeaders(integ);
  const { finalQuery, finalBody, page, pageSize } = buildQueryAndBody(integ, input);

  // Monta URL com query
  const baseUrl = new URL(integ.endpoint.url);
  // Preserva query que já existir na URL
  baseUrl.searchParams.forEach((v, k) => {
    // mantemos os existentes; se vierem em finalQuery, sobrescrevem abaixo
  });
  Object.entries(finalQuery).forEach(([k, v]) => {
    // Se o valor for objeto/array, serializa em JSON (Vista aceita JSON em query)
    if (v !== null && typeof v === "object") {
      baseUrl.searchParams.set(k, JSON.stringify(v));
    } else if (v !== undefined) {
      baseUrl.searchParams.set(k, String(v));
    }
  });

  const axiosCfg = {
    method: method as any,
    url: baseUrl.toString(),
    timeout,
    headers, // objeto plano
    data: method === "POST" ? finalBody : undefined,
    // Não lançar erro por status != 2xx — deixamos para tratar manualmente
    validateStatus: () => true,
  };

  const resp = await axios(axiosCfg);

  if (resp.status >= 400) {
    const msg =
      (resp.data && (resp.data.message || resp.data.error)) ||
      `Upstream error (${resp.status})`;
    throw new AppError(`Inventory upstream: ${msg}`, 502);
  }

  // Normaliza
  const listPath = ((integ as any).rolemap?.list_path as string | null) ?? null;
  const normalized = normalizeResponse(resp.data, listPath, page, pageSize);

  return normalized;
}

export default runSearch;
