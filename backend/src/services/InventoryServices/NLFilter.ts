// backend/src/services/InventoryServices/NLFilter.ts
// Motor semântico multi-domínio com HARD apenas para cidade/UF
// e SOFT para bairro, quartos e preço (com tolerância).

export type Criteria = {
  neighborhood?: string;
  city?: string;
  state?: string;

  // Imóveis
  bedrooms?: number;
  typeHint?: string;
  areaMin?: number;
  areaMax?: number;

  // Preço (genérico)
  priceMin?: number;
  priceMax?: number;

  // Veículos
  brand?: string;
  model?: string;
  yearMin?: number;
  yearMax?: number;
  transmission?: string;
  fuel?: string;
  kmMax?: number;

  // Saúde / Serviços
  specialty?: string;
  insurance?: string;
  date?: string;
  timeWindow?: string;

  // Beleza / Pet / Serviços
  service?: string;
  professional?: string;

  // Educação
  modality?: string;
  course?: string;
  schedule?: string;

  // Eventos
  capacityMin?: number;

  raw?: string;
};

const numberWordsPt: Record<string, number> = {
  um: 1, uma: 1, dois: 2, duas: 2, tres: 3, "três": 3, quatro: 4,
  cinco: 5, seis: 6, sete: 7, oito: 8, nove: 9, dez: 10
};

function normalize(s?: string) {
  return (s || "")
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .toLowerCase()
    .trim();
}
const normEq = (a?: string, b?: string) => !!a && !!b && normalize(a) === normalize(b);
const normIncludes = (hay?: string, needle?: string) =>
  !needle || (!!hay && normalize(hay).includes(normalize(needle)));
const anyIncludes = (list: Array<string | undefined>, needle?: string) =>
  !needle || list.some(h => normIncludes(h, needle));

function toNumber(v: any): number | undefined {
  if (v === null || v === undefined) return undefined;
  if (typeof v === "number" && isFinite(v)) return v;
  let s = String(v);
  // aceita 500k / 1.2M
  const km = s.match(/^\s*([\d.,]+)\s*k\s*$/i);
  const mm = s.match(/^\s*([\d.,]+)\s*m\s*$/i);
  if (km) return parseFloat(km[1].replace(/\./g, "").replace(",", ".")) * 1_000;
  if (mm) return parseFloat(mm[1].replace(/\./g, "").replace(",", ".")) * 1_000_000;
  s = s.replace(/[^\d.,-]/g, "").replace(/\./g, "").replace(",", ".");
  const n = Number(s);
  return isNaN(n) ? undefined : n;
}
function parseIntSafe(v: any): number | undefined {
  if (v === null || v === undefined) return undefined;
  const n = parseInt(String(v).replace(/\D+/g, ""), 10);
  return isNaN(n) ? undefined : n;
}

// Accessor tolerante (path + case/acento-insensitive)
function getField(obj: any, aliases: string[]) {
  for (const path of aliases) {
    let cur: any = obj;
    let ok = true;
    for (const rawKey of path.split(".")) {
      if (cur == null) { ok = false; break; }
      if (Object.prototype.hasOwnProperty.call(cur, rawKey)) {
        cur = cur[rawKey];
        continue;
      }
      const target = normalize(rawKey);
      const found = Object.keys(cur).find(k => normalize(k) === target);
      if (found !== undefined) cur = cur[found];
      else { ok = false; break; }
    }
    if (ok && cur !== undefined) return cur;
  }
  return undefined;
}

// Aliases
const TYPE_MAP: Record<string, string[]> = {
  apartamento: ["apartamento", "apto", "ap.", "ap", "flat"],
  casa: ["casa", "sobrado", "residencia", "residência"],
  studio: ["studio", "stúdio", "kitnet", "kitinete", "loft"],
  terreno: ["terreno", "lote", "loteamento"]
};
const TRANSMISSION_MAP = {
  automatico: ["automatico", "automático", "auto"],
  manual: ["manual"]
};
const FUEL_MAP = {
  flex: ["flex", "etanol", "alcool", "álcool"],
  gasolina: ["gasolina"],
  diesel: ["diesel"],
  eletrico: ["eletrico", "elétrico", "ev", "hibrido", "híbrido"]
};

function matchesAlias(hint?: string, value?: string, map?: Record<string, string[]>) {
  if (!hint) return true;
  if (!value) return false;
  const src = normalize(value);
  const wanted = map?.[normalize(hint)];
  if (!wanted) return src.includes(normalize(hint));
  return wanted.some(w => src.includes(normalize(w)));
}
function typeMatches(itemType?: string, hint?: string) {
  if (!hint) return true;
  return matchesAlias(hint, itemType, TYPE_MAP);
}

function normalizePrice(s: string): number | undefined {
  let str = normalize(s).replace(/[^\d,\.k\- ]/g, "").trim();
  let mult = 1;
  if (str.includes("milhao") || str.includes("milhoes")) mult = 1_000_000;
  else if (/\b(k|mil)\b/.test(str)) mult = 1_000;
  const n = toNumber(str);
  return n !== undefined ? Math.round(n * mult) : undefined;
}

// -------- Parser (mantive tua base, com pequenos acertos) --------
export function parseCriteriaFromText(text: string): Criteria {
  const t = normalize(text);
  const crit: Criteria = { raw: t };

  // Bairro
  const mB = t.match(/\bbairro\s+([a-z0-9\s\-]+)/);
  if (mB?.[1]) crit.neighborhood = mB[1].trim();

  // cidade/UF no formato “sao jose/sc” ou “em sao jose”
  const cityState = t.match(/\b([a-z\s]+)\s*\/\s*([a-z]{2})\b/);
  if (cityState) { crit.city = cityState[1].trim(); crit.state = cityState[2].toUpperCase(); }
  else {
    const mCity = t.match(/\bem\s+([a-z\s]+)\b/);
    if (mCity) crit.city = mCity[1].trim();
    const st = t.match(/\b(sc|rs|pr|sp|rj|mg|ba|df|go|es|pe|ce|pa|am|mt|ms|rn|pb|al|se|ma|pi|ro|rr|ap|to|ac)\b/);
    if (st) crit.state = st[1].toUpperCase();
  }

  // Imóveis
  let q = t.match(/(\d+)\s*(quartos?|dormitorios?|dormit[oó]rios?)/);
  if (q?.[1]) crit.bedrooms = parseInt(q[1], 10);
  if (!crit.bedrooms) {
    const mq = t.match(/\b(um|uma|dois|duas|tres|três|quatro|cinco|seis|sete|oito|nove|dez)\s*(quartos?|dormitorios?)\b/);
    if (mq?.[1]) crit.bedrooms = numberWordsPt[mq[1]];
  }
  const tipos = ["apartamento", "casa", "kitnet", "studio", "sobrado", "terreno"];
  for (const tp of tipos) if (t.includes(tp)) { crit.typeHint = tp; break; }

  const areaMin = t.match(/(area|área)\s*(minima|min)\s*([\d\.,]+)/);
  const areaMax = t.match(/(area|área)\s*(maxima|max)\s*([\d\.,]+)/);
  if (areaMin?.[3]) crit.areaMin = toNumber(areaMin[3]);
  if (areaMax?.[3]) crit.areaMax = toNumber(areaMax[3]);

  // Preços
  const priceMax1 = t.match(/\bat[eé]\s*(r?\$?\s*[\d\.\,]+(?:k|mil|milhoes|milhão)?)\b/);
  if (priceMax1?.[1]) crit.priceMax = normalizePrice(priceMax1[1]);
  const priceRange = t.match(/entre\s*(r?\$?\s*[\d\.\,]+(?:k|mil|milhoes|milhão)?)\s*e\s*(r?\$?\s*[\d\.\,]+(?:k|mil|milhoes|milhão)?)/);
  if (priceRange?.[1]) crit.priceMin = normalizePrice(priceRange[1]);
  if (priceRange?.[2]) crit.priceMax = normalizePrice(priceRange[2]);

  // Veículos
  const yearTo = t.match(/\b(ate|até)\s*(\d{4})\b/);
  const yearFrom = t.match(/\b(a partir de|de)\s*(\d{4})\b/);
  const yearExact = t.match(/\bano\s*(\d{4})\b/);
  if (yearTo?.[2]) crit.yearMax = parseInt(yearTo[2], 10);
  if (yearFrom?.[2]) crit.yearMin = parseInt(yearFrom[2], 10);
  if (yearExact?.[1]) { crit.yearMin = parseInt(yearExact[1], 10); crit.yearMax = parseInt(yearExact[1], 10); }

  const km = t.match(/\b(km|quilometragem)\s*(ate|até)?\s*([\d\.\,]+)/);
  if (km?.[3]) crit.kmMax = toNumber(km[3]);

  if (t.includes("automatic")) crit.transmission = "automatico";
  else if (t.includes("automati")) crit.transmission = "automatico";
  else if (t.includes("manual")) crit.transmission = "manual";

  if (t.includes("flex")) crit.fuel = "flex";
  else if (t.includes("gasolina")) crit.fuel = "gasolina";
  else if (t.includes("diesel")) crit.fuel = "diesel";
  else if (t.includes("eletric") || t.includes("hibrid")) crit.fuel = "eletrico";

  // (demais domínios mantidos)
  return crit;
}

// Blob de busca
function makeSearchBlob(it: any) {
  const parts: string[] = [];
  const push = (v: any) => { if (v != null) parts.push(String(v)); };

  push(getField(it, ["title","TituloSite","Titulo","nome","name"]));
  push(getField(it, ["description","Descricao","Descrição","resumo","desc"]));
  push(getField(it, ["category","Categoria","tipo","Tipo","TipoImovel","tipoImovel"]));
  push(getField(it, ["slug","url","link"]));

  push(getField(it, ["location.city","Cidade","cidade","city"]));
  push(getField(it, ["location.neighborhood","Bairro","bairro","neighborhood"]));
  push(getField(it, ["location.state","Estado","estado","UF","uf","state"]));

  push(getField(it, ["Dormitorios","Dormitórios","dormitorios","dormitórios","Quartos","quartos","bedrooms"]));
  push(getField(it, ["AreaPrivativa","area","Área","Area","M2","m2","squareMeters"]));

  push(getField(it, ["ValorVenda","Preco","Preço","price","valor","valor_total"]));

  return normalize(parts.join(" | "));
}

function coerceItems(maybe: any): any[] {
  if (Array.isArray(maybe)) return maybe;
  if (maybe && Array.isArray(maybe.data)) return maybe.data;
  return [];
}

// ----------------- FILTER + RANK -----------------
export function filterAndRankItems(itemsIn: any[], criteria: Criteria): any[] {
  const items = coerceItems(itemsIn);
  if (!Array.isArray(items) || !items.length) return [];

  const ranked: Array<{ it: any; score: number }> = [];

  for (const it of items) {
    const bairro   = getField(it, ["location.neighborhood","neighborhood","Bairro","bairro"]);
    const cidade   = getField(it, ["location.city","city","Cidade","cidade"]);
    const estado   = getField(it, ["location.state","state","Estado","estado","UF","uf"]);
    const titulo   = getField(it, ["TituloSite","Titulo","title","name"]);
    const categoria= getField(it, ["category","Categoria","tipo","Tipo","TipoImovel","tipoImovel"]);
    const priceRaw = getField(it, ["ValorVenda","Preco","Preço","price","valor","valor_total"]);
    const price    = toNumber(priceRaw);

    const dorm     = parseIntSafe(getField(it, ["bedrooms","Dormitorios","Dormitórios","dormitorios","dormitórios","Quartos","quartos"]));
    const area     = toNumber(getField(it, ["AreaPrivativa","area","Área","Area","M2","m2"]));
    const tipoItem = String(categoria ?? titulo ?? "");

    const blob = makeSearchBlob(it);

    // ---------- HARD (mínimo necessário) ----------
    // Cidade/UF: precisa bater; aceita no blob também
    if (criteria.city) {
      const okCity = normIncludes(cidade, criteria.city) || blob.includes(normalize(criteria.city));
      if (!okCity) continue;
    }
    if (criteria.state) {
      if (estado && !normEq(estado, criteria.state)) continue;
    }

    // Área (quando vier)
    if (criteria.areaMin !== undefined && area !== undefined && area < criteria.areaMin) continue;
    if (criteria.areaMax !== undefined && area !== undefined && area > criteria.areaMax) continue;

    // Tipo: hard leve (precisa ter algum sinal no tipo/título/blob)
    if (criteria.typeHint) {
      const okType = typeMatches(tipoItem, criteria.typeHint) || blob.includes(normalize(criteria.typeHint));
      if (!okType) continue;
    }

    // Veículos e outros domínios (mantidos como antes, mas não são o foco aqui)
    // ...

    // ---------- SCORE (SOFT) ----------
    let score = 0;

    // Bairro: só pontua (não exclui mais se não bater)
    if (criteria.neighborhood) {
      if (anyIncludes([bairro, titulo], criteria.neighborhood) || blob.includes(normalize(criteria.neighborhood))) {
        score += 5;
      } else {
        // se pediu bairro mas não bateu, leve penalidade
        score -= 1.5;
      }
    }

    // Quartos: SOFT (exato +2; diferença de 1 +1; diferença >=2 penaliza e pode excluir)
    if (criteria.bedrooms !== undefined) {
      if (dorm !== undefined) {
        const diff = Math.abs(dorm - criteria.bedrooms);
        if (diff === 0) score += 2;
        else if (diff === 1) score += 1;
        else if (diff >= 2) {
          // muito diferente do pedido: descarta
          continue;
        }
      } else {
        // sem informação de dormitórios: não exclui, só não pontua
        score += 0;
      }
    }

    // Preço: teto com tolerância de +5% (mostra, mas penaliza)
    if (criteria.priceMax !== undefined && price !== undefined) {
      if (price <= criteria.priceMax) score += 0.8;
      else if (price <= criteria.priceMax * 1.05) score += 0.2; // leve tolerância
      else continue; // muito acima do teto informado
    }
    if (criteria.priceMin !== undefined && price !== undefined) {
      if (price >= criteria.priceMin) score += 0.3;
      else score -= 0.5;
    }

    // Cidade/UF que bateram também somam
    if (criteria.city && (anyIncludes([cidade, titulo], criteria.city) || blob.includes(normalize(criteria.city)))) score += 1.2;
    if (criteria.state && estado && normEq(estado, criteria.state)) score += 0.4;

    // Tipo que bate soma
    if (criteria.typeHint && (typeMatches(tipoItem, criteria.typeHint) || blob.includes(normalize(criteria.typeHint)))) score += 1.2;

    // Área que bate limites (quando existe)
    if (criteria.areaMin && area && area >= criteria.areaMin) score += 0.3;
    if (criteria.areaMax && area && area <= criteria.areaMax) score += 0.3;

    ranked.push({ it, score });
  }

  // fallback: se nada passou, devolve o lote bruto (para nunca responder “0” à toa)
  const base = ranked.length ? ranked : items.map(it => ({ it, score: 0 }));

  // Ordena por score desc; em empate, menor preço primeiro (se houver)
  base.sort((a, b) => {
    if (b.score !== a.score) return b.score - a.score;
    const pa = toNumber(getField(a.it, ["ValorVenda","Preco","Preço","price","valor","valor_total"]));
    const pb = toNumber(getField(b.it, ["ValorVenda","Preco","Preço","price","valor","valor_total"]));
    if (pa != null && pb != null) return pa - pb;
    return 0;
  });

  return base.map(x => x.it);
}

export function paginateRanked(list: any[], page: number, pageSize: number) {
  const p = Math.max(1, page | 0);
  const s = Math.max(1, pageSize | 0);
  const start = (p - 1) * s;
  return list.slice(start, start + s);
}
