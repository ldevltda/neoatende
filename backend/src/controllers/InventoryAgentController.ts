import { Request, Response } from "express";
import { logger } from "../utils/logger";
import InventoryIntegration from "../models/InventoryIntegration";
import { runSearch, RunSearchOutput } from "../services/InventoryServices/RunSearchService";
import { chooseIntegrationByText } from "../services/InventoryServices/CategoryRouter";
import { parseCriteriaFromText, filterAndRankItems, paginateRanked } from "../services/InventoryServices/NLFilter";

function resolveCompanyId(req: Request, bodyCompanyId?: number) {
  return (req as any)?.user?.companyId ?? bodyCompanyId;
}

/** ========= Antigo: /inventory/agent/lookup (mantido) ========= */
export const agentLookup = async (req: Request, res: Response) => {
  const t0 = Date.now();
  try {
    const {
      companyId: companyIdFromBody,
      integrationId,
      text = "",
      filtros = {},
      page = 1,
      pageSize = 5
    } = (req.body || {}) as any;

    const companyId = resolveCompanyId(req, companyIdFromBody);
    if (!companyId || !integrationId) {
      return res.status(400).json({ error: "MissingParams", message: "companyId/integrationId required" });
    }
    const integ = await InventoryIntegration.findOne({ where: { id: integrationId, companyId } });
    if (!integ) return res.status(404).json({ error: "IntegrationNotFound" });

    const out: RunSearchOutput = await runSearch(integ as any, {
      params: {},
      page: 1,
      pageSize: 50, // traz um lote maior e filtramos localmente
      text,
      filtros
    });

    // Filtro LOCAL
    const criteria = parseCriteriaFromText(text);
    const ranked = filterAndRankItems(out.items || [], criteria);
    const items = paginateRanked(ranked, page, pageSize);

    logger.info(
      { ctx: "AgentLookup", integrationId, tookMs: Date.now() - t0, total: ranked.length },
      "lookup finished"
    );

    return res.json({
      companyId,
      integrationId: Number(integ.get("id")),
      integrationName: integ.get("name") || "integration",
      categoryHint: integ.get("categoryHint"),
      query: { text, filtros, page, pageSize, criteria },
      items,
      total: ranked.length,
      page,
      pageSize,
      raw: out.raw
    });
  } catch (err: any) {
    logger.error({ ctx: "AgentLookup", err }, "lookup error");
    return res.status(500).json({ error: "AgentLookupFailed", message: err?.message });
  }
};

/** ========= Novo: /inventory/agent/auto (decide integração + filtra local) ========= */
export const agentAuto = async (req: Request, res: Response) => {
  const t0 = Date.now();
  try {
    const {
      companyId: companyIdFromBody,
      text = "",
      page = 1,
      pageSize = 5
    } = (req.body || {}) as any;

    const companyId = resolveCompanyId(req, companyIdFromBody);
    if (!companyId) return res.status(400).json({ error: "CompanyIdMissing" });
    if (!text || !String(text).trim()) {
      return res.status(400).json({ error: "TextMissing", message: "text required" });
    }

    // 1) escolhe a integração pela Dica de Categoria
    const integ = await chooseIntegrationByText(companyId, text);
    if (!integ) {
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

    // 2) chama o provedor (sem mexer em 'pesquisa')
    const out: RunSearchOutput = await runSearch(integ as any, {
      params: {},
      page: 1,
      pageSize: 50, // lote para filtrar
      text,
      filtros: {}
    });

    // 3) filtra localmente e pagina
    const criteria = parseCriteriaFromText(text);
    const ranked = filterAndRankItems(out.items || [], criteria);
    const items = paginateRanked(ranked, page, pageSize);

    logger.info(
      {
        ctx: "AgentAuto",
        integrationId: Number(integ.get("id")),
        tookMs: Date.now() - t0,
        criteria,
        before: Array.isArray(out.items) ? out.items.length : 0,
        after: ranked.length
      },
      "auto finished"
    );

    return res.json({
      companyId,
      matched: true,
      integrationId: Number(integ.get("id")),
      integrationName: integ.get("name") || "integration",
      categoryHint: integ.get("categoryHint"),
      criteria,
      items,
      total: ranked.length,
      page,
      pageSize,
      raw: out.raw
    });
  } catch (err: any) {
    logger.error({ ctx: "AgentAuto", err }, "auto error");
    return res.status(500).json({ error: "AgentAutoFailed", message: err?.message });
  }
};
