// backend/src/services/InventoryServices/ResolveIntegrationService.ts
import InventoryIntegration from "../../models/InventoryIntegration";

/**
 * Estratégia bem simples de resolução por intenção.
 * - NÃO usa IA aqui; apenas matching heurístico por name/categoryHint.
 * - Pode evoluir depois para embeddings (sem mudar a assinatura).
 */
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

export async function resolveByIntent(text: string): Promise<ResolvedIntegration | null> {
  const needle = (text || "").toLowerCase();

  const list = await InventoryIntegration.findAll({
    attributes: ["id", "name", "categoryHint"],
    order: [["id", "ASC"]],
  });

  if (!list.length) return null;

  const ranked = list
    .map((it) => {
      const name = normalizeText(it.get("name") as string);
      const cat = normalizeText(it.get("categoryHint") as string | string[] | null);

      let score = 0;

      // heurísticas simples
      if (needle && name && name.includes(needle)) score += 4;
      if (needle && cat && cat.includes(needle)) score += 3;

      // alguns gatilhos úteis para imóveis (ex.: Vista)
      if (/im[oó]veis?|apart|kitnet|studio|mcmv|bairro|campinas|kobrasol|itagua[cç]u/i.test(needle)) {
        if (/vista|im[oó]veis?|real\s*estate/.test(name) || /im[oó]veis?/.test(cat)) {
          score += 3;
        }
      }

      // pequeno bônus por ter categoryHint preenchido
      if (cat) score += 1;

      return {
        id: it.get("id") as number,
        name: it.get("name") as string,
        categoryHint: it.get("categoryHint") as string | string[] | null,
        score,
      } as ResolvedIntegration;
    })
    .sort((a, b) => b.score - a.score);

  const top = ranked[0];
  if (!top || top.score <= 0) return null;
  return top;
}
