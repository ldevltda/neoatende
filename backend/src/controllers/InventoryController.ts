import { Request, Response } from "express";
import InventoryIntegration from "../models/InventoryIntegration";
import { fetchSamplesAndInfer } from "../services/InventoryServices/InferSchemaService";
import { runSearch, RunSearchOutput } from "../services/InventoryServices/RunSearchService";
import { logger } from "../utils/logger";

function resolveCompanyId(req: Request, bodyCompanyId?: number) {
  return (req as any)?.user?.companyId ?? bodyCompanyId;
}

/** GET /inventory/integrations */
export const listIntegrations = async (req: Request, res: Response) => {
  try {
    const companyId = resolveCompanyId(req, Number((req.query as any)?.companyId));
    if (!companyId) return res.status(400).json({ error: "CompanyIdMissing" });
    const rows = await InventoryIntegration.findAll({ where: { companyId }, order: [["id", "ASC"]] });
    return res.json(rows);
  } catch (err: any) {
    logger.error({ ctx: "InventoryController.listIntegrations", err }, "list error");
    return res.status(500).json({ error: "ListFailed", message: err?.message });
  }
};

/** POST /inventory/integrations  (cria/atualiza) */
export const createIntegration = async (req: Request, res: Response) => {
  try {
    const body = (req.body || {}) as any;
    const companyId = resolveCompanyId(req, body.companyId);
    if (!companyId) return res.status(400).json({ error: "CompanyIdMissing" });

    const payload: any = {
      companyId,
      name: body.name,
      categoryHint: body.categoryHint,
      endpoint: body.endpoint,
      auth: body.auth,
      pagination: body.pagination,
      rolemap: body.rolemap,
      schema: body.schema
    };

    let row: any;
    if (body.id) {
      row = await InventoryIntegration.findOne({ where: { id: body.id, companyId } });
      if (!row) return res.status(404).json({ error: "IntegrationNotFound" });
      await row.update(payload);
    } else {
      row = await InventoryIntegration.create(payload);
    }
    return res.json(row);
  } catch (err: any) {
    logger.error({ ctx: "InventoryController.createIntegration", err }, "create error");
    return res.status(500).json({ error: "CreateFailed", message: err?.message });
  }
};

/** POST /inventory/integrations/:id/infer  (ou body.integrationId) */
export const inferIntegration = async (req: Request, res: Response) => {
  try {
    const idFromParam = (req.params as any)?.id ? Number((req.params as any).id) : undefined;
    const { integrationId: idFromBody, companyId: companyIdFromBody, save = false } = (req.body || {}) as any;

    const integrationId = idFromParam ?? idFromBody;
    const companyId = resolveCompanyId(req, companyIdFromBody);
    if (!companyId || !integrationId) {
      return res.status(400).json({ error: "MissingParams", message: "companyId/integrationId are required" });
    }

    const integ = await InventoryIntegration.findOne({ where: { id: integrationId, companyId } });
    if (!integ) return res.status(404).json({ error: "IntegrationNotFound" });

    const result = await fetchSamplesAndInfer(integ);

    const schemaSuggestion = {
      itemsPath: result.firstArrayPath || "data.items",
      totalPath: result.totalPathCandidates?.[0] || undefined
    };

    if (save) {
      await (integ as any).update({ schema: schemaSuggestion });
      logger.info({ ctx: "InventoryController.inferIntegration", integrationId, savedSchema: schemaSuggestion }, "schema inferred and saved");
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

/** POST /inventory/integrations/:id/search  (ou body.integrationId) */
export const searchInventory = async (req: Request, res: Response) => {
  const t0 = Date.now();
  try {
    const idFromParam = (req.params as any)?.id ? Number((req.params as any).id) : undefined;
    const {
      integrationId: idFromBody,
      text = "",
      filtros = {},
      page = 1,
      pageSize = 10,
      companyId: companyIdFromBody
    } = (req.body || {}) as any;

    const integrationId = idFromParam ?? idFromBody;
    const companyId = resolveCompanyId(req, companyIdFromBody);
    if (!companyId || !integrationId) {
      return res.status(400).json({ error: "MissingParams", message: "companyId/integrationId are required" });
    }

    const integ = await InventoryIntegration.findOne({ where: { id: integrationId, companyId } });
    if (!integ) return res.status(404).json({ error: "IntegrationNotFound" });

    const out: RunSearchOutput = await runSearch(integ as any, {
      params: {},
      page,
      pageSize,
      text,
      filtros
    });

    logger.info(
      { ctx: "InventoryController.searchInventory", integrationId, tookMs: Date.now() - t0, total: out?.total ?? out?.items?.length ?? 0 },
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

/** POST /inventory/integrations/:id/guided-fix (stub pra não quebrar) */
export const guidedFix = async (_req: Request, res: Response) => {
  return res.json({ ok: true, message: "guided-fix not implemented (stub)" });
};
