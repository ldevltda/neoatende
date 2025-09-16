// backend/src/services/InventoryServices/PlannerService.ts
import { logger } from "../../utils/logger";

/**
 * Tipos auxiliares (ajuste se você já possui tipos próprios)
 */
type PaginationConfig =
  | { type: "none" }
  | { type: "page"; param?: string; sizeParam?: string }
  | { type: "offset"; param?: string; sizeParam?: string }
  | { type: "cursor"; param?: string; cursorPath?: string; sizeParam?: string };

type BuildInput = {
  text?: string;
  filtros?: Record<string, any>;
  paginacao?: { page?: number; pageSize?: number };
};

/**
 * Constrói o objeto de parâmetros (query/body) a ser enviado à API externa,
 * respeitando a configuração de paginação da integração.
 *
 * Retorna um objeto com a forma:
 * {
 *   params: { ... }  // pronto para ir no query (GET) ou body (POST)
 * }
 */
export function buildParamsForApi(
  input: BuildInput,
  pagination?: PaginationConfig
): { params: Record<string, any> } {
  const text = input?.text || "";
  const filtros = input?.filtros || {};
  const page = input?.paginacao?.page ?? 1;
  const pageSize = input?.paginacao?.pageSize ?? 10;

  // Base de parâmetros: usamos 'text' e 'filtros' como insumos universais.
  // Seu mapeamento específico (ex.: filtros.bairro -> API.XYZParam) normalmente fica no rolemap/config;
  // aqui só repassamos direto. Se precisar, adapte para renomear chaves.
  const params: Record<string, any> = {
    ...(text ? { q: text } : {}), // opcional: convenciona 'q' como texto livre
    ...filtros
  };

  // Aplica paginação conforme config
  switch (pagination?.type) {
    case "page": {
      const pageParam = pagination.param || "page";
      const sizeParam = pagination.sizeParam || "pageSize";
      params[pageParam] = page;
      params[sizeParam] = pageSize;
      break;
    }
    case "offset": {
      const offsetParam = pagination.param || "offset";
      const sizeParam = pagination.sizeParam || "limit";
      params[offsetParam] = (Math.max(page, 1) - 1) * pageSize;
      params[sizeParam] = pageSize;
      break;
    }
    case "cursor": {
      const cursorParam = pagination.param || "cursor";
      const sizeParam = pagination.sizeParam || "limit";
      // Aqui assumimos que o cursor virá em filtros.cursor ou algo similar; se não vier, ignora.
      if (typeof filtros?.cursor !== "undefined") {
        params[cursorParam] = filtros.cursor;
      }
      params[sizeParam] = pageSize;
      break;
    }
    case "none":
    default:
      // sem paginação
      break;
  }

  // LOG: parâmetros finais planejados
  logger.debug(
    {
      ctx: "PlannerService",
      paginationType: pagination?.type || "none",
      page,
      pageSize,
      builtParams: params
    },
    "planned params for provider"
  );

  return { params };
}
