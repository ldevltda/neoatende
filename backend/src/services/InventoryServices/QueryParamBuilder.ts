// backend/src/services/InventoryServices/QueryParamBuilder.ts
import InventoryIntegration from "../../models/InventoryIntegration";

type AnyMap = Record<string, any>;

/**
 * Converte filtros canônicos normalizados em query params,
 * respeitando o querymap (ou queryMap) da integração.
 *
 * Regras:
 * - mapping string:   { "bairro": "bairro" }
 * - mapping array:    { "bairro": ["bairro","district"] } -> usa a 1ª disponível
 * - sem mapping: usa fallback por domínio (imóveis/carros) + chaves originais.
 */
export function buildQueryParams(
  integ: InventoryIntegration,
  normalizedFilters: AnyMap
): AnyMap {
  const qp: AnyMap = {};

  // rolemap + querymap (aceita dois nomes: querymap | queryMap)
  const qmap: AnyMap =
    ((integ as any).querymap || (integ as any).queryMap || {}) as AnyMap;

  // fallback comum (canônico → nome de param padrão de mercado)
  const FALLBACK: AnyMap = {
    // GEO
    cidade: "cidade",
    uf: "uf",
    bairro: "bairro",

    // Imóveis
    tipo: "tipo",
    dormitorios: "dormitorios",
    vagas: "vagas",
    area: "area",
    areaMin: "area_min",
    areaMax: "area_max",
    precoMin: "price_min",
    precoMax: "price_max",

    // Veículos
    marca: "marca",
    modelo: "modelo",
    ano_min: "ano_min",
    ano_max: "ano_max",
    km_max: "km_max",
    transmissao: "transmissao",
    combustivel: "combustivel"
  };

  const put = (canon: string, val: any) => {
    if (val === undefined || val === null || val === "") return;

    const map = qmap[canon];
    if (typeof map === "string") { qp[map] = val; return; }
    if (Array.isArray(map) && map.length) { qp[map[0]] = val; return; }

    const fb = FALLBACK[canon];
    if (fb) { qp[fb] = val; return; }

    // por último, usa a própria chave canônica
    qp[canon] = val;
  };

  // GEO
  put("cidade", normalizedFilters.cidade);
  put("uf",     normalizedFilters.uf);
  put("bairro", normalizedFilters.bairro);

  // Imóveis
  put("tipo",         normalizedFilters.tipo);
  put("dormitorios",  normalizedFilters.dormitorios);
  put("vagas",        normalizedFilters.vagas);
  put("area",         normalizedFilters.area);
  put("areaMin",      normalizedFilters.areaMin);
  put("areaMax",      normalizedFilters.areaMax);
  put("precoMin",     normalizedFilters.precoMin);
  put("precoMax",     normalizedFilters.precoMax);

  // Veículos
  put("marca",        normalizedFilters.marca);
  put("modelo",       normalizedFilters.modelo);
  put("ano_min",      normalizedFilters.ano_min);
  put("ano_max",      normalizedFilters.ano_max);
  put("km_max",       normalizedFilters.km_max);
  put("transmissao",  normalizedFilters.transmissao);
  put("combustivel",  normalizedFilters.combustivel);

  // Heurística leve: hasGarage → vagas=1 (se ainda não setou)
  if (normalizedFilters.hasGarage && qp.vagas == null) qp.vagas = 1;

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
