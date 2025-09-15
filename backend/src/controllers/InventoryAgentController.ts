// backend/src/controllers/InventoryAgentController.ts
import { Request, Response } from "express";
import InventoryIntegration from "../models/InventoryIntegration";
import { resolveByIntent } from "../services/InventoryServices/ResolveIntegrationService";
import { buildParamsForApi } from "../services/InventoryServices/PlannerService";
import { runSearch } from "../services/InventoryServices/RunSearchService";

/**
 * Executa uma consulta em integrações cadastradas.
 * - Se "integrationId" for informado: usa diretamente essa integração (verificando companyId).
 * - Caso contrário: resolve por intenção (nome/categoryHint) restrito ao companyId.
 * - Reaproveita PlannerService + RunSearchService (sem alterar nada do contrato existente).
 *
 * Body esperado:
 * {
 *   "integrationId"?: number,
 *   "text": string,
 *   "filtros"?: object,
 *   "page"?: number,
 *   "pageSize"?: number,
 *   "companyId"?: number // opcional, só como fallback (preferimos req.user.companyId)
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

    // Multiempresa: prioriza companyId do usuário autenticado
    const companyId = (req as any)?.user?.companyId ?? companyIdFromBody;
    if (!companyId) {
      return res.status(400).json({
        error: "CompanyIdMissing",
        message: "companyId não encontrado no token nem no corpo da requisição."
      });
    }

    // 1) Escolher integração
    let integ: InventoryIntegration | null = null;

    if (integrationId) {
      // valida se pertence à empresa
      integ = await InventoryIntegration.findOne({
        where: { id: integrationId, companyId }
      });
      if (!integ) {
        return res.status(404).json({
          error: "IntegrationNotFound",
          message: `Integração ${integrationId} não encontrada para esta empresa.`
        });
      }
    } else {
      // resolve por intenção (nome/categoryHint) dentro da empresa
      const pick = await resolveByIntent(text, companyId);
      if (!pick) {
        return res.status(404).json({
          error: "NoIntegrationMatched",
          message:
            "Nenhuma integração parece adequada para esta intenção. Ajuste o categoryHint/nome da integração ou informe integrationId explicitamente."
        });
      }
      integ = await InventoryIntegration.findByPk(pick.id);
      if (!integ) {
        return res.status(404).json({
          error: "IntegrationNotFound",
          message: `Integração ${pick.id} não encontrada.`
        });
      }
    }

    // 2) Planejar parâmetros (PlannerService define paginação/query/body conforme integração)
    const planned = buildParamsForApi(
      { text, filtros, paginacao: { page, pageSize } },
      (integ as any).pagination
    );
    const params = (planned && (planned as any).params) || {};

    // 3) Executar e normalizar (RunSearchService já aplica rolemap/schema)
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
      ...out // geralmente { items, total, page, pageSize, raw? }
    });
  } catch (err: any) {
    console.error("agentLookup error:", err);
    return res.status(500).json({
      error: "AgentLookupFailed",
      message: err?.message || "Falha ao executar consulta de integração."
    });
  }
};
