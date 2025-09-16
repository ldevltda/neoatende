// backend/src/services/InventoryServices/InferSchemaService.ts
import InventoryIntegration from "../../models/InventoryIntegration";
import { httpRequest } from "./httpClient";
import { logger } from "../../utils/logger";

/**
 * Tipos frouxos para aceitar as duas variantes de configuração presentes no projeto.
 */
type EndpointLike = {
  method: string;
  url: string;
  headers?: Record<string, string>;
  defaults?: Record<string, any>;       // legado
  default_query?: Record<string, any>;  // atual (GET)
  default_body?: Record<string, any>;   // atual (POST)
  timeout_s?: number;
};

type PaginationLike =
  | {
      strategy?: "none" | "page" | "offset" | "cursor"; // variante A
      page_param?: string;
      size_param?: string;
      page_size_default?: number;
      cursor_param?: string;
    }
  | {
      type?: "none" | "page" | "offset" | "cursor";     // variante B
      param?: string;
      sizeParam?: string;
      cursorPath?: string;
    }
  | null
  | undefined;

type AuthLike =
  | { type: "none" }
  | { type: "api_key"; in: "header" | "query"; name: string; prefix?: string; key: string }
  | { type: "bearer"; token?: string; key?: string; prefix?: string }
  | { type: "basic"; username: string; password: string }
  | null
  | undefined;

/** Helpers para ler via .get() ou propriedade direta */
function readCfg<T = any>(obj: any, key: string): T {
  return (obj?.get ? obj.get(key) : obj?.[key]) as T;
}

/** Stringifica apenas valores-objeto em query params (não mexe em body). */
function stringifyObjectParams(params: Record<string, any> | undefined) {
  if (!params) return;
  Object.keys(params).forEach((k) => {
    const v = params[k];
    if (v && typeof v === "object") {
      try {
        params[k] = JSON.stringify(v);
      } catch {
        // ignora se não der para stringificar
      }
    }
  });
}

/** Converte as duas variantes de paginação em um shape comum. */
function normalizePagination(p: PaginationLike) {
  if (!p) return { type: "none" as const };
  const strategy = (p as any).strategy ?? (p as any).type ?? "none";
  return {
    type: strategy as "none" | "page" | "offset" | "cursor",
    pageParam: (p as any).page_param ?? (p as any).param ?? "page",
    sizeParam: (p as any).size_param ?? (p as any).sizeParam ?? "pageSize",
    defaultSize: (p as any).page_size_default ?? 20,
    cursorParam: (p as any).cursor_param ?? undefined
  };
}

/** Heurística simples para encontrar o primeiro caminho que é array. */
function findFirstArrayPath(obj: any, base = "data"): string | null {
  try {
    if (Array.isArray(obj)) return base;
    if (obj && typeof obj === "object") {
      for (const k of Object.keys(obj)) {
        const found = findFirstArrayPath((obj as any)[k], base ? `${base}.${k}` : k);
        if (found) return found;
      }
    }
  } catch {}
  return null;
}

/** Candidatos de total (sem fixo de provedor). */
function collectTotalPathCandidates(obj: any): string[] {
  const candidates = ["data.total", "total", "data.totalCount", "totalCount", "meta.total", "count"];
  const ok: string[] = [];
  for (const p of candidates) {
    try {
      const val = p.split(".").reduce((acc: any, k) => (acc ? acc[k] : undefined), obj);
      if (typeof val === "number") ok.push(p);
    } catch {}
  }
  return ok;
}

/** Monta um skeleton de tipos (object/array/primitive). */
function inferSchemaSkeleton(payload: any) {
  function typeOf(x: any): string {
    if (Array.isArray(x)) return "array";
    return typeof x;
  }
  function walk(node: any): any {
    const t = typeOf(node);
    if (t === "array") {
      return { type: "array", items: node.length ? walk(node[0]) : { type: "any" } };
    }
    if (t === "object") {
      const props: Record<string, any> = {};
      Object.keys(node || {}).forEach((k) => {
        props[k] = walk(node[k]);
      });
      return { type: "object", properties: props };
    }
    return { type: t };
  }
  return walk(payload ?? {});
}

/**
 * Busca 1–2 amostras do endpoint e retorna:
 * - samples: payloads brutos
 * - skeleton: estrutura de tipos
 * - firstArrayPath: onde parece estar a lista de itens
 * - totalPathCandidates: possíveis caminhos de total
 * - sampleItem: primeiro item do array encontrado (se houver)
 *
 * NÃO persiste nada. Sem nada fixo de provedor.
 */
export async function fetchSamplesAndInfer(integ: InventoryIntegration) {
  const endpoint = (readCfg<EndpointLike>(integ, "endpoint")) ?? (integ as any).endpoint;
  const auth = (readCfg<AuthLike>(integ, "auth")) ?? (integ as any).auth;
  const pagination = normalizePagination(readCfg<PaginationLike>(integ, "pagination") ?? (integ as any).pagination);

  const method = (endpoint?.method || "GET").toUpperCase();
  const timeout = (endpoint?.timeout_s || 8) * 1000;

  // Defaults (suporta os dois formatos existentes no projeto)
  const defaults =
    method === "GET"
      ? endpoint?.default_query || endpoint?.defaults || {}
      : endpoint?.default_body || endpoint?.defaults || {};

  // Base config (sem nada fixo)
  const baseConfig: any = {
    method,
    url: endpoint?.url,
    headers: { ...(endpoint?.headers || {}) },
    params: method === "GET" ? { ...(defaults || {}) } : undefined,
    data: method !== "GET" ? { ...(defaults || {}) } : undefined,
    timeout
  };

  // Auth genérico
  if (auth && auth.type && auth.type !== "none") {
    if (auth.type === "api_key" && (auth as any).in && (auth as any).name && (auth as any).key) {
      const keyVal = (auth as any).prefix ? `${(auth as any).prefix}${(auth as any).key}` : (auth as any).key;
      if ((auth as any).in === "header") {
        baseConfig.headers[(auth as any).name] = keyVal;
      } else {
        baseConfig.params = baseConfig.params || {};
        baseConfig.params[(auth as any).name] = keyVal;
      }
    } else if (auth.type === "bearer") {
      const token = (auth as any).token ?? (auth as any).key;
      if (token) {
        const prefix = (auth as any).prefix ?? "Bearer ";
        baseConfig.headers["Authorization"] = `${prefix}${token}`;
      }
    } else if (auth.type === "basic") {
      const { username, password } = auth as any;
      if (username && password) {
        const b64 = Buffer.from(`${username}:${password}`).toString("base64");
        baseConfig.headers["Authorization"] = `Basic ${b64}`;
      }
    }
  }

  // Stringifica objetos em params (querystring) — genérico, sem fixo
  if (baseConfig.params) stringifyObjectParams(baseConfig.params);

  // 1ª página
  let first: any = null;
  try {
    first = await httpRequest(baseConfig);
  } catch (err: any) {
    logger.error({ ctx: "InferSchemaService", step: "first", error: err?.message }, "request error");
    throw err;
  }

  // 2ª página (se estratégia suportar page/size)
  let second: any = null;
  if (pagination.type === "page") {
    const cfg2 = {
      ...baseConfig,
      params:
        method === "GET"
          ? {
              ...(baseConfig.params || {}),
              [pagination.pageParam]: 2,
              [pagination.sizeParam]: pagination.defaultSize
            }
          : undefined,
      data:
        method !== "GET"
          ? {
              ...(baseConfig.data || {}),
              [pagination.pageParam]: 2,
              [pagination.sizeParam]: pagination.defaultSize
            }
          : undefined
    };
    if (cfg2.params) stringifyObjectParams(cfg2.params);

    try {
      second = await httpRequest(cfg2);
    } catch (err: any) {
      // não é crítico falhar na 2ª amostra
      logger.warn({ ctx: "InferSchemaService", step: "second", warn: err?.message }, "second page failed");
    }
  }

  const samples = [first?.data, second?.data].filter(Boolean);

  // Inferências auxiliares
  const payload = samples[0];
  const firstArrayPath = findFirstArrayPath(payload, "data");
  const totalPathCandidates = collectTotalPathCandidates(payload);

  let sampleItem: any = null;
  if (firstArrayPath) {
    try {
      const arr = firstArrayPath
        .split(".")
        .reduce((acc: any, k) => (acc ? acc[k] : undefined), payload);
      if (Array.isArray(arr) && arr.length) sampleItem = arr[0];
    } catch {}
  }

  const skeleton = inferSchemaSkeleton(payload);

  logger.info(
    {
      ctx: "InferSchemaService",
      url: endpoint?.url,
      method,
      gotSamples: samples.length,
      firstArrayPath,
      totalPathCandidates,
      sampleItemKeys: sampleItem ? Object.keys(sampleItem).slice(0, 12) : []
    },
    "infer finished"
  );

  return {
    samples,
    skeleton,
    firstArrayPath,        // sugestão para schema.itemsPath
    totalPathCandidates,   // sugestões para schema.totalPath
    sampleItem             // útil para a UI exibir
  };
}
