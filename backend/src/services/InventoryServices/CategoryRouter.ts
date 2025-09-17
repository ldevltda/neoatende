import InventoryIntegration from "../../models/InventoryIntegration";

const DEFAULT_SYNONYMS: Record<string, string[]> = {
  "imoveis": [
    "imovel","imóveis","imoveis","apartamento","apto","ap.","casa","sobrado",
    "cobertura","kitnet","studio","alugar","aluguel","comprar","vender",
    "condominio","bairro","cidade","corretor","imobiliaria","imobiliária"
  ],
  "carros": ["carro","veiculo","veículo","automovel","automóvel","seminovo","zero","km"],
  "produtos": ["produto","estoque","item","catalogo","catálogo","vender","comprar"]
};

const deburr = (s: any) =>
  String(s ?? "").normalize("NFD").replace(/\p{Diacritic}/gu, "").toLowerCase();

function tokenizeHint(hint?: string): string[] {
  if (!hint) return [];
  const base = deburr(hint);
  const tokens = base.split(/[^a-z0-9]+/).filter(Boolean);
  // inclui lista default se bater em uma chave conhecida
  const pack = Object.keys(DEFAULT_SYNONYMS).find(k => base.includes(k));
  const extra = pack ? DEFAULT_SYNONYMS[pack] : [];
  return Array.from(new Set([...tokens, ...extra]));
}

function score(text: string, synonyms: string[]): number {
  const t = deburr(text);
  let pts = 0;
  for (const w of synonyms) {
    if (!w) continue;
    if (t.includes(w)) pts += w.length >= 5 ? 2 : 1; // palavras maiores valem mais
  }
  return pts;
}

export async function chooseIntegrationByText(companyId: number, text: string) {
  const list = await InventoryIntegration.findAll({ where: { companyId } });
  if (!list.length) return null;

  let best: any = null;
  let bestScore = 0;

  for (const it of list) {
    const hint = (it as any).get?.("categoryHint") ?? (it as any).categoryHint;
    const words = tokenizeHint(hint);
    const pts = score(text, words);
    if (pts > bestScore) {
      bestScore = pts;
      best = it;
    }
  }

  return bestScore > 0 ? best : null;
}
