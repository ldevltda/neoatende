// backend/src/services/Finance/FinancingCalculator.ts

export type BudgetInput = {
  rendaMensal: number;      // renda bruta familiar
  entrada?: number;         // R$ (dinheiro + FGTS que vira entrada)
  fgts?: number;            // R$ (se preferir separar)
  idade?: number;           // anos
  prazoPreferidoMeses?: number; // 360/420...
  taxaMensal?: number;      // ex.: 0.010 = 1% a.m. (ajustável por produto)
  comprometimentoMax?: number; // fração da renda: ex.: 0.3 = 30%
};

export type BudgetOut = {
  prazoMeses: number;
  taxaMensal: number;
  parcelaMax: number;
  pvMaxPRICE: number;   // limite de crédito por PRICE
  pvMaxSAC: number;     // limite conservador por SAC (1ª parcela)
  pvRecomendado: number; // min(pvPRICE, pvSAC)
  faixaImovel: { minimo: number; maximo: number }; // pv + entrada efetiva
  disclaimers: string[];
};

// --- Básicos ---
export function pricePMT(PV: number, i: number, n: number) {
  // PMT = PV * i / (1 - (1+i)^-n)
  return PV * (i / (1 - Math.pow(1 + i, -n)));
}
export function pricePV(PMT: number, i: number, n: number) {
  return PMT * (1 - Math.pow(1 + i, -n)) / i;
}
export function sacFirstInstallment(PV: number, i: number, n: number) {
  // 1a parcela SAC = amortização + juros do saldo inicial
  return PV / n + PV * i;
}
export function sacPVByFirstInstallment(maxFirstInstallment: number, i: number, n: number) {
  // maxFirst = PV/n + PV*i = PV*(i + 1/n)  => PV = maxFirst / (i + 1/n)
  return maxFirstInstallment / (i + 1 / n);
}

// Idade x prazo (80a6m)
export function prazoMaxPorIdade(idade?: number) {
  const LIMITE_ANOS = 80.5;
  if (!idade || idade <= 0) return 420;
  const restante = Math.max(0, LIMITE_ANOS - idade);
  return Math.min(420, Math.floor(restante * 12));
}

export function calcularBudget(input: BudgetInput): BudgetOut {
  const renda = Math.max(0, Number(input.rendaMensal || 0));
  const entradaEfetiva = Math.max(0, Number(input.entrada || 0)) + Math.max(0, Number(input.fgts || 0));
  const taxa = Number(input.taxaMensal ?? 0.010);       // 1% a.m. default (ajuste por produto)
  const compromet = Math.min(0.4, Number(input.comprometimentoMax ?? 0.3)); // 30% (padrão conservador)
  const prazo = Number(input.prazoPreferidoMeses || prazoMaxPorIdade(input.idade) || 420);

  const parcelaMax = renda * compromet;

  const pvPRICE = pricePV(parcelaMax, taxa, prazo);
  const pvSAC = sacPVByFirstInstallment(parcelaMax, taxa, prazo);
  const pvRecomendado = Math.min(pvPRICE, pvSAC);

  const faixaMin = Math.max(0, pvRecomendado * 0.85 + entradaEfetiva); // margem de conforto
  const faixaMax = pvRecomendado + entradaEfetiva;

  const disclaimers = [
    "Estimativa educativa. Sem garantia de aprovação.",
    "Taxa e prazo reais variam por produto (MCMV, SBPE, relacionamento).",
    "Considere custos acessórios (ITBI, escritura, registro, taxa de avaliação)."
  ];

  return {
    prazoMeses: prazo,
    taxaMensal: taxa,
    parcelaMax,
    pvMaxPRICE: pvPRICE,
    pvMaxSAC: pvSAC,
    pvRecomendado,
    faixaImovel: { minimo: Math.round(faixaMin), maximo: Math.round(faixaMax) },
    disclaimers
  };
}
