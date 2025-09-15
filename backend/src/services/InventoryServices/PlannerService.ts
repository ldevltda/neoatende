/**
 * Transforma a requisição universal (texto + filtros) em params/body para a API.
 * - Mantém compatibilidade com paginação top-level (page/limit) e offset.
 * - Se existir um campo `pesquisa` (string JSON do Vista, por ex.), injeta
 *   `paginacao.pagina` e `paginacao.quantidade` dentro dele.
 * - Não interfere na autenticação (isso fica para o executor),
 *   mas monta params robustos para GET/POST.
 */

export type UniversalSearchInput = {
  text?: string;
  filtros?: Record<string, any>;
  paginacao?: { page?: number; pageSize?: number };
  ordenacao?: { campo?: string; direcao?: "asc" | "desc" };
};

export function buildParamsForApi(
  input: UniversalSearchInput,
  paginationCfg: {
    strategy: "none" | "page" | "offset" | "cursor";
    page_param?: string;
    size_param?: string;
    offset_param?: string;
    page_size_default?: number;
  }
) {
  const page = input?.paginacao?.page || 1;
  const pageSize = input?.paginacao?.pageSize || paginationCfg.page_size_default || 20;

  const params: Record<string, any> = { ...(input?.filtros || {}) };

  // Se o provedor utiliza `pesquisa` (Vista), e ela vier como string JSON,
  // vamos injetar a paginação dentro desse objeto.
  if (typeof params.pesquisa === "string" && params.pesquisa.trim().startsWith("{")) {
    try {
      const p = JSON.parse(params.pesquisa);
      p.paginacao = {
        ...(p.paginacao || {}),
        pagina: String(page),
        quantidade: String(pageSize)
      };
      params.pesquisa = JSON.stringify(p);
    } catch {
      // se não deu pra parsear, segue o fluxo padrão
    }
  } else {
    // Paginação padrão em query top-level, quando configurada
    if (paginationCfg.strategy === "page" && paginationCfg.page_param && paginationCfg.size_param) {
      params[paginationCfg.page_param] = page;
      params[paginationCfg.size_param] = pageSize;
    }
    if (paginationCfg.strategy === "offset" && paginationCfg.offset_param) {
      params[paginationCfg.offset_param] = (page - 1) * pageSize;
      if (paginationCfg.size_param) params[paginationCfg.size_param] = pageSize;
    }
  }

  if (input?.text && !params["q"]) params["q"] = input.text;

  return { params, page, pageSize };
}
