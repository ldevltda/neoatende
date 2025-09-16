// backend/src/controllers/InventoryAgentController.ts
import { Request, Response } from "express";
import InventoryIntegration from "../models/InventoryIntegration";
import { buildParamsForApi } from "../services/InventoryServices/PlannerService";
import { runSearch } from "../services/InventoryServices/RunSearchService";

/**
 * Executa uma consulta em integrações cadastradas.
 * - Se "integrationId" for informado: usa diretamente essa integração (verificando companyId).
 * - Caso contrário: resolve pela primeira integração disponível dessa empresa.
 *   (Se quiser o resolver por intenção/categoria depois, a gente pluga por aqui.)
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
  try {
    const {
      integrationId,
      text = "",
      filtros = {},
      page = 1,
      pageSize = 10,
      companyId: companyIdFromBody
    }: {
      integrationId?: number;
      text?: string;
      filtros?: Record<string, any>;
      page?: number;
      pageSize?: number;
      companyId?: number;
    } = (req.body || {}) as any;

    const companyId = (req as any)?.user?.companyId ?? companyIdFromBody;
    if (!companyId) {
      return res.status(400).json({
        error: "CompanyIdMissing",
        message: "companyId não encontrado no token nem no corpo da requisição."
      });
    }

    // 1) escolher integração
    let integ: InventoryIntegration | null = null;

    if (integrationId) {
      integ = await InventoryIntegration.findOne({ where: { id: integrationId, companyId } });
      if (!integ) {
        return res.status(404).json({
          error: "IntegrationNotFound",
          message: `Integração ${integrationId} não encontrada para esta empresa.`
        });
      }
    } else {
      // fallback simples: pega a primeira integração da empresa
      integ = await InventoryIntegration.findOne({ where: { companyId }, order: [["id", "ASC"]] });
      if (!integ) {
        return res.status(404).json({
          error: "NoIntegrationForCompany",
          message: "Nenhuma integração cadastrada para esta empresa."
        });
      }
    }

    // 2) montar params conforme config de paginação da integração
    const planned = buildParamsForApi(
      { text, filtros, paginacao: { page, pageSize } },
      (integ as any).pagination
    );
    const params = (planned && (planned as any).params) || {};

    // 3) executar e normalizar
    const out = await runSearch(integ as any, {
      params,
      page,
      pageSize,
      text,
      filtros
    } as any);

    return res.json({
      companyId,
      integrationId: integ.get("id"),
      integrationName: integ.get("name"),
      categoryHint: integ.get("categoryHint") || null,
      query: { text, filtros, page, pageSize },
      ...out
    });
  } catch (err: any) {
    console.error("agentLookup error:", err);
    return res.status(500).json({
      error: "AgentLookupFailed",
      message: err?.message || "Falha ao executar consulta de integração."
    });
  }
};
