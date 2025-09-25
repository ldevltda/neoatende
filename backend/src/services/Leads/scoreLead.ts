export function scoreLead(s: {
  income?: number | null;
  downPayment?: number | null;
  usesFGTS?: boolean | null;
  moment?: "agora"|"1-3m"|"3-6m"|"pesquisando"|null;
  city?: string | null;
  neighborhood?: string | null;
  type?: string | null;
  bedrooms?: number | null;
}): number {
  let score = 0;
  if (s.income) score += 30;
  if ((s.downPayment && s.downPayment >= 0.1) || s.usesFGTS) score += 25; // heurística
  if (s.moment === "agora" || s.moment === "1-3m") score += 20;
  const objetivos = [s.type, s.bedrooms != null ? "bed" : null].filter(Boolean).length;
  if (objetivos) score += 10;
  if (s.neighborhood || s.city) score += 10;
  // engajamento pode somar +5 em outro ponto (tempo-resposta)
  return Math.min(100, score);
}
