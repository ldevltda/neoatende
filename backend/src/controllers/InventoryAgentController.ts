import { Request, Response } from "express";
import { logger } from "../utils/logger";
import InventoryIntegration from "../models/InventoryIntegration";
import { runSearch, RunSearchOutput } from "../services/InventoryServices/RunSearchService";
import { chooseIntegrationByText } from "../services/InventoryServices/CategoryRouter";
import { parseCriteriaFromText, filterAndRankItems, paginateRanked } from "../services/InventoryServices/NLFilter";

function resolveCompanyId(req: Request, bodyCompanyId?: number) {
  return (req as any)?.user?.companyId ?? bodyCompanyId;
}

// Converte os critérios em um objeto de filtros para o provider.
// Se a integração tiver mapeamento de filtros (filterMap) no RunSearchService,
// ele poderá traduzir estes nomes genéricos para os campos do provedor.
function buildProviderFiltersFromCriteria(criteria: ReturnType<typeof parseCriteriaFromText>) {
  const filtros: Record<string, any> = {};
  if (criteria.city) filtros.city = criteria.city;
  if (criteria.state) filtros.state = criteria.state;
  if (criteria.neighborhood) filtros.neighborhood = criteria.neighborhood;
  if (criteria.bedrooms) filtros.bedrooms = criteria.bedrooms;
  if (criteria.typeHint) filtros.type = criteria.typeHint;
  return filtros;
}

/** ========= Antigo: /inventory/agent/lookup (mantido) ========= */
export const agentLookup = async (req: Request, res: Response) => {
  const t0 = Date.now();
  const corrId = `${Date.now()}-${Math.random().toString(36).slice(2,8)}`;

  try {
    const {
      companyId: companyIdFromBody,
      integrationId,
      text = "",
      filtros: filtrosBody = {},
      page = 1,
      pageSize = 5
    } = (req.body || {}) as any;

    logger.info(
      { corrId, ctx: "AgentLookup", step: "in", integrationId, page, pageSize, text },
      "agent_lookup_in"
    );

    const companyId = resolveCompanyId(req, companyIdFromBody);
    if (!companyId || !integrationId) {
      return res.status(400).json({ error: "MissingParams", message: "companyId/integrationId required" });
    }
    const integ = await InventoryIntegration.findOne({ where: { id: integrationId, companyId } });
    if (!integ) return res.status(404).json({ error: "IntegrationNotFound" });

    const criteria = parseCriteriaFromText(text);
    const filtrosFromCriteria = buildProviderFiltersFromCriteria(criteria);
    const filtros = { ...filtrosFromCriteria, ...filtrosBody };

    const out: RunSearchOutput = await runSearch(integ as any, {
      params: {},
      page: 1,
      pageSize: 50, // traz um lote maior e filtramos localmente
      text,
      filtros
    });

    // Filtro LOCAL (hard + ranking)
    const ranked = filterAndRankItems(out.items || [], criteria);
    const items = paginateRanked(ranked, page, pageSize);

    logger.info(
      { corrId, ctx: "AgentLookup", integrationId, tookMs: Date.now() - t0, returned: items.length, total: ranked.length },
      "agent_lookup_out"
    );

    return res.json({
      companyId,
      integrationId: Number(integ.get("id")),
      integrationName: (integ.get("name") as string) || "integration",
      categoryHint: integ.get("categoryHint"),
      query: { text, filtros, page, pageSize, criteria },
      items,
      total: ranked.length,
      page,
      pageSize,
      raw: out.raw
    });
  } catch (err: any) {
    logger.error({ corrId, ctx: "AgentLookup", step: "error", error: err?.message }, "agent_lookup_err");
    return res.status(500).json({ error: "AgentLookupFailed", message: err?.message });
  }
};

/** ========= Novo: /inventory/agent/auto (decide integração + filtra local) ========= */
export const agentAuto = async (req: Request, res: Response) => {
  const t0 = Date.now();
  const corrId = `${Date.now()}-${Math.random().toString(36).slice(2,8)}`;

  try {
    const {
      companyId: companyIdFromBody,
      text = "",
      page = 1,
      pageSize = 5,
      filtros: filtrosBody = {}
    } = (req.body || {}) as any;

    logger.info({ corrId, ctx: "AgentAuto", step: "in", page, pageSize, text }, "agent_auto_in");

    const companyId = resolveCompanyId(req, companyIdFromBody);
    if (!companyId) return res.status(400).json({ error: "CompanyIdMissing" });
    if (!text || !String(text).trim()) {
      return res.status(400).json({ error: "TextMissing", message: "text required" });
    }

    // 1) escolhe a integração pela dica de categoria
    const integ = await chooseIntegrationByText(companyId, text);
    if (!integ) {
      logger.info({ corrId, ctx: "AgentAuto", step: "no_match" }, "agent_auto_no_match");
      return res.json({
        companyId,
        matched: false,
        reason: "NoIntegrationMatched",
        items: [],
        total: 0,
        page,
        pageSize
      });
    }

    logger.info({
      corrId,
      ctx: "AgentAuto",
      step: "choose",
      integrationId: Number(integ.get("id")),
      name: String(integ.get("name")),
      categoryHint: String(integ.get("categoryHint"))
    }, "agent_auto_chosen");

    // 2) critérios -> filtros do provider (para vir "certo" da fonte, quando suportado)
    const criteria = parseCriteriaFromText(text);
    const filtrosFromCriteria = buildProviderFiltersFromCriteria(criteria);
    const filtros = { ...filtrosFromCriteria, ...filtrosBody };

    // 3) chama o provedor (lote grande)
    const out: RunSearchOutput = await runSearch(integ as any, {
      params: {},
      page: 1,
      pageSize: 50, // lote para filtrar localmente
      text,
      filtros
    });

    // 4) hard-filter local + ranking + paginação
    const ranked = filterAndRankItems(out.items || [], criteria);
    const items = paginateRanked(ranked, page, pageSize);

    logger.info(
      {
        corrId,
        ctx: "AgentAuto",
        step: "out",
        integrationId: Number(integ.get("id")),
        tookMs: Date.now() - t0,
        before: Array.isArray(out.items) ? out.items.length : 0,
        after: ranked.length
      },
      "agent_auto_out"
    );

    return res.json({
      companyId,
      matched: true,
      integrationId: Number(integ.get("id")),
      integrationName: (integ.get("name") as string) || "integration",
      categoryHint: integ.get("categoryHint"),
      criteria,
      query: { text, filtros, page, pageSize },
      items,
      total: ranked.length,
      page,
      pageSize,
      raw: out.raw
    });
  } catch (err: any) {
    logger.error({ corrId, ctx: "AgentAuto", step: "error", error: err?.message }, "agent_auto_err");
    return res.status(500).json({ error: "AgentAutoFailed", message: err?.message });
  }
};
