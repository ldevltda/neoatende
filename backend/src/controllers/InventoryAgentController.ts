// backend/src/controllers/InventoryAgentController.ts
import { Request, Response } from "express";
import InventoryIntegration from "../models/InventoryIntegration";
import { buildParamsForApi } from "../services/InventoryServices/PlannerService";
import { runSearch } from "../services/InventoryServices/RunSearchService";
import { logger } from "../utils/logger";

/**
 * Executa uma consulta em integrações cadastradas.
 * - Se "integrationId" for informado: usa diretamente essa integração (verificando companyId).
 * - Caso contrário: usa a primeira integração da empresa (ou plugue um resolver por intenção no futuro).
 *
 * Body:
 * {
 *   "integrationId"?: number,
 *   "text": string,
 *   "filtros"?: object,
 *   "page"?: number,
 *   "pageSize"?: number,
 *   "companyId"?: number // fallback, preferimos req.user.companyId
 * }
 */
export const agentLookup = async (req: Request, res: Response) => {
  const start = Date.now();
  try {
    const {
      integrationId,
      text = "",
      filtros = {},
      page = 1,
      pageSize = 10,
      companyId: companyIdFromBody
    } = (req.body || {}) as any;

    const companyId = (req as any)?.user?.companyId ?? companyIdFromBody;

    logger.info({
      ctx: "AgentLookup",
      companyId,
      integrationId,
      text,
      filtros,
      page,
      pageSize
    }, "incoming agent lookup");

    if (!companyId) {
      logger.warn({ ctx: "AgentLookup" }, "companyId missing");
      return res.status(400).json({ error: "CompanyIdMissing" });
    }

    let integ: InventoryIntegration | null = null;

    if (integrationId) {
      integ = await InventoryIntegration.findOne({ where: { id: integrationId, companyId } });
      if (!integ) {
        logger.warn({ ctx: "AgentLookup", companyId, integrationId }, "integration not found");
        return res.status(404).json({ error: "IntegrationNotFound" });
      }
    } else {
      integ = await InventoryIntegration.findOne({ where: { companyId }, order: [["id","ASC"]] });
      if (!integ) {
        logger.warn({ ctx: "AgentLookup", companyId }, "no integrations for company");
        return res.status(404).json({ error: "NoIntegrationForCompany" });
      }
    }

    logger.info({
      ctx: "AgentLookup",
      integrationId: integ.get("id"),
      integrationName: integ.get("name")
    }, "picked integration");

    const planned = buildParamsForApi(
      { text, filtros, paginacao: { page, pageSize } },
      (integ as any).pagination
    );
    const params = (planned && (planned as any).params) || {};

    logger.debug({
      ctx: "AgentLookup",
      integrationId: integ.get("id"),
      plannedParams: params
    }, "planned params");

    const t0 = Date.now();
    const out = await runSearch(integ as any, { params, page, pageSize, text, filtros } as any);
    const took = Date.now() - t0;

    logger.info({
      ctx: "AgentLookup",
      integrationId: integ.get("id"),
      tookMs: took,
      total: out?.total ?? out?.items?.length ?? 0
    }, "runSearch done");

    const totalMs = Date.now() - start;
    logger.info({ ctx: "AgentLookup", totalMs }, "lookup finished");

    return res.json({
      companyId,
      integrationId: integ.get("id"),
      integrationName: integ.get("name"),
      categoryHint: integ.get("categoryHint") || null,
      query: { text, filtros, page, pageSize },
      ...out
    });
  } catch (err: any) {
    logger.error({ ctx: "AgentLookup", err }, "lookup error");
    return res.status(500).json({ error: "AgentLookupFailed", message: err?.message });
  }
};
