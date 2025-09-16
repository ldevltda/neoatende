// backend/src/controllers/InventoryController.ts
import { Request, Response } from "express";
import InventoryIntegration from "../models/InventoryIntegration";
import { fetchSamplesAndInfer } from "../services/InventoryServices/InferSchemaService";
import { runSearch, RunSearchOutput } from "../services/InventoryServices/RunSearchService";
import { logger } from "../utils/logger";

/** Util: resolve companyId do user ou do body */
function resolveCompanyId(req: Request, bodyCompanyId?: number) {
  return (req as any)?.user?.companyId ?? bodyCompanyId;
}

/**
 * POST /inventory/infer
 * Body: { integrationId: number, companyId?: number, save?: boolean }
 *
 * - Busca 1–2 amostras do provedor
 * - Retorna skeleton + sugestões (itemsPath/totalPathCandidates)
 * - Se `save=true`, grava schema sugerido na integração
 *   (rolemap NÃO é salvo aqui – fica a cargo da UI/usuário)
 */
export const inferIntegration = async (req: Request, res: Response) => {
  try {
    const { integrationId, companyId: companyIdFromBody, save = false } = (req.body || {}) as {
      integrationId?: number;
      companyId?: number;
      save?: boolean;
    };

    const companyId = resolveCompanyId(req, companyIdFromBody);

    if (!companyId || !integrationId) {
      return res
        .status(400)
        .json({ error: "MissingParams", message: "companyId/integrationId are required" });
    }

    const integ = await InventoryIntegration.findOne({
      where: { id: integrationId, companyId }
    });
    if (!integ) {
      return res.status(404).json({ error: "IntegrationNotFound" });
    }

    const result = await fetchSamplesAndInfer(integ);

    // sugestões de schema para a UI:
    const schemaSuggestion = {
      itemsPath: result.firstArrayPath || "data.items",
      totalPath: result.totalPathCandidates?.[0] || undefined
    };

    // opcionalmente salvar schema sugerido
    if (save) {
      await (integ as any).update({ schema: schemaSuggestion });
      logger.info(
        {
          ctx: "InventoryController.inferIntegration",
          integrationId,
          savedSchema: schemaSuggestion
        },
        "schema inferred and saved"
      );
    }

    return res.json({
      ok: true,
      integrationId,
      saved: !!save,
      schemaSuggestion,
      totalPathCandidates: result.totalPathCandidates,
      skeleton: result.skeleton,
      sampleItem: result.sampleItem,
      samplesCount: result.samples?.length ?? 0
    });
  } catch (err: any) {
    logger.error({ ctx: "InventoryController.inferIntegration", err }, "infer error");
    return res.status(500).json({ error: "InferFailed", message: err?.message });
  }
};

/**
 * POST /inventory/search
 * Body: {
 *   integrationId: number,
 *   text?: string,
 *   filtros?: object,
 *   page?: number,
 *   pageSize?: number,
 *   companyId?: number
 * }
 *
 * - Executa o RunSearchService para testes pela tela (botão TESTAR)
 */
export const searchInventory = async (req: Request, res: Response) => {
  const t0 = Date.now();
  try {
    const {
      integrationId,
      text = "",
      filtros = {},
      page = 1,
      pageSize = 10,
      companyId: companyIdFromBody
    } = (req.body || {}) as any;

    const companyId = resolveCompanyId(req, companyIdFromBody);

    if (!companyId || !integrationId) {
      return res
        .status(400)
        .json({ error: "MissingParams", message: "companyId/integrationId are required" });
    }

    const integ = await InventoryIntegration.findOne({
      where: { id: integrationId, companyId }
    });
    if (!integ) return res.status(404).json({ error: "IntegrationNotFound" });

    // A tela normalmente já monta params via Planner, mas aqui podemos aceitar direto “filtros”
    const out: RunSearchOutput = await runSearch(integ as any, {
      params: {}, // se tiver Planner no front, pode enviar aqui; senão, só filtros
      page,
      pageSize,
      text,
      filtros
    });

    logger.info(
      {
        ctx: "InventoryController.searchInventory",
        integrationId,
        tookMs: Date.now() - t0,
        total: out?.total ?? out?.items?.length ?? 0
      },
      "search done"
    );

    return res.json({
      integrationId,
      query: { text, filtros, page, pageSize },
      ...out
    });
  } catch (err: any) {
    logger.error({ ctx: "InventoryController.searchInventory", err }, "search error");
    return res.status(500).json({ error: "SearchFailed", message: err?.message });
  }
};
