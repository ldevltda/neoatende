// Filtro LOCAL (pós-provedor): interpreta o texto livre e filtra/ranqueia itens.
// Funciona para Imóveis (Vista) e é fácil expandir.

export type Criteria = {
  type?: "Apartamento" | "Casa" | "Cobertura" | string;
  bedrooms?: number;           // exato
  neighborhood?: string;       // "Campinas"
  city?: string;               // "São José"
  priceMin?: number;           // em reais
  priceMax?: number;           // em reais
};

type NumberLike = number | string | null | undefined;

const RE_ACCENT = /\p{Diacritic}/gu;
const deburr = (s: any) =>
  String(s ?? "").normalize("NFD").replace(RE_ACCENT, "").toLowerCase().trim();

const toInt = (v: NumberLike): number | undefined => {
  if (v === null || v === undefined) return undefined;
  if (typeof v === "number") return Number.isFinite(v) ? Math.round(v) : undefined;
  const n = Number(String(v).replace(/[^\d.-]/g, ""));
  return Number.isFinite(n) ? Math.round(n) : undefined;
};

const contains = (a: string, b: string) => deburr(a).includes(deburr(b));

/* ---------- PARSER DE TEXTO → CRITÉRIOS ---------- */

export function parseCriteriaFromText(text?: string): Criteria | null {
  if (!text) return null;

  const orig = text;
  const t = deburr(text);

  const out: Criteria = {};

  // tipo do imóvel
  if (/\b(apto|ap\.?|apartamento|kitnet|studio)\b/i.test(orig)) out.type = "Apartamento";
  else if (/\b(casa|sobrado)\b/i.test(orig)) out.type = "Casa";
  else if (/\b(cobertura)\b/i.test(orig)) out.type = "Cobertura";

  // quartos (exato)
  {
    const m = t.match(/(\d+)\s*(quartos?|qts?|dormitorios?)/i);
    if (m) {
      const q = Number(m[1]);
      if (Number.isFinite(q)) out.bedrooms = q;
    }
  }

  // bairro (mantém acento do texto original)
  {
    const m = orig.match(/bairro\s+([A-Za-zÀ-ÿ' \-]+)/i);
    if (m) out.neighborhood = m[1].split(/[,\-]/)[0].trim();
  }

  // cidade (pega "São José/SC" ou "em São José")
  {
    const mUF = orig.match(/([A-Za-zÀ-ÿ' ]+)\/[A-Za-z]{2}/);
    if (mUF) out.city = mUF[1].trim();
    if (!out.city) {
      const m2 = orig.match(/\b(?:em|de|na|no)\s+([A-Za-zÀ-ÿ' ]+)\b/i);
      if (m2) out.city = m2[1].trim();
    }
  }

  // PREÇO: até / entre / a partir de
  const moneyToNumber = (s: string) => {
    const base = s.replace(/\./g, "").replace(",", ".").trim().toLowerCase();
    // 1,2 mi | 1.2 mi | 1 mi | 1m
    if (/\bmi?\b/.test(base) || /milh/.test(base) || /\bm\b/.test(base)) {
      const n = parseFloat(base.replace(/[^\d.]/g, ""));
      if (!Number.isNaN(n)) return Math.round(n * 1_000_000);
    }
    // 500k | 500 mil
    if (/\bk\b/.test(base) || /\bmil\b/.test(base)) {
      const n = parseFloat(base.replace(/[^\d.]/g, ""));
      if (!Number.isNaN(n)) return Math.round(n * 1_000);
    }
    const n = parseFloat(base.replace(/[^\d.]/g, ""));
    if (!Number.isNaN(n)) return Math.round(n);
    return undefined;
  };

  // de X a Y / entre X e Y
  {
    const m = t.match(/(?:de|entre)\s+([^\s].*?)\s+(?:a|e|ate)\s+([^\s].*)/);
    if (m) {
      const n1 = moneyToNumber(m[1]);
      const n2 = moneyToNumber(m[2]);
      if (n1 && n2) {
        out.priceMin = Math.min(n1, n2);
        out.priceMax = Math.max(n1, n2);
      }
    }
  }
  // a partir de X
  if (out.priceMin === undefined) {
    const mMin = t.match(/a\s+partir\s+de\s+([^\s].*)/);
    if (mMin) {
      const n = moneyToNumber(mMin[1]);
      if (n) out.priceMin = n;
    }
  }
  // até Y
  if (out.priceMax === undefined && /(ate|até)\s+/.test(t)) {
    const n = moneyToNumber(text);
    if (n) out.priceMax = n;
  }

  return Object.keys(out).length ? out : null;
}

/* ---------- UTILIDADES PARA CAMPOS VARIÁVEIS ---------- */

function pickField(item: any, candidates: string[]): any {
  for (const k of candidates) {
    if (item == null) continue;
    // match case-insensitive direto
    const direct = Object.keys(item).find((kk) => kk.toLowerCase() === k.toLowerCase());
    if (direct) return item[direct];
    // tenta sem acento
    const wanted = deburr(k);
    const hit = Object.keys(item).find((kk) => deburr(kk) === wanted);
    if (hit) return item[hit];
  }
  return undefined;
}

function getCity(item: any) {
  return pickField(item, ["Cidade", "city", "Municipio"]);
}
function getNeighborhood(item: any) {
  return pickField(item, ["Bairro", "neighborhood", "Distrito"]);
}
function getType(item: any) {
  return pickField(item, ["Categoria", "Tipo", "TipoImovel", "category", "type", "TituloSite"]);
}
function getBedrooms(item: any): number | undefined {
  const raw = pickField(item, ["Dormitorios", "Quartos", "Bedrooms", "dorms"]);
  return toInt(raw);
}
function getPrice(item: any): number | undefined {
  const raw = pickField(item, ["ValorVenda", "Valor", "Preco", "price"]);
  return toInt(raw);
}

/* ---------- FILTRAGEM + RANQUEAMENTO ---------- */

export type Ranked = { item: any; score: number };

export function filterAndRankItems(items: any[], criteria: Criteria | null): Ranked[] {
  if (!Array.isArray(items) || !items.length || !criteria) {
    return (items || []).map((it) => ({ item: it, score: 0 }));
  }

  const out: Ranked[] = [];
  for (const it of items) {
    const city = String(getCity(it) ?? "");
    const bairro = String(getNeighborhood(it) ?? "");
    const tipo = String(getType(it) ?? "");
    const price = getPrice(it);
    const dorms = getBedrooms(it);

    let pass = true;
    let score = 0;

    if (criteria.type) {
      const target = criteria.type;
      pass &&= contains(tipo, target) || contains(tipo, target.slice(0, 4)) || contains(tipo, "apart") && target === "Apartamento";
      if (contains(tipo, target)) score += 2;
    }

    if (criteria.city) {
      pass &&= contains(city, criteria.city);
      if (contains(city, criteria.city)) score += 2;
    }

    if (criteria.neighborhood) {
      pass &&= contains(bairro, criteria.neighborhood);
      if (contains(bairro, criteria.neighborhood)) score += 2;
    }

    if (criteria.bedrooms !== undefined) {
      pass &&= dorms === criteria.bedrooms;
      if (dorms === criteria.bedrooms) score += 2;
    }

    if (criteria.priceMin !== undefined) {
      pass &&= (price ?? Infinity) >= criteria.priceMin;
      if (price !== undefined && price >= criteria.priceMin) score += 1;
    }
    if (criteria.priceMax !== undefined) {
      pass &&= (price ?? 0) <= criteria.priceMax;
      if (price !== undefined && price <= criteria.priceMax) score += 1;
    }

    if (pass) out.push({ item: it, score });
  }

  // Ordenação: se tiver teto de preço, usa preço asc; senão score desc, depois preço asc.
  if (criteria.priceMax !== undefined) {
    out.sort((a, b) => (getPrice(a.item) ?? Infinity) - (getPrice(b.item) ?? Infinity));
  } else {
    out.sort((a, b) => {
      if (b.score !== a.score) return b.score - a.score;
      return (getPrice(a.item) ?? Infinity) - (getPrice(b.item) ?? Infinity);
    });
  }
  return out;
}

export function paginateRanked(ranked: Ranked[], page: number, pageSize: number): any[] {
  const p = Math.max(1, page || 1);
  const s = Math.max(1, pageSize || 10);
  const start = (p - 1) * s;
  return ranked.slice(start, start + s).map(r => r.item);
}
