// backend/src/services/InventoryServices/QueryParamBuilder.ts
import InventoryIntegration from "../../models/InventoryIntegration";

type AnyMap = Record<string, any>;

/**
 * Converte filtros canônicos normalizados em query params
 * respeitando o querymap e a configuração de paginação da integração.
 */
export function buildQueryParams(
  integ: InventoryIntegration,
  normalizedFilters: AnyMap
): AnyMap {
  const qp: AnyMap = {};

  // rolemap + querymap (flexível com dois nomes: querymap | queryMap)
  const rolemap: AnyMap = ((integ as any).rolemap || {}) as AnyMap;
  const map: AnyMap =
    (rolemap.querymap as AnyMap) ||
    (rolemap.queryMap as AnyMap) ||
    ({} as AnyMap);

  // mapeia chaves canônicas → parâmetro esperado pela integração
  for (const [key, val] of Object.entries(normalizedFilters || {})) {
    const target = map[key];
    if (!target) continue;
    if (val === undefined || val === null || val === "") continue;
    qp[target] = val;
  }

  // paginação (usa naming da integração se existir)
  const pag = ((integ as any).pagination || {}) as AnyMap;
  const pageParam = (pag.page_param as string) || "page";
  const sizeParam = (pag.size_param as string) || "per_page";

  if (normalizedFilters.__page != null) {
    qp[pageParam] = normalizedFilters.__page;
  }
  if (normalizedFilters.__pageSize != null) {
    qp[sizeParam] = normalizedFilters.__pageSize;
  }

  return qp;
}
