// backend/src/services/InventoryServices/ResolveIntegrationService.ts
import InventoryIntegration from "../../models/InventoryIntegration";

export type ResolvedIntegration = {
  id: number;
  name: string;
  categoryHint?: string | string[] | null;
  score: number;
};

function normalizeText(s?: string | string[] | null) {
  if (!s) return "";
  return (Array.isArray(s) ? s.join(" ") : s).toLowerCase();
}

/**
 * Resolve integração por intenção de texto.
 * - Filtra por companyId, para não vazar integrações entre empresas.
 */
export async function resolveByIntent(
  text: string,
  companyId?: number
): Promise<ResolvedIntegration | null> {
  const needle = (text || "").toLowerCase();

  const where: any = {};
  if (companyId) where.companyId = companyId;

  const list = await InventoryIntegration.findAll({
    where,
    attributes: ["id", "name", "categoryHint"],
    order: [["id", "ASC"]]
  });
  if (!list.length) return null;

  const ranked = list
    .map((it) => {
      const name = normalizeText(it.get("name") as string);
      const cat  = normalizeText(it.get("categoryHint") as string | string[] | null);

      let score = 0;
      if (needle && name && name.includes(needle)) score += 4;
      if (needle && cat  && cat.includes(needle)) score += 3;

      // gatilhos úteis p/ imóveis (Vista)
      if (/im[oó]veis?|apart|kitnet|studio|mcmv|bairro|campinas|kobrasol|itagua[cç]u/i.test(needle)) {
        if (/vista|im[oó]veis?|real\s*estate/.test(name) || /im[oó]veis?/.test(cat)) {
          score += 3;
        }
      }

      if (cat) score += 1;

      return {
        id: it.get("id") as number,
        name: it.get("name") as string,
        categoryHint: it.get("categoryHint") as any,
        score
      } as ResolvedIntegration;
    })
    .sort((a, b) => b.score - a.score);

  const top = ranked[0];
  if (!top || top.score <= 0) return null;
  return top;
}
