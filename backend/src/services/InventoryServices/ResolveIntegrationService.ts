import InventoryIntegration from "../../models/InventoryIntegration";

/**
 * Resolve integração mais adequada para a intenção.
 * Hoje está simples: pega a primeira que bater com o categoryHint ou nome.
 */
export async function resolveByIntent(
  text: string,
  companyId?: number
): Promise<{ id: number; name: string } | null> {
  if (!text) return null;

  const where: any = {};
  if (companyId) {
    where.companyId = companyId;
  }

  const integrations = await InventoryIntegration.findAll({ where });

  // 🔎 Estratégia simples: match no categoryHint ou nome
  const lower = text.toLowerCase();
  const pick = integrations.find(
    (i) =>
      (i.get("categoryHint") || "").toString().toLowerCase().includes(lower) ||
      (i.get("name") || "").toString().toLowerCase().includes(lower)
  );

  if (!pick) return null;

  return { id: pick.get("id") as number, name: pick.get("name") as string };
}
