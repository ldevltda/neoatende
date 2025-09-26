export type LeadInputs = {
  rendaFamiliar?: number;        // R$
  entradaPercent?: number;       // 0..100
  temFGTS?: boolean;
  momentoMeses?: number;         // 0 | 1..3 | 3..6 | 999 ("pesquisando")
  criteriosClaros?: boolean;     // tipologia/quartos/area definidos
  localDefinido?: boolean;       // cidade/bairros
  engajamentoRapido?: boolean;   // respondeu < 10min (exemplo)
};

export function scoreLead(i: LeadInputs) {
  let score = 0;
  if ((i.rendaFamiliar || 0) > 0) score += 30;
  if ((i.entradaPercent || 0) >= 10 || i.temFGTS) score += 25;
  if ((i.momentoMeses || 999) <= 3) score += 20;
  if (i.criteriosClaros) score += 10;
  if (i.localDefinido) score += 10;
  if (i.engajamentoRapido) score += 5;

  score = Math.max(0, Math.min(100, score));
  const stage: "A" | "B" | "C" = score >= 80 ? "A" : score >= 60 ? "B" : "C";
  return { score, stage };
}
