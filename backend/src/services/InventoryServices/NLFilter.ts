// backend/src/services/InventoryServices/NLFilter.ts
// Motor semântico multi-domínio: interpreta o texto, aplica HARD-FILTER abrangente e ranqueia.

export type Criteria = {
  // Geo
  neighborhood?: string; // "Campinas"
  city?: string;         // "São José"
  state?: string;        // "SC"

  // Imóveis
  bedrooms?: number;     // 2, 3...
  typeHint?: string;     // "apartamento", "casa", "studio"...
  areaMin?: number;
  areaMax?: number;

  // Preço genérico (serve pra qualquer domínio)
  priceMin?: number;
  priceMax?: number;

  // Veículos
  brand?: string;        // "Toyota"
  model?: string;        // "Corolla"
  yearMin?: number;
  yearMax?: number;
  transmission?: string; // "automático", "manual"
  fuel?: string;         // "flex", "gasolina", "diesel"
  kmMax?: number;

  // Saúde / Clínicas
  specialty?: string;    // "dentista", "dermato"
  insurance?: string;    // "unimed", "amil"
  date?: string;         // "2025-12-20"
  timeWindow?: string;   // "manhã", "tarde", "noite"

  // Beleza / Pet / Serviços
  service?: string;      // "corte de cabelo", "barba", "banho", "tosa", "manicure"
  professional?: string; // "joão", "maria"

  // Educação
  modality?: string;     // "online", "presencial"
  course?: string;       // "inglês", "excel", "pilates", "crossfit"
  schedule?: string;     // "noite", "manhã"

  // Eventos / Espaços
  capacityMin?: number;

  // Texto bruto (para depuração)
  raw?: string;
};

const numberWordsPt: Record<string, number> = {
  "um": 1, "uma": 1, "dois": 2, "duas": 2, "tres": 3, "três": 3, "quatro": 4,
  "cinco": 5, "seis": 6, "sete": 7, "oito": 8, "nove": 9, "dez": 10
};

function normalize(s?: string) {
  return (s || "")
    .normalize("NFD").replace(/\p{Diacritic}/gu, "")
    .toLowerCase().trim();
}
function normEq(a?: string, b?: string) { return !!a && !!b && normalize(a) === normalize(b); }
function normIncludes(hay?: string, needle?: string) { return !needle || (!!hay && normalize(hay).includes(normalize(needle))); }
function anyIncludes(hayList: Array<string | undefined>, needle?: string) { return !needle || hayList.some(h => normIncludes(h, needle)); }

function toNumber(v: any): number | undefined {
  if (v === null || v === undefined) return undefined;
  const s = String(v).replace(/[^\d.,\-]/g, "").replace(/\./g, "").replace(",", ".");
  const n = Number(s);
  return isNaN(n) ? undefined : n;
}
function parseIntSafe(v: any): number | undefined {
  if (v === null || v === undefined) return undefined;
  const n = parseInt(String(v).replace(/\D+/g, ""), 10);
  return isNaN(n) ? undefined : n;
}

// Accessor com paths simples "a.b.c" também
function getField(obj: any, aliases: string[]) {
  for (const path of aliases) {
    let cur: any = obj;
    const parts = path.split(".");
    for (const p of parts) {
      if (cur && Object.prototype.hasOwnProperty.call(cur, p)) cur = cur[p];
      else { cur = undefined; break; }
    }
    if (cur !== undefined) return cur;
  }
  return undefined;
}

// Mapas de sinônimos de tipo (imóveis) e transmissão/combustível (carros)
const TYPE_MAP: Record<string, string[]> = {
  "apartamento": ["apartamento", "apto", "ap.", "ap", "flat"],
  "casa": ["casa", "sobrado", "residencia"],
  "studio": ["studio", "stúdio", "kitnet", "kitinete", "loft"],
  "terreno": ["terreno", "lote", "loteamento"]
};
const TRANSMISSION_MAP = {
  "automatico": ["automatico", "automático", "auto"],
  "manual": ["manual"]
};
const FUEL_MAP = {
  "flex": ["flex", "etanol", "álcool"],
  "gasolina": ["gasolina"],
  "diesel": ["diesel"],
  "eletrico": ["eletrico", "elétrico", "ev", "hibrido", "híbrido"]
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

// ======== PARSER DE TEXTO MULTI-DOMÍNIO ========
export function parseCriteriaFromText(text: string): Criteria {
  const t = normalize(text);
  const crit: Criteria = { raw: t };

  // Geo
  let m = t.match(/bairro\s+([a-z0-9\s\-]+)/);
  if (m?.[1]) crit.neighborhood = m[1].trim().replace(/\s+sc\b$/, "").trim();
  if (!crit.neighborhood) {
    const mb = t.match(/\bem\s+([a-z0-9\s\-]+)\b/);
    if (mb?.[1] && !/\b(sao jose|são jose|florianopolis|florianopolis|palhoca|palhoça|biguaçu|biguacu|curitiba|sao paulo|são paulo|rio de janeiro)\b/.test(mb[1])) {
      crit.neighborhood = mb[1].trim();
    }
  }
  const cityState = t.match(/\b(sao jose|são jose|florianopolis|florianópolis|palhoca|palhoça|biguaçu|biguacu|curitiba|sao paulo|são paulo|rio de janeiro)\s*\/\s*([a-z]{2})\b/);
  if (cityState) { crit.city = cityState[1].replace("sao", "são"); crit.state = cityState[2].toUpperCase(); }
  else {
    const cityOnly = t.match(/\bem\s+(sao jose|são jose|florianopolis|florianópolis|palhoca|palhoça|biguaçu|biguacu|curitiba|sao paulo|são paulo|rio de janeiro)\b/);
    if (cityOnly) crit.city = cityOnly[1].replace("sao", "são");
    const st = t.match(/\b(sc|rs|pr|sp|rj|mg|ba|df|go|es|pe|ce|pa|am|mt|ms|rn|pb|al|se|ma|pi|ro|rr|ap|to|ac)\b/);
    if (st) crit.state = st[1].toUpperCase();
  }

  // Imóveis
  let q = t.match(/(\d+)\s*(quartos?|dormitorios?)/);
  if (q?.[1]) crit.bedrooms = parseInt(q[1], 10);
  if (!crit.bedrooms) {
    const mq = t.match(/\b(um|uma|dois|duas|tres|três|quatro|cinco|seis|sete|oito|nove|dez)\s*(quartos?|dormitorios?)\b/);
    if (mq?.[1]) crit.bedrooms = numberWordsPt[mq[1]];
  }
  const types = ["apartamento", "casa", "kitnet", "studio", "sobrado", "terreno"];
  for (const tp of types) if (t.includes(tp)) { crit.typeHint = tp; break; }

  const areaMin = t.match(/(area|área)\s*(minima|min)\s*(\d+\.?\d*)/);
  const areaMax = t.match(/(area|área)\s*(maxima|max)\s*(\d+\.?\d*)/);
  if (areaMin?.[3]) crit.areaMin = toNumber(areaMin[3]);
  if (areaMax?.[3]) crit.areaMax = toNumber(areaMax[3]);

  // Preços (até/entre)
  const priceMax1 = t.match(/\bat[eé]\s*(r?\$?\s*[\d\.\,]+(k|mil|milhoes|milhão)?)\b/);
  if (priceMax1?.[1]) crit.priceMax = normalizePrice(priceMax1[1]);
  const priceRange = t.match(/entre\s*(r?\$?\s*[\d\.\,]+(?:k|mil|milhoes|milhão)?)\s*e\s*(r?\$?\s*[\d\.\,]+(?:k|mil|milhoes|milhão)?)/);
  if (priceRange?.[1]) crit.priceMin = normalizePrice(priceRange[1]);
  if (priceRange?.[2]) crit.priceMax = normalizePrice(priceRange[2]);

  // Veículos
  const yearTo = t.match(/(ate|até)\s*(\d{4})\b/);
  const yearFrom = t.match(/(a partir de|de)\s*(\d{4})\b/);
  const yearExact = t.match(/\bano\s*(\d{4})\b/);
  if (yearTo?.[2]) crit.yearMax = parseInt(yearTo[2], 10);
  if (yearFrom?.[2]) crit.yearMin = parseInt(yearFrom[2], 10);
  if (yearExact?.[1]) { crit.yearMin = parseInt(yearExact[1], 10); crit.yearMax = parseInt(yearExact[1], 10); }

  const km = t.match(/(km|quilometragem)\s*(ate|até)?\s*([\d\.\,]+)/);
  if (km?.[3]) crit.kmMax = toNumber(km[3]);

  // marca e modelo simples (heurística): ex.: "toyota corolla", "honda civic"
  const brands = ["toyota","honda","chevrolet","vw","volkswagen","fiat","hyundai","renault","ford","jeep","nissan","peugeot","citroen","bmw","mercedes","audi"];
  for (const b of brands) {
    if (t.includes(b)) { crit.brand = b; break; }
  }
  // model: pega a palavra após a marca
  if (crit.brand) {
    const re = new RegExp(`${crit.brand}\\s+([a-z0-9\\-]+)`);
    const mm = t.match(re);
    if (mm?.[1]) crit.model = mm[1];
  }

  // transmissão
  if (t.includes("automatic")) crit.transmission = "automatico";
  else if (t.includes("automati")) crit.transmission = "automatico";
  else if (t.includes("manual")) crit.transmission = "manual";

  // combustível
  if (t.includes("flex")) crit.fuel = "flex";
  else if (t.includes("gasolina")) crit.fuel = "gasolina";
  else if (t.includes("diesel")) crit.fuel = "diesel";
  else if (t.includes("eletric") || t.includes("hibrid")) crit.fuel = "eletrico";

  // Saúde
  const specialties = ["dentista","dermato","dermatologia","cardiologia","oftalmo","psicologo","psiquiatra","ortopedista","gineco","pediatra","fisioterapia","nutricionista","fono"];
  for (const s of specialties) if (t.includes(s)) { crit.specialty = s; break; }
  const conv = t.match(/\b(amil|unimed|bradesco|hapvida|prevent|sulamerica|sulamerica)\b/);
  if (conv?.[1]) crit.insurance = conv[1];
  if (t.includes("manha")) crit.timeWindow = "manha";
  else if (t.includes("tarde")) crit.timeWindow = "tarde";
  else if (t.includes("noite")) crit.timeWindow = "noite";
  const dateIso = t.match(/\b(20\d{2})-(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])\b/);
  if (dateIso) crit.date = dateIso[0];

  // Beleza / Pet / Serviços
  const services = ["corte","corte de cabelo","barba","sobrancelha","progressiva","manicure","pedicure","banho","tosa","consulta","vacina","banho e tosa"];
  for (const s of services) if (t.includes(s)) { crit.service = s; break; }
  const prof = t.match(/\bcom\s+([a-z]{2,})\b/);
  if (prof?.[1]) crit.professional = prof[1];

  // Educação / Academias
  const modalities = ["online","presencial","hibrido","híbrido"];
  for (const mmm of modalities) if (t.includes(mmm)) { crit.modality = mmm.replace("híbrido", "hibrido"); break; }
  const courses = ["ingles","espanhol","excel","programacao","yoga","pilates","crossfit","musculacao"];
  for (const c of courses) if (t.includes(c)) { crit.course = c; break; }
  const schedules = ["manha","tarde","noite","full time"];
  for (const s of schedules) if (t.includes(s)) { crit.schedule = s; break; }

  // Eventos
  const cap = t.match(/\b(para|ate|até)\s*(\d+)\s*(pessoas|convidados|lugares)\b/);
  if (cap?.[2]) crit.capacityMin = parseInt(cap[2], 10);

  return crit;
}

function normalizePrice(s: string): number | undefined {
  let str = normalize(s).replace(/[^\d,\.k\- ]/g, "").trim();
  let mult = 1;
  if (str.includes("milhao") || str.includes("milhoes")) mult = 1_000_000;
  else if (/\b(k|mil)\b/.test(str)) mult = 1_000;
  const n = toNumber(str);
  return n !== undefined ? Math.round(n * mult) : undefined;
}

// Concatena campos para busca textual abrangente
function makeSearchBlob(it: any) {
  const bits: string[] = [];
  const push = (v: any) => { if (v !== null && v !== undefined) bits.push(String(v)); };

  // Comuns
  push(getField(it, ["title","TituloSite","Titulo","nome"]));
  push(getField(it, ["description","Descricao","Descrição","resumo"]));
  push(getField(it, ["category","Categoria","tipo","Tipo","TipoImovel","tipoImovel"]));
  push(getField(it, ["slug","url","link"]));
  push(getField(it, ["address","endereco.logradouro","endereco.complemento"]));

  // Localização
  push(getField(it, ["location.city","Cidade","cidade"]));
  push(getField(it, ["location.neighborhood","Bairro","bairro"]));
  push(getField(it, ["location.state","Estado","estado","UF"]));

  // Imóveis
  push(getField(it, ["Dormitorios","Dormitórios","dormitorios","Quartos","quartos"]));
  push(getField(it, ["AreaPrivativa","area","Área","Area","M2","m2"]));

  // Veículos
  push(getField(it, ["marca","brand"]));
  push(getField(it, ["modelo","model"]));
  push(getField(it, ["ano","year"]));
  push(getField(it, ["km","quilometragem"]));
  push(getField(it, ["cambio","transmissao","transmission"]));
  push(getField(it, ["combustivel","fuel"]));

  // Saúde / Serviços
  push(getField(it, ["especialidade","specialty"]));
  push(getField(it, ["convenio","insurance"]));
  push(getField(it, ["servico","serviço","service"]));
  push(getField(it, ["profissional","professional"]));
  push(getField(it, ["modalidade","modality"]));
  push(getField(it, ["curso","course"]));

  // Preço (genérico)
  push(getField(it, ["ValorVenda","Preco","Preço","price","valor","valor_total"]));

  return normalize(bits.join(" | "));
}

// ============== HARD-FILTER + RANKING ==============
export function filterAndRankItems(items: any[], criteria: Criteria): any[] {
  if (!Array.isArray(items) || !items.length) return [];

  const rankedBase = items.map((it) => {
    // Campos estruturados
    const bairro   = getField(it, ["location.neighborhood","neighborhood","Bairro","bairro"]);
    const cidade   = getField(it, ["location.city","city","Cidade","cidade"]);
    const estado   = getField(it, ["location.state","state","Estado","estado","UF"]);
    const titulo   = getField(it, ["TituloSite","Titulo","title"]);
    const descr    = getField(it, ["description","Descricao","Descrição"]);
    const categoria= getField(it, ["category","Categoria","tipo","Tipo","TipoImovel","tipoImovel"]);
    const priceRaw = getField(it, ["ValorVenda","Preco","Preço","price","valor","valor_total"]);
    const price    = toNumber(priceRaw);

    // Imóveis
    const dorm     = parseIntSafe(getField(it, ["bedrooms","Dormitorios","Dormitórios","dormitorios","Quartos","quartos"]));
    const area     = toNumber(getField(it, ["AreaPrivativa","area","Área","Area","M2","m2"]));
    const tipoItem = String(categoria ?? titulo ?? descr ?? "");

    // Veículos
    const brand    = getField(it, ["marca","brand"]);
    const model    = getField(it, ["modelo","model"]);
    const year     = parseIntSafe(getField(it, ["ano","year"]));
    const km       = toNumber(getField(it, ["km","quilometragem"]));
    const trans    = getField(it, ["cambio","transmissao","transmission"]);
    const fuel     = getField(it, ["combustivel","fuel"]);

    // Serviços
    const specialty= getField(it, ["especialidade","specialty"]);
    const insurance= getField(it, ["convenio","insurance"]);
    const service  = getField(it, ["servico","serviço","service"]);
    const professional = getField(it, ["profissional","professional"]);
    const modality = getField(it, ["modalidade","modality"]);
    const course   = getField(it, ["curso","course"]);

    const blob = makeSearchBlob(it);

    // ---------- HARD FILTER ABRANGENTE ----------
    // Geo
    if (criteria.city)        { const ok = normIncludes(cidade, criteria.city) || blob.includes(normalize(criteria.city)); if (!ok) return null; }
    if (criteria.neighborhood){ const ok = normIncludes(bairro, criteria.neighborhood) || blob.includes(normalize(criteria.neighborhood)); if (!ok) return null; }
    if (criteria.state && estado && !normEq(estado, criteria.state)) return null;

    // Imóveis
    if (criteria.bedrooms !== undefined && dorm !== undefined && dorm !== criteria.bedrooms) return null;
    if (criteria.typeHint && !(typeMatches(tipoItem, criteria.typeHint) || blob.includes(normalize(criteria.typeHint)))) return null;
    if (criteria.areaMin !== undefined && area !== undefined && area < criteria.areaMin) return null;
    if (criteria.areaMax !== undefined && area !== undefined && area > criteria.areaMax) return null;

    // Preço (genérico)
    if (criteria.priceMin !== undefined && price !== undefined && price < criteria.priceMin) return null;
    if (criteria.priceMax !== undefined && price !== undefined && price > criteria.priceMax) return null;

    // Veículos
    if (criteria.brand && !(normIncludes(brand, criteria.brand) || blob.includes(normalize(criteria.brand)))) return null;
    if (criteria.model && !(normIncludes(model, criteria.model) || blob.includes(normalize(criteria.model)))) return null;
    if (criteria.yearMin !== undefined && year !== undefined && year < criteria.yearMin) return null;
    if (criteria.yearMax !== undefined && year !== undefined && year > criteria.yearMax) return null;
    if (criteria.kmMax !== undefined && km !== undefined && km > criteria.kmMax) return null;
    if (criteria.transmission && !matchesAlias(criteria.transmission, trans, TRANSMISSION_MAP)) return null;
    if (criteria.fuel && !matchesAlias(criteria.fuel, fuel, FUEL_MAP)) return null;

    // Saúde / Serviços
    if (criteria.specialty && !(normIncludes(specialty, criteria.specialty) || blob.includes(normalize(criteria.specialty)))) return null;
    if (criteria.insurance && !(normIncludes(insurance, criteria.insurance) || blob.includes(normalize(criteria.insurance)))) return null;
    if (criteria.service && !(normIncludes(service, criteria.service) || blob.includes(normalize(criteria.service)))) return null;
    if (criteria.professional && !(normIncludes(professional, criteria.professional) || blob.includes(normalize(criteria.professional)))) return null;

    // Educação / Academias
    if (criteria.modality && !(normIncludes(modality, criteria.modality) || blob.includes(normalize(criteria.modality)))) return null;
    if (criteria.course && !(normIncludes(course, criteria.course) || blob.includes(normalize(criteria.course)))) return null;

    // ---------- RANKING SUAVE ----------
    let score = 0;

    // Geo
    if (criteria.neighborhood && (anyIncludes([bairro, titulo], criteria.neighborhood) || blob.includes(normalize(criteria.neighborhood)))) score += 5;
    if (criteria.city && (anyIncludes([cidade, titulo], criteria.city) || blob.includes(normalize(criteria.city)))) score += 3;
    if (criteria.state && estado && normEq(estado, criteria.state)) score += 1;

    // Imóveis
    if (criteria.typeHint && (typeMatches(tipoItem, criteria.typeHint) || blob.includes(normalize(criteria.typeHint)))) score += 2;
    if (criteria.bedrooms !== undefined && dorm !== undefined && dorm === criteria.bedrooms) score += 2;
    if (area && criteria.areaMin && area >= criteria.areaMin) score += 0.3;

    // Preço
    if (price && criteria.priceMax && price <= criteria.priceMax) score += 0.6;

    // Veículos
    if (criteria.brand && normIncludes(brand, criteria.brand)) score += 1.5;
    if (criteria.model && normIncludes(model, criteria.model)) score += 1.0;
    if (criteria.yearMin && year && year >= criteria.yearMin) score += 0.5;
    if (criteria.yearMax && year && year <= criteria.yearMax) score += 0.5;
    if (criteria.kmMax && km && km <= criteria.kmMax) score += 0.7;

    // Serviços
    if (criteria.specialty && normIncludes(specialty, criteria.specialty)) score += 1.2;
    if (criteria.insurance && normIncludes(insurance, criteria.insurance)) score += 0.8;
    if (criteria.service && normIncludes(service, criteria.service)) score += 1.2;
    if (criteria.professional && normIncludes(professional, criteria.professional)) score += 0.6;

    // Educação / Academias
    if (criteria.modality && normIncludes(modality, criteria.modality)) score += 0.8;
    if (criteria.course && normIncludes(course, criteria.course)) score += 0.8;

    return { it, score };
  }).filter(Boolean) as Array<{ it: any; score: number }>;

  // fallback: se o hard-filter removeu tudo, devolve ranking neutro
  const arr = rankedBase.length ? rankedBase : items.map(it => ({ it, score: 0 }));
  return arr.sort((a, b) => b.score - a.score).map(x => x.it);
}

export function paginateRanked(list: any[], page: number, pageSize: number) {
  const p = Math.max(1, page|0);
  const s = Math.max(1, pageSize|0);
  const start = (p - 1) * s;
  return list.slice(start, start + s);
}
