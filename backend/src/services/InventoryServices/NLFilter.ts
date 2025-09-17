// backend/src/services/InventoryServices/NLFilter.ts
// Pós-filtro local: interpreta o texto do usuário e filtra/ranqueia os itens do provider.

export type Criteria = {
  bedrooms?: number;       // 2, 3...
  neighborhood?: string;   // "Campinas"
  city?: string;           // "São José"
  state?: string;          // "SC"
  // priceMax?: number;    // opcional (deixar para depois)
  typeHint?: string;       // "apartamento", "casa", "studio"...
};

const numberWordsPt: Record<string, number> = {
  "um": 1, "uma": 1, "dois": 2, "duas": 2, "três": 3, "tres": 3, "quatro": 4,
  "cinco": 5, "seis": 6, "sete": 7, "oito": 8, "nove": 9, "dez": 10
};

function normalize(s?: string) {
  return (s || "")
    .normalize("NFD").replace(/[\u0300-\u036f]/g, "")
    .toLowerCase().trim();
}

export function parseCriteriaFromText(text: string): Criteria {
  const t = normalize(text);

  const crit: Criteria = {};

  // bedrooms (quartos/dormitórios)
  // ex.: "2 quartos", "02 dormitórios", "dois quartos"
  let m = t.match(/(\d+)\s*(quartos?|dormitorios?)/);
  if (m && m[1]) crit.bedrooms = parseInt(m[1], 10);
  if (!crit.bedrooms) {
    const mw = t.match(/\b(um|uma|dois|duas|tres|três|quatro|cinco|seis|sete|oito|nove|dez)\s*(quartos?|dormitorios?)\b/);
    if (mw && mw[1]) crit.bedrooms = numberWordsPt[mw[1]];
  }

  // neighborhood (bairro X)
  m = t.match(/bairro\s+([a-z0-9\s\-]+)/);
  if (m && m[1]) {
    crit.neighborhood = m[1].trim().replace(/\s+sc\b$/, "").trim();
  } else {
    // "em campinas" pode ser bairro
    const mb = t.match(/\bem\s+([a-z0-9\s\-]+)\b/);
    if (mb && mb[1] && !mb[1].includes("sao jose") && !mb[1].includes("florianopolis")) {
      crit.neighborhood = mb[1].trim();
    }
  }

  // city / state (São José/SC, Sao Jose/SC, "em São José")
  const cityState = t.match(/\b(sao jose|são jose|florianopolis|florianópolis)\s*\/\s*([a-z]{2})\b/);
  if (cityState) {
    crit.city = cityState[1].replace("sao", "são");
    crit.state = cityState[2].toUpperCase();
  } else {
    const cityOnly = t.match(/\bem\s+(sao jose|são jose|florianopolis|florianópolis)\b/);
    if (cityOnly) crit.city = cityOnly[1].replace("sao", "são");
    const st = t.match(/\b([a-z]{2})\b/);
    if (st && ["sc","rs","pr","sp","rj","mg","ba","df","go","es","pe","ce","pa","am","mt","ms","rn","pb","al","se","ma","pi","ro","rr","ap","to","ac"].includes(st[1])) {
      crit.state = st[1].toUpperCase();
    }
  }

  // type hint (apartamento, casa, studio, kitnet...)
  const types = ["apartamento", "casa", "kitnet", "studio", "sobrado", "terreno"];
  for (const tp of types) {
    if (t.includes(tp)) { crit.typeHint = tp; break; }
  }

  return crit;
}

// tenta ler um campo com vários aliases possíveis
function getField(obj: any, aliases: string[]) {
  for (const k of aliases) {
    if (obj && Object.prototype.hasOwnProperty.call(obj, k)) return obj[k];
  }
  return undefined;
}

function parseIntSafe(v: any): number | undefined {
  if (v === null || v === undefined) return undefined;
  const n = parseInt(String(v).replace(/\D+/g, ""), 10);
  return isNaN(n) ? undefined : n;
}

function containsLike(value: any, needle: string) {
  if (!needle) return true;
  if (value === undefined || value === null) return false;
  const a = normalize(String(value));
  const b = normalize(needle);
  return a.includes(b);
}

export function filterAndRankItems(items: any[], criteria: Criteria): any[] {
  if (!Array.isArray(items) || !items.length) return [];

  return items
    .map((it) => {
      let score = 0;

      // Bedrooms / Dormitórios
      const dormRaw = getField(it, ["Dormitorios", "Dormitórios", "dormitorios", "Quartos", "quartos"]);
      const dorm = parseIntSafe(dormRaw);
      if (criteria.bedrooms !== undefined) {
        if (dorm !== undefined && dorm === criteria.bedrooms) score += 4;
        else if (dorm !== undefined && Math.abs(dorm - criteria.bedrooms) === 1) score += 2; // tolerância
        else score -= 1;
      }

      // Bairro / Cidade / Estado
      const bairro = getField(it, ["Bairro", "bairro"]);
      const cidade = getField(it, ["Cidade", "cidade"]);
      const estado = getField(it, ["Estado", "estado", "UF"]);

      if (criteria.neighborhood) {
        if (containsLike(bairro, criteria.neighborhood)) score += 4; else score -= 1;
      }
      if (criteria.city) {
        if (containsLike(cidade, criteria.city)) score += 3; else score -= 1;
      }
      if (criteria.state) {
        if (containsLike(estado, criteria.state)) score += 2; else score -= 1;
      }

      // Type hint por título/categoria
      const titulo = getField(it, ["TituloSite", "Titulo", "title", "Descricao", "Descrição", "Categoria", "categoria"]);
      if (criteria.typeHint) {
        if (containsLike(titulo, criteria.typeHint)) score += 2;
      }

      // Preço (opcional — deixado neutro por enquanto)
      // const preco = parseIntSafe(getField(it, ["ValorVenda", "Preco", "Preço", "price"]));
      // if (criteria.priceMax !== undefined && preco !== undefined) {
      //   if (preco <= criteria.priceMax) score += 2; else score -= 2;
      // }

      return { it, score };
    })
    .sort((a, b) => b.score - a.score)
    .filter(x => x.score > -999) // não mata tudo mesmo sem critério
    .map(x => x.it);
}

export function paginateRanked(list: any[], page: number, pageSize: number) {
  const p = Math.max(1, page|0);
  const s = Math.max(1, pageSize|0);
  const start = (p - 1) * s;
  return list.slice(start, start + s);
}
