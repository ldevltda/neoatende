import axios, { AxiosRequestConfig } from "axios";
import { logger } from "../../utils/logger";
import InventoryIntegration from "../../models/InventoryIntegration";

/** ===== Tipos ===== */
export type AuthConfig =
  | { type: "none" }
  | { type: "api_key"; in: "header" | "query"; name: string; prefix?: string; key: string }
  | { type: "bearer"; token: string }
  | { type: "basic"; username: string; password: string };

export type EndpointConfig = {
  method: string;
  url: string;
  headers?: Record<string, string>;
  /** legado */
  defaults?: Record<string, any>;
  /** atuais */
  default_query?: Record<string, any>;
  default_body?: Record<string, any>;
  timeout_s?: number;
};

export type PaginationConfig =
  | { type: "none" }
  | { type: "page"; param?: string; sizeParam?: string }
  | { type: "offset"; param?: string; sizeParam?: string }
  | { type: "cursor"; param?: string; cursorPath?: string; sizeParam?: string };

export type IntegrationLike = {
  id: number | string;
  get: (key: string) => any;
};

export type RunSearchInput = {
  params?: Record<string, any>;
  page?: number;
  pageSize?: number;
  text?: string;
  filtros?: Record<string, any>;
};

export type RunSearchOutput = {
  items: any[];
  total?: number;
  page: number;
  pageSize: number;
  raw: any;
};

/** ===== Utils ===== */
function deepGet(obj: any, path: string, fallback?: any) {
  try {
    if (!path) return fallback;
    const parts = path.split(".");
    let cur = obj;
    for (const p of parts) {
      if (cur == null) return fallback;
      cur = cur[p];
    }
    return cur ?? fallback;
  } catch {
    return fallback;
  }
}

function applyAuthToRequest(cfg: AxiosRequestConfig, auth: AuthConfig | undefined | null) {
  if (!auth || auth.type === "none") return;
  cfg.headers = cfg.headers || {};
  cfg.params = cfg.params || {};
  switch (auth.type) {
    case "api_key": {
      const value = auth.prefix ? `${auth.prefix}${auth.key}` : auth.key;
      if (auth.in === "header") (cfg.headers as any)[auth.name] = value;
      else (cfg.params as any)[auth.name] = value;
      break;
    }
    case "bearer":
      (cfg.headers as any)["Authorization"] = `Bearer ${auth.token}`;
      break;
    case "basic": {
      const b64 = Buffer.from(`${auth.username}:${auth.password}`).toString("base64");
      (cfg.headers as any)["Authorization"] = `Basic ${b64}`;
      break;
    }
  }
}

function normalizeItems(items: any[], rolemap?: any): any[] {
  if (!Array.isArray(items)) return [];
  if (!rolemap || typeof rolemap !== "object") return items;

  // Suporta rolemap novo ({ fields: { k: "path" | {path} } }) e antigo ({ k: "path" })
  let mapping: Record<string, string> = {};
  if (rolemap.fields && typeof rolemap.fields === "object") {
    for (const [k, v] of Object.entries(rolemap.fields as Record<string, any>)) {
      if (typeof v === "string") mapping[k] = v;
      else if (v && typeof v === "object" && typeof (v as any).path === "string") {
        mapping[k] = (v as any).path;
      }
    }
  } else {
    mapping = rolemap as Record<string, string>;
  }
  if (!Object.keys(mapping).length) return items;

  const stripRoot = (p: string) => String(p).replace(/^\$\./, "");

  return items.map(src => {
    const dst: Record<string, any> = {};
    for (const [toKey, fromPathRaw] of Object.entries(mapping)) {
      if (!fromPathRaw) continue;
      const fromPath = stripRoot(fromPathRaw);
      const val = deepGet(src, fromPath, undefined);
      if (val !== undefined) dst[toKey] = val;
    }
    return Object.keys(dst).length ? dst : src;
  });
}

/** Extrai items/total respeitando schema, inclusive "$.*" (dicionário numerado) */
function extractFromResponse(
  respData: any,
  schema?: { itemsPath?: string; totalPath?: string }
): { items: any[]; total?: number } {
  const itemsPath = schema?.itemsPath || "data.items";
  const totalPath = schema?.totalPath || "data.total";

  if (itemsPath === "$.*") {
    if (Array.isArray(respData)) {
      return { items: respData, total: deepGet(respData, totalPath, undefined) };
    }
    if (respData && typeof respData === "object") {
      const items = Object.keys(respData)
        .filter(k => /^\d+$/.test(k))
        .map(k => (respData as any)[k])
        .filter(v => v && typeof v === "object");
      const total =
        deepGet(respData, totalPath, undefined) ??
        (typeof (respData as any).total === "number" ? (respData as any).total : undefined);
      return { items, total };
    }
    return { items: [], total: undefined };
  }

  const items = deepGet(respData, itemsPath, Array.isArray(respData) ? respData : []);
  const total =
    deepGet(respData, totalPath, undefined) ??
    (Array.isArray(items) ? items.length : undefined);
  return { items: Array.isArray(items) ? items : [], total };
}

/** Normaliza paginação salva como {strategy,page_param,size_param} -> {type,param,sizeParam} */
function normalizePaginationShape(pag: any): PaginationConfig | undefined {
  if (!pag) return undefined;
  if ((pag as any).type) return pag as PaginationConfig;
  if ((pag as any).strategy) {
    const typeMap: any = { page: "page", offset: "offset", cursor: "cursor", none: "none" };
    return {
      type: typeMap[pag.strategy] || "none",
      param: pag.page_param || (pag.strategy === "offset" ? "offset" : "page"),
      sizeParam: pag.size_param || (pag.strategy === "offset" ? "limit" : "pageSize")
    };
  }
  return pag as PaginationConfig;
}

function applyPagination(
  planned: Record<string, any>,
  pagination: PaginationConfig | undefined,
  page: number,
  pageSize: number
) {
  if (!pagination || pagination.type === "none") return;
  const pName = pagination.param || (pagination.type === "offset" ? "offset" : "page");
  const sName = pagination.sizeParam || (pagination.type === "offset" ? "limit" : "pageSize");
  if (pagination.type === "page") {
    planned[pName] = page;
    planned[sName] = pageSize;
  } else if (pagination.type === "offset") {
    planned[pName] = Math.max(0, (page - 1) * pageSize);
    planned[sName] = pageSize;
  }
}

/** ===== Executor de baixo nível (mantido, como já existia) ===== */
export async function runSearch(
  integration: IntegrationLike,
  { params = {}, page = 1, pageSize = 10, text, filtros = {} }: RunSearchInput
): Promise<RunSearchOutput> {
  const integrationId = (integration as any)?.id ?? (integration as any)?.get?.("id");

  const endpoint: EndpointConfig = (integration as any).get("endpoint");
  const auth: AuthConfig = (integration as any).get("auth");
  const rawPagination: any = (integration as any).get("pagination");
  const pagination = normalizePaginationShape(rawPagination);
  const rolemap: any = (integration as any).get("rolemap");
  const schema: { itemsPath?: string; totalPath?: string } | undefined = (integration as any).get("schema");

  const method = (endpoint?.method || "GET").toUpperCase();
  const url = endpoint?.url;
  const timeout = (endpoint?.timeout_s || 30) * 1000;

  // respeita o que está configurado
  const defaults =
    method === "GET"
      ? endpoint?.default_query || endpoint?.defaults || {}
      : endpoint?.default_body || endpoint?.defaults || {};

  // Monta params finais
  const plannedParams: Record<string, any> = {
    ...(defaults || {}),
    ...(params || {}),
    ...(filtros || {})
  };

  // Aplica paginação
  applyPagination(plannedParams, pagination, page, pageSize);

  // Se 'pesquisa' for objeto, stringifica; se já for string, não mexe
  if (
    Object.prototype.hasOwnProperty.call(plannedParams, "pesquisa") &&
    typeof plannedParams.pesquisa === "object"
  ) {
    plannedParams.pesquisa = JSON.stringify(plannedParams.pesquisa);
  }

  logger.debug(
    {
      ctx: "RunSearchService",
      integrationId,
      method,
      url,
      hasDefaults:
        !!endpoint?.default_query || !!endpoint?.default_body || !!endpoint?.defaults,
      hasAuth: !!auth && (auth as any).type !== "none",
      paginationType: pagination?.type || "none",
      page,
      pageSize,
      plannedParams
    },
    "calling provider"
  );

  const reqCfg: AxiosRequestConfig = {
    method,
    url,
    timeout,
    headers: { ...(endpoint?.headers || {}) },
    ...(method === "GET" ? { params: plannedParams } : { data: plannedParams })
  };

  applyAuthToRequest(reqCfg, auth);

  const t0 = Date.now();
  let responseData: any;
  try {
    const resp = await axios.request(reqCfg);
    responseData = resp.data;
    logger.debug(
      { ctx: "RunSearchService", integrationId, status: resp.status, ms: Date.now() - t0 },
      "provider response"
    );
  } catch (err: any) {
    logger.error(
      {
        ctx: "RunSearchService",
        integrationId,
        status: err?.response?.status,
        ms: Date.now() - t0,
        error: err?.message,
        data: err?.response?.data
      },
      "provider error"
    );
    throw err;
  }

  const { items, total } = extractFromResponse(responseData, schema);
  const normalized = normalizeItems(items, rolemap);

  logger.debug(
    {
      ctx: "RunSearchService",
      integrationId,
      extractedItems: Array.isArray(items) ? items.length : 0,
      normalizedItems: Array.isArray(normalized) ? normalized.length : 0,
      total
    },
    "normalized result"
  );

  return {
    items: normalized,
    total,
    page,
    pageSize,
    raw: responseData
  };
}

/** ===== Executor de alto nível (compatível com handleOpenAi) =====
 * Espera:
 *   { companyId, integrationId?, criteria, page, limit, ... }
 * - Busca a integração no banco (por id ou primeira da empresa)
 * - Passa `criteria` como query param `pesquisa` (obj → stringificado)
 */
export async function run(args: {
  companyId: number;
  integrationId?: number | string | null;
  criteria?: Record<string, any>;
  page?: number;
  limit?: number;
  sort?: string;
  locale?: string;
}): Promise<RunSearchOutput> {
  const {
    companyId,
    integrationId,
    criteria = {},
    page = 1,
    limit = 10
  } = args || ({} as any);

  // 1) Resolve integração
  let integration: any = null;

  if (integrationId) {
    integration = await InventoryIntegration.findOne({
      where: { id: integrationId, companyId }
    });
  }

  if (!integration) {
    // fallback: pega a primeira da empresa
    integration = await InventoryIntegration.findOne({
      where: { companyId },
      order: [["id", "ASC"]]
    });
  }

  if (!integration) {
    throw new Error("Nenhuma integração de inventário encontrada para a empresa.");
  }

  // 2) Monta filtros para o executor de baixo nível:
  //    - Enviamos como { pesquisa: criteria } para atender provedores
  //      que esperam o parâmetro `pesquisa` (obj será stringificado em runSearch).
  const filtros = { pesquisa: criteria };

  // 3) Chama o executor principal
  return runSearch(integration, {
    page,
    pageSize: limit,
    filtros
  });
}

// Deixa super-compatível com imports variados
export default run;
