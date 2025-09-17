import { Request, Response } from "express";
import { logger } from "../utils/logger";
import InventoryIntegration from "../models/InventoryIntegration";
import { runSearch, RunSearchOutput } from "../services/InventoryServices/RunSearchService";
import { chooseIntegrationByText } from "../services/InventoryServices/CategoryRouter";
import { parseCriteriaFromText, filterAndRankItems, paginateRanked } from "../services/InventoryServices/NLFilter";

function resolveCompanyId(req: Request, bodyCompanyId?: number) {
  return (req as any)?.user?.companyId ?? bodyCompanyId;
}

// Converte critérios semânticos em filtros "genéricos". O RunSearchService pode traduzi-los via filterMap por integração.
function buildProviderFiltersFromCriteria(criteria: ReturnType<typeof parseCriteriaFromText>) {
  const f: Record<string, any> = {};

  // Geo
  if (criteria.city) f.city = criteria.city;
  if (criteria.state) f.state = criteria.state;
  if (criteria.neighborhood) f.neighborhood = criteria.neighborhood;

  // Imóveis
  if (criteria.typeHint) f.type = criteria.typeHint;
  if (criteria.bedrooms !== undefined) f.bedrooms = criteria.bedrooms;
  if (criteria.areaMin !== undefined) f.areaMin = criteria.areaMin;
  if (criteria.areaMax !== undefined) f.areaMax = criteria.areaMax;

  // Preço
  if (criteria.priceMin !== undefined) f.priceMin = criteria.priceMin;
  if (criteria.priceMax !== undefined) f.priceMax = criteria.priceMax;

  // Veículos
  if (criteria.brand) f.brand = criteria.brand;
  if (criteria.model) f.model = criteria.model;
  if (criteria.yearMin !== undefined) f.yearMin = criteria.yearMin;
  if (criteria.yearMax !== undefined) f.yearMax = criteria.yearMax;
  if (criteria.kmMax !== undefined) f.kmMax = criteria.kmMax;
  if (criteria.transmission) f.transmission = criteria.transmission;
  if (criteria.fuel) f.fuel = criteria.fuel;

  // Saúde / Serviços
  if (criteria.specialty) f.specialty = criteria.specialty;
  if (criteria.insurance) f.insurance = criteria.insurance;
  if (criteria.service) f.service = criteria.service;
  if (criteria.professional) f.professional = criteria.professional;
  if (criteria.date) f.date = criteria.date;
  if (criteria.timeWindow) f.timeWindow = criteria.timeWindow;

  // Educação / Academias
  if (criteria.modality) f.modality = criteria.modality;
  if (criteria.course) f.course = criteria.course;
  if (criteria.schedule) f.schedule = criteria.schedule;

  // Eventos
  if (criteria.capacityMin !== undefined) f.capacityMin = criteria.capacityMin;

  return f;
}

/** ========= Antigo: /inventory/agent/lookup ========= */
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

    logger.info({ corrId, ctx: "AgentLookup", step: "in", integrationId, page, pageSize, text }, "agent_lookup_in");

    const companyId = resolveCompanyId(req, companyIdFromBody);
    if (!companyId || !integrationId) {
      return res.status(400).json({ error: "MissingParams", message: "companyId/integrationId required" });
    }
    const integ = await InventoryIntegration.findOne({ where: { id: integrationId, companyId } });
    if (!integ) return res.status(404).json({ error: "IntegrationNotFound" });

    // critérios -> filtros para o provider
    const criteria = parseCriteriaFromText(text);
    const filtrosFromCriteria = buildProviderFiltersFromCriteria(criteria);
    const filtros = { ...filtrosFromCriteria, ...filtrosBody };

    const out: RunSearchOutput = await runSearch(integ as any, {
      params: {},
      page: 1,
      pageSize: 100, // lote maior pra dar espaço pro filtro local
      text,
      filtros
    });

    const ranked = filterAndRankItems(out.items || [], criteria);
    const items = paginateRanked(ranked, page, pageSize);

    logger.info(
      { corrId, ctx: "AgentLookup", integrationId: Number(integ.get("id")), tookMs: Date.now() - t0, returned: items.length, total: ranked.length },
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

/** ========= Novo: /inventory/agent/auto ========= */
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

    // 1) escolhe a integração pelo texto (categoryHint/domain router)
    const integ = await chooseIntegrationByText(companyId, text);
    if (!integ) {
      logger.info({ corrId, ctx: "AgentAuto", step: "no_match" }, "agent_auto_no_match");
      return res.json({ companyId, matched: false, reason: "NoIntegrationMatched", items: [], total: 0, page, pageSize });
    }

    logger.info({
      corrId, ctx: "AgentAuto", step: "choose",
      integrationId: Number(integ.get("id")),
      name: String(integ.get("name")),
      categoryHint: String(integ.get("categoryHint"))
    }, "agent_auto_chosen");

    // 2) critérios -> filtros para o provider
    const criteria = parseCriteriaFromText(text);
    const filtrosFromCriteria = buildProviderFiltersFromCriteria(criteria);
    const filtros = { ...filtrosFromCriteria, ...filtrosBody };

    // 3) busca lote amplo e aplica filtro local (hard + rank)
    const out: RunSearchOutput = await runSearch(integ as any, {
      params: {},
      page: 1,
      pageSize: 100,
      text,
      filtros
    });

    const ranked = filterAndRankItems(out.items || [], criteria);
    const items = paginateRanked(ranked, page, pageSize);

    logger.info(
      { corrId, ctx: "AgentAuto", step: "out", integrationId: Number(integ.get("id")), tookMs: Date.now() - t0,
        before: Array.isArray(out.items) ? out.items.length : 0, after: ranked.length },
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
