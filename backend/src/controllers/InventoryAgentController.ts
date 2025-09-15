// backend/src/controllers/InventoryAgentController.ts
import { Request, Response } from "express";
import InventoryIntegration from "../models/InventoryIntegration";
import { resolveByIntent } from "../services/InventoryServices/ResolveIntegrationService";

// Reaproveita os serviços que você já tem
import { buildParamsForApi } from "../services/InventoryServices/PlannerService";
import { runSearch } from "../services/InventoryServices/RunSearchService";

/**
 * Endpoint para o AGENTE: dado um texto de intenção (ex.: "2 quartos em Campinas"),
 * escolhe a melhor integração cadastrada e executa a chamada normalizada.
 *
 * Sem migrations. Usa InventoryIntegrations exatamente como já está.
 */
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

  // 1) Resolver integração por intenção
  const pick = await resolveByIntent(text);
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

  // 3) Planejar apenas os PARAMS (runSearch cuida de method/url/body conforme a integração)
  const planned = buildParamsForApi(
    { text, filtros, paginacao: { page, pageSize } },
    (integ as any).pagination
  );

  // buildParamsForApi costuma devolver algo como { params, ... } — garantimos o fallback
  const params = (planned && (planned as any).params) || {};

  // 4) Executar usando a assinatura esperada pelo seu RunSearchService
  //    -> NÃO enviar method/url/data aqui (o serviço resolve internamente)
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
