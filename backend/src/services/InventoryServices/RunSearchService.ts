import InventoryIntegration from "../../models/InventoryIntegration";
import { httpRequest } from "./httpClient";
import { buildParamsForApi, UniversalSearchInput } from "./PlannerService";
import { ensureRolemap } from "./RoleMapperService";
import { normalizeItems } from "./NormalizeService";

export async function runSearch(integ: InventoryIntegration, input: UniversalSearchInput) {
  // garante rolemap (auto)
  if (!integ.rolemap || !integ.schema) {
    const { fetchSamplesAndInfer } = await import("./InferSchemaService");
    const { samples, inferred } = await fetchSamplesAndInfer(integ);
    const rolemap = ensureRolemap(integ, samples?.[0]);
    integ.schema = inferred;
    integ.rolemap = rolemap;
    await integ.save();
  }

  const { params, page, pageSize } = buildParamsForApi(input, integ.pagination);

  const cfg = {
    method: integ.endpoint.method,
    url: integ.endpoint.url,
    headers: { ...(integ.endpoint.headers || {}) } as Record<string, string>,
    params: { ...(integ.endpoint.default_query || {}), ...params } as Record<string, any>,
    data: integ.endpoint.default_body || {},
    timeout: (integ.endpoint.timeout_s || 8) * 1000
  };

  // auth
  const auth = integ.auth;
  if (auth?.type === "api_key" && auth.in && auth.name && auth.key) {
    if (auth.in === "header") {
      cfg.headers[auth.name] = auth.key;
    } else {
      (cfg.params as any)[auth.name] = auth.key;
    }
  }
  if (auth?.type === "bearer" && auth.key) {
    cfg.headers["Authorization"] = `${auth.prefix || "Bearer "}${auth.key}`;
  }
  if (auth?.type === "basic" && auth.username && auth.password) {
    const token = Buffer.from(`${auth.username}:${auth.password}`).toString("base64");
    cfg.headers["Authorization"] = `Basic ${token}`;
  }

  const resp = await httpRequest(cfg);
  const normalized = normalizeItems(resp.data, integ, page, pageSize);
  return normalized;
}
