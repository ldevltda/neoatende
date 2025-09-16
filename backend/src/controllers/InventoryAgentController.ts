import { Request, Response } from "express";
import { Op } from "sequelize";
import InventoryIntegration from "../models/InventoryIntegration";
import { buildParamsForApi } from "../services/InventoryServices/PlannerService";
import { runSearch, RunSearchOutput } from "../services/InventoryServices/RunSearchService";
import { logger } from "../utils/logger";

/** Heurística simples; pode trocar por classificador depois */
function guessCategoryHint(text: string): string | null {
  const t = (text || "").toLowerCase();
  if (/(im[óo]vel|ap(e|ê)|apartamento|kitnet|studio|terreno|casa|condom[ií]nio|mcmv|minha casa)/.test(t)) return "imóveis";
  if (/(carro|carros|ve[ií]culo|veiculo|moto|suv|sed[aã]n|hatch|webmotors)/.test(t)) return "veículos";
  if (/(agenda|agendar|consult(a|ório)|m[eé]dico|hor[aá]rio|disponibilidade|booking|appointment)/.test(t)) return "agenda";
  if (/(produto|estoque|sku|loja|pre[çc]o|dispon[ií]vel|marketplace)/.test(t)) return "estoque";
  return null;
}

async function pickIntegrationByIntent(companyId: number, text: string) {
  const cat = guessCategoryHint(text || "");
  if (cat) {
    const byCat = await InventoryIntegration.findOne({
      where: { companyId, categoryHint: { [Op.iLike]: `%${cat}%` } },
      order: [["id", "ASC"]]
    });
    if (byCat) return byCat;
  }
  const terms = (text || "")
    .toLowerCase()
    .split(/[^a-z0-9á-úç]+/i)
    .filter(Boolean)
    .slice(0, 3);
  if (terms.length) {
    const ors = terms.map(w => ({ name: { [Op.iLike]: `%${w}%` } }));
    const byName = await InventoryIntegration.findOne({
      where: { companyId, [Op.or]: ors },
      order: [["id", "ASC"]]
    });
    if (byName) return byName;
  }
  return InventoryIntegration.findOne({ where: { companyId }, order: [["id", "ASC"]] });
}

/**
 * POST /inventory/agent/lookup
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

    logger.info(
      { ctx: "AgentLookup", companyId, integrationId, text, filtros, page, pageSize },
      "incoming agent lookup"
    );

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
      integ = await pickIntegrationByIntent(companyId, text);
      if (!integ) {
        logger.warn({ ctx: "AgentLookup", companyId }, "no integrations for company");
        return res.status(404).json({ error: "NoIntegrationForCompany" });
      }
    }

    logger.info(
      {
        ctx: "AgentLookup",
        integrationId: integ.get("id"),
        integrationName: integ.get("name"),
        categoryHint: integ.get("categoryHint") || null
      },
      "picked integration"
    );

    const planned = buildParamsForApi(
      { text, filtros, paginacao: { page, pageSize } },
      (integ as any).pagination
    );
    const params = (planned && (planned as any).params) || {};

    logger.debug(
      { ctx: "AgentLookup", integrationId: integ.get("id"), plannedParams: params },
      "planned params"
    );

    const t0 = Date.now();
    const out: RunSearchOutput = await runSearch(integ as any, {
      params, page, pageSize, text, filtros
    });
    const took = Date.now() - t0;

    logger.info(
      {
        ctx: "AgentLookup",
        integrationId: integ.get("id"),
        tookMs: took,
        total: out?.total ?? (out?.items?.length ?? 0)
      },
      "runSearch done"
    );

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
