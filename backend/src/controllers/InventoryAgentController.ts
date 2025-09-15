// backend/src/controllers/InventoryAgentController.ts
import { Request, Response } from "express";
import InventoryIntegration from "../models/InventoryIntegration";
import { resolveByIntent } from "../services/InventoryServices/ResolveIntegrationService";
import { buildParamsForApi } from "../services/InventoryServices/PlannerService";
import { runSearch } from "../services/InventoryServices/RunSearchService";

export const agentLookup = async (req: Request, res: Response) => {
  const {
    text = "",
    filtros = {},
    page = 1,
    pageSize = 10,
    companyId
  }: {
    text?: string;
    filtros?: Record<string, any>;
    page?: number;
    pageSize?: number;
    companyId?: number;
  } = (req.body || {}) as any;

  const pick = await resolveByIntent(text, companyId);
  if (!pick) {
    return res.status(404).json({
      error: "NoIntegrationMatched",
      message: "Nenhuma integração adequada para esta intenção."
    });
  }

  const integ = await InventoryIntegration.findByPk(pick.id);
  if (!integ) {
    return res
      .status(404)
      .json({ error: "IntegrationNotFound", integrationId: pick.id });
  }

  const planned = buildParamsForApi(
    { text, filtros, paginacao: { page, pageSize } },
    (integ as any).pagination
  );

  const params = (planned && (planned as any).params) || {};

  const out = await runSearch(integ as any, {
    params,
    page,
    pageSize,
    text,
    filtros
  } as any);

  return res.json({
    integrationId: integ.get("id"),
    integrationName: integ.get("name"),
    categoryHint: integ.get("categoryHint") || null,
    query: { text, filtros, page, pageSize },
    ...out
  });
};
