// backend/src/services/InventoryServices/RunSearchService.ts
import axios, { AxiosRequestConfig } from "axios";
import { logger } from "../../utils/logger";

/**
 * Tipos auxiliares (ajuste se seu projeto já tiver tipos próprios)
 */
type AuthConfig =
  | { type: "none" }
  | { type: "api_key"; in: "header" | "query"; name: string; prefix?: string; key: string }
  | { type: "bearer"; token: string }
  | { type: "basic"; username: string; password: string };

type EndpointConfig = {
  method: string;             // GET | POST | ...
  url: string;                // URL base/rota
  headers?: Record<string, string>;
  defaults?: Record<string, any>; // parâmetros/body padrão
  timeout_s?: number;
};

type PaginationConfig =
  | { type: "none" }
  | { type: "page"; param?: string; sizeParam?: string }
  | { type: "offset"; param?: string; sizeParam?: string }
  | { type: "cursor"; param?: string; cursorPath?: string; sizeParam?: string };

type IntegrationLike = {
  id: number | string;
  get: (key: string) => any; // Sequelize model .get()
};

type RunSearchInput = {
  params?: Record<string, any>; // query/body já planejado pelo PlannerService
  page?: number;
  pageSize?: number;
  text?: string;
  filtros?: Record<string, any>;
};

type RunSearchOutput = {
  items: any[];
  total?: number;
  page?: number;
  pageSize?: number;
  raw?: any;
};

/** Utilitário simples para acessar paths tipo "data.items" */
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

/** Aplica autenticação na request (header/query) */
function applyAuthToRequest(
  cfg: AxiosRequestConfig,
  auth: AuthConfig | undefined | null
) {
  if (!auth || auth.type === "none") return;

  cfg.headers = cfg.headers || {};
  cfg.params = cfg.params || {};

  switch (auth.type) {
    case "api_key": {
      const value = auth.prefix ? `${auth.prefix}${auth.key}` : auth.key;
      if (auth.in === "header") {
        cfg.headers[auth.name] = value;
      } else {
        (cfg.params as any)[auth.name] = value;
      }
      break;
    }
    case "bearer": {
      cfg.headers["Authorization"] = `Bearer ${auth.token}`;
      break;
    }
    case "basic": {
      const b64 = Buffer.from(`${auth.username}:${auth.password}`).toString("base64");
      cfg.headers["Authorization"] = `Basic ${b64}`;
      break;
    }
  }
}

/** Normaliza itens com base no rolemap (chave destino <- path origem) */
function normalizeItems(items: any[], rolemap?: Record<string, string>): any[] {
  if (!Array.isArray(items)) return [];
  if (!rolemap || typeof rolemap !== "object") return items;

  return items.map(src => {
    const dst: Record<string, any> = {};
    for (const [toKey, fromPath] of Object.entries(rolemap)) {
      dst[toKey] = deepGet(src, String(fromPath), undefined);
    }
    return Object.keys(dst).length ? dst : src;
  });
}

/** Extrai itens/total do response segundo schema básico (ajuste se usa outro padrão) */
function extractFromResponse(
  respData: any,
  schema?: { itemsPath?: string; totalPath?: string }
) {
  // Padrão bem comum: data.items / data.total
  const itemsPath = schema?.itemsPath || "data.items";
  const totalPath = schema?.totalPath || "data.total";

  const items = deepGet(respData, itemsPath, Array.isArray(respData) ? respData : []);
  const total = deepGet(respData, totalPath, Array.isArray(items) ? items.length : undefined);

  return { items, total };
}

/**
 * Executor principal:
 * - Monta request (method/url/headers/params/body) a partir da integração
 * - Chama o provedor
 * - Extrai items/total
 * - Aplica rolemap
 * - Retorna normalizado + raw
 */
export async function runSearch(
  integration: IntegrationLike,
  { params = {}, page = 1, pageSize = 10, text, filtros = {} }: RunSearchInput
): Promise<RunSearchOutput> {
  const integrationId = integration?.id ?? integration?.get?.("id");

  // Lê configs da integração
  const endpoint: EndpointConfig = integration.get("endpoint");
  const auth: AuthConfig = integration.get("auth");
  const pagination: PaginationConfig = integration.get("pagination");
  const rolemap: Record<string, string> | undefined = integration.get("rolemap");
  const schema: { itemsPath?: string; totalPath?: string } | undefined = integration.get("schema");

  // Monta a request
  const method = (endpoint?.method || "GET").toUpperCase();
  const url = endpoint?.url;
  const timeout = (endpoint?.timeout_s || 30) * 1000;

  // Query/body
  const plannedParams = { ...(endpoint?.defaults || {}), ...(params || {}) };

  // Logs antes da chamada
  logger.debug({
    ctx: "RunSearchService",
    integrationId,
    method,
    url,
    hasDefaults: !!endpoint?.defaults,
    hasAuth: !!auth && auth.type !== "none",
    paginationType: pagination?.type || "none",
    page,
    pageSize,
    plannedParams
  }, "calling provider");

  const reqCfg: AxiosRequestConfig = {
    method,
    url,
    timeout,
    headers: { ...(endpoint?.headers || {}) },
    // Por padrão: método GET → usa params; outros → usa data
    ...(method === "GET"
      ? { params: plannedParams }
      : { data: plannedParams })
  };

  // Autenticação
  applyAuthToRequest(reqCfg, auth);

  // Chamada externa
  const t0 = Date.now();
  let responseData: any = null;
  let status: number | undefined;

  try {
    const resp = await axios.request(reqCfg);
    status = resp.status;
    responseData = resp.data;

    const ms = Date.now() - t0;
    logger.debug({
      ctx: "RunSearchService",
      integrationId,
      status,
      ms
    }, "provider response");
  } catch (err: any) {
    const ms = Date.now() - t0;
    status = err?.response?.status;
    logger.error({
      ctx: "RunSearchService",
      integrationId,
      status,
      ms,
      error: err?.message,
      data: err?.response?.data
    }, "provider error");
    throw err;
  }

  // Extração + normalização
  const { items, total } = extractFromResponse(responseData, schema);
  const normalized = normalizeItems(items, rolemap);

  logger.debug({
    ctx: "RunSearchService",
    integrationId,
    extractedItems: Array.isArray(items) ? items.length : 0,
    normalizedItems: Array.isArray(normalized) ? normalized.length : 0,
    total
  }, "normalized result");

  return {
    items: normalized,
    total,
    page,
    pageSize,
    raw: responseData
  };
}
