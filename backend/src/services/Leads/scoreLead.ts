export function scoreLead(s: {
  income?: number | null;
  downPaymentPct?: number | null; // % da entrada sobre o ticket alvo (quando souber)
  hasFGTS?: boolean | null;
  moment?: "agora"|"1-3m"|"3-6m"|"pesquisando"|null;
  hasObjectiveCriteria?: boolean | null; // tipo, dorms, etc.
  hasClearGeo?: boolean | null;          // cidade/bairro definidos
  engagementFast?: boolean | null;       // respondeu rápido
}): number {
  let sc = 0;
  if (s.income) sc += 30;
  if ((s.downPaymentPct != null && s.downPaymentPct >= 0.10) || s.hasFGTS) sc += 25;
  if (s.moment === "agora" || s.moment === "1-3m") sc += 20;
  if (s.hasObjectiveCriteria) sc += 10;
  if (s.hasClearGeo) sc += 10;
  if (s.engagementFast) sc += 5;
  return Math.max(0, Math.min(100, sc));
}
