// backend/src/services/InventoryServices/NLFilter.ts
// Pós-filtro local: interpreta o texto do usuário, aplica HARD-FILTER e ranqueia.

export type Criteria = {
  bedrooms?: number;       // 2, 3...
  neighborhood?: string;   // "Campinas"
  city?: string;           // "São José"
  state?: string;          // "SC"
  // priceMax?: number;    // opcional
  typeHint?: string;       // "apartamento", "casa", "studio"...
};

const numberWordsPt: Record<string, number> = {
  "um": 1, "uma": 1, "dois": 2, "duas": 2, "três": 3, "tres": 3, "quatro": 4,
  "cinco": 5, "seis": 6, "sete": 7, "oito": 8, "nove": 9, "dez": 10
};

function normalize(s?: string) {
  return (s || "")
    .normalize("NFD").replace(/\p{Diacritic}/gu, "")
    .toLowerCase().trim();
}

function normEq(a?: string, b?: string) {
  if (!a || !b) return false;
  return normalize(a) === normalize(b);
}

function normIncludes(hay?: string, needle?: string) {
  if (!needle) return true;
  if (!hay) return false;
  return normalize(hay).includes(normalize(needle));
}

function anyIncludes(hayList: Array<string | undefined>, needle?: string) {
  if (!needle) return true;
  return hayList.some(h => normIncludes(h, needle));
}

function parseIntSafe(v: any): number | undefined {
  if (v === null || v === undefined) return undefined;
  const n = parseInt(String(v).replace(/\D+/g, ""), 10);
  return isNaN(n) ? undefined : n;
}

function getField(obj: any, aliases: string[]) {
  for (const k of aliases) {
    if (obj && Object.prototype.hasOwnProperty.call(obj, k)) return obj[k];
  }
  return undefined;
}

function typeMatches(itemType?: string, hint?: string) {
  if (!hint) return true;
  const map: Record<string, string[]> = {
    "apartamento": ["apartamento", "apto", "ap.", "ap"],
    "casa": ["casa", "sobrado"],
    "studio": ["studio", "stúdio", "kitnet", "kitinete", "loft"],
    "kitnet": ["kitnet", "kitinete"],
    "sobrado": ["sobrado"]
  };
  const wanted = map[hint] ?? [hint];
  const src = normalize(itemType ?? "");
  return wanted.some(w => src.includes(normalize(w)));
}

export function parseCriteriaFromText(text: string): Criteria {
  const t = normalize(text);
  const crit: Criteria = {};

  // bedrooms
  let m = t.match(/(\d+)\s*(quartos?|dormitorios?)/);
  if (m?.[1]) crit.bedrooms = parseInt(m[1], 10);
  if (!crit.bedrooms) {
    const mw = t.match(/\b(um|uma|dois|duas|tres|três|quatro|cinco|seis|sete|oito|nove|dez)\s*(quartos?|dormitorios?)\b/);
    if (mw?.[1]) crit.bedrooms = numberWordsPt[mw[1]];
  }

  // neighborhood
  m = t.match(/bairro\s+([a-z0-9\s\-]+)/);
  if (m?.[1]) {
    crit.neighborhood = m[1].trim().replace(/\s+sc\b$/, "").trim();
  } else {
    // "em campinas" (evita capturar nome de cidade conhecida)
    const mb = t.match(/\bem\s+([a-z0-9\s\-]+)\b/);
    if (mb?.[1] && !/\b(sao jose|são jose|florianopolis|florianopolis|palhoca|palhoça|biguaçu|bigua\su)\b/.test(mb[1])) {
      crit.neighborhood = mb[1].trim();
    }
  }

  // city/state
  const cityState = t.match(/\b(sao jose|são jose|florianopolis|florianópolis|palhoca|palhoça|biguaçu|biguacu)\s*\/\s*([a-z]{2})\b/);
  if (cityState) {
    const cs = cityState[1].replace("sao", "são");
    crit.city = cs;
    crit.state = cityState[2].toUpperCase();
  } else {
    const cityOnly = t.match(/\bem\s+(sao jose|são jose|florianopolis|florianópolis|palhoca|palhoça|biguaçu|biguacu)\b/);
    if (cityOnly) crit.city = cityOnly[1].replace("sao", "são");
    const st = t.match(/\b(sc|rs|pr|sp|rj|mg|ba|df|go|es|pe|ce|pa|am|mt|ms|rn|pb|al|se|ma|pi|ro|rr|ap|to|ac)\b/);
    if (st) crit.state = st[1].toUpperCase();
  }

  // type
  const types = ["apartamento", "casa", "kitnet", "studio", "sobrado", "terreno"];
  for (const tp of types) {
    if (t.includes(tp)) { crit.typeHint = tp; break; }
  }

  return crit;
}

/**
 * HARD FILTER + ranking
 */
export function filterAndRankItems(items: any[], criteria: Criteria): any[] {
  if (!Array.isArray(items) || !items.length) return [];

  const filtered = items.filter((it) => {
    // mapeia campos usuais que podem vir do normalizador ou do provider
    const bairro   = getField(it, ["location?.neighborhood", "neighborhood", "Bairro", "bairro"]) ?? (it.location?.neighborhood);
    const cidade   = getField(it, ["location?.city", "city", "Cidade", "cidade"]) ?? (it.location?.city);
    const estado   = getField(it, ["location?.state", "state", "Estado", "estado", "UF"]) ?? (it.location?.state);
    const titulo   = getField(it, ["TituloSite", "Titulo", "title", "Descricao", "Descrição", "Categoria", "categoria"]);
    const tipoItem = getField(it, ["type", "tipo", "Tipo", "TipoImovel", "tipoImovel", "Categoria", "categoria"]) ?? titulo;

    const dormRaw  = getField(it, ["bedrooms", "Dormitorios", "Dormitórios", "dormitorios", "Quartos", "quartos"]);
    const dorm     = parseIntSafe(dormRaw);

    // ——— HARD FILTER ———
    if (criteria.city && !(normIncludes(cidade, criteria.city) || anyIncludes([titulo, it.address], criteria.city))) {
      return false;
    }
    if (criteria.neighborhood && !(normIncludes(bairro, criteria.neighborhood) || anyIncludes([titulo, it.address], criteria.neighborhood))) {
      return false;
    }
    if (criteria.state && estado && !normEq(estado, criteria.state)) {
      return false;
    }
    if (criteria.bedrooms !== undefined && dorm !== undefined && dorm !== criteria.bedrooms) {
      return false;
    }
    if (criteria.typeHint && !typeMatches(String(tipoItem || ""), criteria.typeHint)) {
      return false;
    }

    return true;
  });

  // Se o hard-filter deixou vazio (porque os campos do provider variam),
  // não devolve 0: faça um ranking "suave" do lote original.
  const base = filtered.length ? filtered : items;

  const ranked = base
    .map((it) => {
      let score = 0;

      const bairro   = getField(it, ["location?.neighborhood", "neighborhood", "Bairro", "bairro"]) ?? (it.location?.neighborhood);
      const cidade   = getField(it, ["location?.city", "city", "Cidade", "cidade"]) ?? (it.location?.city);
      const estado   = getField(it, ["location?.state", "state", "Estado", "estado", "UF"]) ?? (it.location?.state);
      const titulo   = getField(it, ["TituloSite", "Titulo", "title", "Descricao", "Descrição", "Categoria", "categoria"]);
      const tipoItem = getField(it, ["type", "tipo", "Tipo", "TipoImovel", "tipoImovel", "Categoria", "categoria"]) ?? titulo;
      const dorm     = parseIntSafe(getField(it, ["bedrooms", "Dormitorios", "Dormitórios", "dormitorios", "Quartos", "quartos"]));

      if (criteria.neighborhood && anyIncludes([bairro, titulo], criteria.neighborhood)) score += 5;
      if (criteria.city && anyIncludes([cidade, titulo], criteria.city)) score += 3;
      if (criteria.state && estado && normEq(estado, criteria.state)) score += 2;
      if (criteria.typeHint && typeMatches(String(tipoItem || ""), criteria.typeHint)) score += 2;
      if (criteria.bedrooms !== undefined && dorm !== undefined && dorm === criteria.bedrooms) score += 2;

      // bônus leves
      if (parseIntSafe(getField(it, ["Vagas", "vagas", "parking", "garagens"])) || getField(it, ["Vaga", "vaga"])) score += 0.4;
      const area = parseIntSafe(getField(it, ["AreaPrivativa", "area", "Área", "Area", "M2", "m2"]));
      if (area && area >= 55) score += 0.4;

      return { it, score };
    })
    .sort((a, b) => b.score - a.score)
    .map(x => x.it);

  return ranked;
}

export function paginateRanked(list: any[], page: number, pageSize: number) {
  const p = Math.max(1, page|0);
  const s = Math.max(1, pageSize|0);
  const start = (p - 1) * s;
  return list.slice(start, start + s);
}
