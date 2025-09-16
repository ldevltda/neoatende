// backend/src/services/InventoryServices/RunSearchService.ts
import axios, { AxiosRequestConfig } from "axios";
import { logger } from "../../utils/logger";

/**
 * Tipos auxiliares
 */
type AuthConfig =
  | { type: "none" }
  | { type: "api_key"; in: "header" | "query"; name: string; prefix?: string; key: string }
  | { type: "bearer"; token: string }
  | { type: "basic"; username: string; password: string };

type EndpointConfig = {
  method: string;                   // GET | POST | ...
  url: string;                      // URL base/rota
  headers?: Record<string, string>;
  /** Suporte legado (se existir) */
  defaults?: Record<string, any>;
  /** Campos novos usados pela tela (GET usa default_query; POST usa default_body) */
  default_query?: Record<string, any>;
  default_body?: Record<string, any>;
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
  filtros?: Record<string, any>; // vindo do modal "Filtros (JSON)"
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
function applyAuthToRequest(cfg: AxiosRequestConfig, auth: AuthConfig | undefined | null) {
  if (!auth || auth.type === "none") return;

  cfg.headers = cfg.headers || {};
  cfg.params = cfg.params || {};

  switch (auth.type) {
    case "api_key": {
      const value = auth.prefix ? `${auth.prefix}${auth.key}` : auth.key;
      if (auth.in === "header") {
        (cfg.headers as any)[auth.name] = value;
      } else {
        (cfg.params as any)[auth.name] = value;
      }
      break;
    }
    case "bearer": {
      (cfg.headers as any)["Authorization"] = `Bearer ${auth.token}`;
      break;
    }
    case "basic": {
      const b64 = Buffer.from(`${auth.username}:${auth.password}`).toString("base64");
      (cfg.headers as any)["Authorization"] = `Basic ${b64}`;
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
  const itemsPath = schema?.itemsPath || "data.items";
  const totalPath = schema?.totalPath || "data.total";

  const items = deepGet(respData, itemsPath, Array.isArray(respData) ? respData : []);
  const total = deepGet(respData, totalPath, Array.isArray(items) ? items.length : undefined);

  return { items, total };
}

/** Aplica paginação nos parâmetros conforme a config */
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
  // cursor: deixamos para um próximo passo (depende do cursor da resposta anterior)
}

/**
 * Executor principal
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

  // Query/body defaults por método
  const defaults =
    method === "GET"
      ? endpoint?.default_query || endpoint?.defaults || {}
      : endpoint?.default_body || endpoint?.defaults || {};

  // Começa pelos defaults, depois params planejados e por fim filtros do modal
  const plannedParams: Record<string, any> = {
    ...(defaults || {}),
    ...(params || {}),
    ...(filtros || {})
  };

  // Aplica paginação nos nomes configuráveis
  applyPagination(plannedParams, pagination, page, pageSize);

  // Vista API: se "pesquisa" for objeto, precisa ser string JSON
  if (
    Object.prototype.hasOwnProperty.call(plannedParams, "pesquisa") &&
    typeof plannedParams.pesquisa === "object"
  ) {
    plannedParams.pesquisa = JSON.stringify(plannedParams.pesquisa);
  }

  // Logs antes da chamada
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
    logger.debug({ ctx: "RunSearchService", integrationId, status, ms }, "provider response");
  } catch (err: any) {
    const ms = Date.now() - t0;
    status = err?.response?.status;
    logger.error(
      {
        ctx: "RunSearchService",
        integrationId,
        status,
        ms,
        error: err?.message,
        data: err?.response?.data
      },
      "provider error"
    );
    throw err;
  }

  // Extração + normalização
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
