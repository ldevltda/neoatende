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
    pageSize = 10
  }: {
    text?: string;
    filtros?: Record<string, any>;
    page?: number;
    pageSize?: number;
  } = (req.body || {}) as any;

  const companyId = (req.user as any)?.companyId;

  // 1) Resolver integração por intenção, **dentro da empresa**
  const pick = await resolveByIntent(text, companyId);
  if (!pick) {
    return res.status(404).json({
      error: "NoIntegrationMatched",
      message:
        "Nenhuma integração parece adequada para esta intenção. Preencha categoryHint/nome na configuração ou selecione manualmente."
    });
  }

  // 2) Carregar a integração completa
  const integ = await InventoryIntegration.findByPk(pick.id);
  if (!integ) {
    return res
      .status(404)
      .json({ error: "IntegrationNotFound", integrationId: pick.id });
  }

  // 3) Planejar params (runSearch resolve method/url/body conforme a integração)
  const planned = buildParamsForApi(
    { text, filtros, paginacao: { page, pageSize } },
    (integ as any).pagination
  );
  const params = (planned && (planned as any).params) || {};

  // 4) Executar
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
