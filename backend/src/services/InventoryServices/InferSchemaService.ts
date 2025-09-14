import InventoryIntegration from "../../models/InventoryIntegration";
import { httpRequest } from "./httpClient";
import { logger } from "../../utils/logger";

/**
 * Busca 1-2 amostras do endpoint para inferência.
 * Não persiste nada – apenas retorna o payload bruto e um “esqueleto” de schema.
 */
export async function fetchSamplesAndInfer(integ: InventoryIntegration) {
  const { endpoint, auth, pagination } = integ;

  const baseConfig = {
    method: endpoint.method,
    url: endpoint.url,
    headers: { ...(endpoint.headers || {}) } as Record<string, string>,
    params: { ...(endpoint.default_query || {}) } as Record<string, any>,
    data: endpoint.default_body || {},
    timeout: (endpoint.timeout_s || 8) * 1000
  };

  // auth
  if (auth?.type === "api_key" && auth.in && auth.name && auth.key) {
    if (auth.in === "header") {
      baseConfig.headers[auth.name] = auth.key;
    } else {
      baseConfig.params[auth.name] = auth.key;
    }
  }
  if (auth?.type === "bearer" && auth.key) {
    baseConfig.headers["Authorization"] = `${auth.prefix || "Bearer "}${auth.key}`;
  }
  if (auth?.type === "basic" && auth.username && auth.password) {
    const token = Buffer.from(`${auth.username}:${auth.password}`).toString("base64");
    baseConfig.headers["Authorization"] = `Basic ${token}`;
  }

  // 1ª página
  let first = await httpRequest(baseConfig);

  // 2ª página (se tiver paginação page/size)
  let second: any = null;
  if (pagination?.strategy === "page" && pagination.page_param && pagination.size_param) {
    const cfg2 = {
      ...baseConfig,
      params: {
        ...(baseConfig.params || {}),
        [pagination.page_param]: 2,
        [pagination.size_param]: pagination.page_size_default || 20
      }
    };
    second = await httpRequest(cfg2);
  }

  const samples = [first?.data, second?.data].filter(Boolean);
  const inferred = inferSchemaSkeleton(samples[0]);

  return { samples, inferred };
}

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
      Object.keys(node || {}).forEach(k => {
        props[k] = walk(node[k]);
      });
      return { type: "object", properties: props };
    }
    return { type: t };
  }

  return walk(payload || {});
}
