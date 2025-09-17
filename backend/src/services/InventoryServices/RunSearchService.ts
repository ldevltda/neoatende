import axios, { AxiosRequestConfig } from "axios";
import { logger } from "../../utils/logger";

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

  // Detecta formato novo ({ listPath, fields: { k: {path} | "path" } })
  let mapping: Record<string, string> = {};
  if (rolemap && typeof rolemap === "object" && rolemap.fields) {
    const fields = rolemap.fields as Record<string, any>;
    for (const [k, v] of Object.entries(fields)) {
      if (typeof v === "string") mapping[k] = v;
      else if (v && typeof v === "object" && typeof (v as any).path === "string") {
        mapping[k] = (v as any).path;
      }
    }
  } else {
    // Formato antigo (campo -> "TituloSite")
    mapping = rolemap as Record<string, string>;
  }

  // Se por algum motivo não houver mapeamento útil, devolve itens crus
  if (!mapping || !Object.keys(mapping).length) return items;

  const stripRoot = (p: string) => String(p).replace(/^\$\./, "");

  return items.map((src) => {
    const dst: Record<string, any> = {};
    for (const [toKey, fromPathRaw] of Object.entries(mapping)) {
      if (!fromPathRaw) continue;
      const fromPath = stripRoot(fromPathRaw as string);
      const val = deepGet(src, fromPath, undefined);
      if (val !== undefined) dst[toKey] = val;
    }
    // só usa o mapeado se pegou ao menos 1 valor; senão, devolve o objeto original
    return Object.keys(dst).length ? dst : src;
  });
}

/** ←—— Tipagem EXPLÍCITA do retorno evita “void” */
function extractFromResponse(
  respData: any,
  schema?: { itemsPath?: string; totalPath?: string }
): { items: any[]; total?: number } {
  let itemsPath = schema?.itemsPath || "data.items";
  const totalPath = schema?.totalPath || "data.total";

  // Caso especial: itens no ROOT como dicionário numerado (Vista) — usamos "$.*"
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

/* =======================
   Builders de filtros (Vista)
   ======================= */

// Converte "500 mil", "500k", "1.2 mi" -> número (R$)
function parseMoney(text?: string): number | undefined {
  if (!text) return;
  const t = text.normalize("NFD").replace(/\p{Diacritic}/gu, "").toLowerCase();

  // "1.2 mi", "1,2 mi", "1 mi", "1m"
  let m = t.match(/(\d+(?:[\.,]\d+)?)\s*m[i]?\b/);
  if (m) {
    const n = Number(String(m[1]).replace(".", "").replace(",", "."));
    return Math.round(n * 1_000_000);
  }

  // "500 mil" / "500mil"
  m = t.match(/(\d+(?:[\.,]\d+)?)\s*mi[l]\b/);
  if (m) {
    const n = Number(String(m[1]).replace(".", "").replace(",", "."));
    return Math.round(n * 1_000);
  }

  // "500k"
  m = t.match(/(\d+(?:[\.,]\d+)?)\s*k\b/);
  if (m) {
    const n = Number(String(m[1]).replace(".", "").replace(",", "."));
    return Math.round(n * 1_000);
  }

  // número com separador de milhar
  m = t.match(/(\d{2,3}(?:[\.\s]\d{3})+|\d{4,})/);
  if (m) {
    const n = Number(String(m[1]).replace(/\D/g, ""));
    return Number.isFinite(n) ? n : undefined;
  }

  return undefined;
}

// Cria { pesquisa.filter } a partir do texto livre
function buildVistaPesquisaFromText(text?: string) {
  const out: any = { filter: {} as any };
  if (!text) return out;

  const t = text.normalize("NFD").replace(/\p{Diacritic}/gu, ""); // remove acentos

  // Dormitórios: "2 quartos", "2 qts", "2 dormitorios"
  const mDorm = t.match(/(\d+)\s*(quarto|qts?|dormitorios?)/i);
  if (mDorm) {
    const q = Number(mDorm[1]);
    if (q > 0) out.filter.Dormitorios = { min: q, max: q };
  }

  // Bairro: "bairro Campinas"
  const mBairro = t.match(/bairro\s+([A-Za-z0-9\s\-]+)/i);
  if (mBairro) {
    const bairro = mBairro[1].trim().replace(/\s{2,}/g, " ");
    if (bairro) out.filter.Bairro = [bairro];
  }

  // Cidade/UF: "São José/SC"
  const mCidadeUF = t.match(/([A-Za-z\s\.]+)\/([A-Za-z]{2})/);
  if (mCidadeUF) {
    const cidade = mCidadeUF[1].trim().replace(/\s{2,}/g, " ");
    const uf = mCidadeUF[2].toUpperCase();
    if (cidade) out.filter.Cidade = [cidade];
    out.filter.Estado = [uf];
  }

  // Preço máximo: "até 500 mil", "ate 500k", "até 600.000"
  const hasAte = /(?:ate|até)\s+/i.test(t);
  if (hasAte) {
    const val = parseMoney(t);
    if (val) {
      out.filter.ValorVenda = { ...(out.filter.ValorVenda || {}), max: val };
    }
  }

  return out;
}

/** ===== Executor principal ===== */
export async function runSearch(
  integration: IntegrationLike,
  { params = {}, page = 1, pageSize = 10, text, filtros = {} }: RunSearchInput
): Promise<RunSearchOutput> {
  const integrationId = (integration as any)?.id ?? integration?.get?.("id");

  const endpoint: EndpointConfig = (integration as any).get("endpoint");
  const auth: AuthConfig = (integration as any).get("auth");
  const pagination: PaginationConfig = (integration as any).get("pagination");
  const rolemap: any = (integration as any).get("rolemap");
  const schema: { itemsPath?: string; totalPath?: string } | undefined = (integration as any).get("schema");

  const method = (endpoint?.method || "GET").toUpperCase();
  const url = endpoint?.url;
  const timeout = (endpoint?.timeout_s || 30) * 1000;

  const defaults =
    method === "GET"
      ? endpoint?.default_query || endpoint?.defaults || {}
      : endpoint?.default_body || endpoint?.defaults || {};

  const plannedParams: Record<string, any> = {
    ...(defaults || {}),
    ...(params || {}),
    ...(filtros || {})
  };

  applyPagination(plannedParams, pagination, page, pageSize);

  // ——— builder de filtros para Vista a partir do "text"
  const isVista = typeof url === "string" && /vistahost\.com\.br/i.test(url);
  if (isVista) {
    const currentPesquisa =
      (plannedParams.pesquisa && typeof plannedParams.pesquisa === "object")
        ? plannedParams.pesquisa
        : {};

    const built = buildVistaPesquisaFromText(text);

    // mescla preservando o que o default_query já tiver
    const mergedFilter = {
      ...(currentPesquisa.filter || {}),
      ...(built.filter || {})
    };

    plannedParams.pesquisa = {
      ...(currentPesquisa || {}),
      filter: mergedFilter
    };
  }

  // Stringifica a pesquisa (objeto) para query/body
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
      paginationType: (pagination as any)?.type || "none",
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
