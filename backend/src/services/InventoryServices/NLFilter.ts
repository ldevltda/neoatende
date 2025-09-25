// Motor semântico multi-domínio: interpreta o texto, aplica HARD-FILTER abrangente e ranqueia.

export type Criteria = {
  // Geo
  neighborhood?: string;
  city?: string;
  state?: string;

  // Imóveis (novos: ranges e mínimos)
  bedrooms?: number;         // valor exato (ex.: “2 quartos”)
  minBedrooms?: number;
  maxBedrooms?: number;

  typeHint?: string;         // "apartamento", "casa", ...
  areaMin?: number;          // legado
  areaMax?: number;          // legado
  minArea?: number;          // novo (espelho de areaMin)
  maxArea?: number;          // novo (espelho de areaMax)

  hasGarage?: boolean;
  minVagas?: number;         // novo
  maxVagas?: number;         // novo

  // Preço
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

  // Saúde
  specialty?: string;
  insurance?: string;
  date?: string;
  timeWindow?: string;

  // Serviços
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
  "um": 1, "uma": 1, "dois": 2, "duas": 2, "tres": 3, "três": 3,
  "quatro": 4, "cinco": 5, "seis": 6, "sete": 7, "oito": 8, "nove": 9, "dez": 10
};

function normalize(s?: string) {
  return (s || "")
    .normalize("NFD").replace(/\p{Diacritic}/gu, "")
    .toLowerCase().trim();
}
const norm = normalize;

function normEq(a?: string, b?: string) {
  return !!a && !!b && norm(a) === norm(b);
}
function normIncludes(hay?: string, needle?: string) {
  return !needle || (!!hay && norm(hay).includes(norm(needle)));
}
function anyIncludes(hayList: Array<string | undefined>, needle?: string) {
  return !needle || hayList.some(h => normIncludes(h, needle));
}

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

/** Accessor tolerante */
function getField(obj: any, aliases: string[]) {
  for (const path of aliases) {
    let cur: any = obj;
    const parts = path.split(".");
    let ok = true;
    for (const rawKey of parts) {
      if (cur == null) { ok = false; break; }
      if (Object.prototype.hasOwnProperty.call(cur, rawKey)) {
        cur = cur[rawKey]; continue;
      }
      const target = norm(rawKey);
      const foundKey = Object.keys(cur).find(k => norm(k) === target);
      if (foundKey !== undefined) cur = cur[foundKey];
      else { ok = false; break; }
    }
    if (ok && cur !== undefined) return cur;
  }
  return undefined;
}

// Sinônimos
const TYPE_MAP: Record<string, string[]> = {
  "apartamento": ["apartamento", "apto", "ap.", "ap", "flat"],
  "casa": ["casa", "sobrado", "residencia", "residência"],
  "studio": ["studio", "stúdio", "kitnet", "kitinete", "loft"],
  "terreno": ["terreno", "lote", "loteamento"]
};
const TRANSMISSION_MAP: Record<string, string[]> = {
  "automatico": ["automatico", "automático", "auto"],
  "manual": ["manual"]
};
const FUEL_MAP: Record<string, string[]> = {
  "flex": ["flex", "etanol", "álcool"],
  "gasolina": ["gasolina"],
  "diesel": ["diesel"],
  "eletrico": ["eletrico", "elétrico", "ev", "hibrido", "híbrido"]
};

function matchesAlias(hint?: string, value?: string, map?: Record<string, string[]>) {
  if (!hint) return true;
  if (!value) return false;
  const src = norm(value);
  const wanted = map?.[norm(hint)];
  if (!wanted) return src.includes(norm(hint));
  return wanted.some(w => src.includes(norm(w)));
}
function typeMatches(itemType?: string, hint?: string) {
  if (!hint) return true;
  return matchesAlias(hint, itemType, TYPE_MAP);
}

// Geo
const CITY_KNOWN = [
  "são josé","sao jose","são josé","florianopolis","florianópolis",
  "palhoca","palhoça","biguaçu","biguacu","curitiba","sao paulo","são paulo","rio de janeiro"
];
const NEIGHBORHOOD_TO_CITY: Record<string, { city: string; state?: string }> = {
  "campinas": { city: "são josé", state: "SC" },
  "kobrasol": { city: "são josé", state: "SC" },
  "barreiros": { city: "são josé", state: "SC" },
  "forquilhas": { city: "são josé", state: "SC" },
  "forquilhinhas": { city: "são josé", state: "SC" },
  "santa luzia": { city: "são josé", state: "SC" },
  "trindade": { city: "florianópolis", state: "SC" },
  "centro": { city: "florianópolis", state: "SC" },
  "pagani": { city: "palhoça", state: "SC" },
  "pedra branca": { city: "palhoça", state: "SC" }
};
function cleanNeighborhood(s: string) {
  return norm(s).replace(/^bairro\s+de\s+/, "")
                .replace(/^bairro\s+/, "")
                .replace(/^no\s+bairro\s+/, "")
                .trim();
}

// ======== PARSER ========
export function parseCriteriaFromText(text: string): Criteria {
  const t = norm(text);
  const crit: Criteria = { raw: t };

  // --- Geo
  let mB = t.match(/\bbairro\s+(de\s+)?([a-z0-9\s\-]+)/);
  if (mB?.[2]) crit.neighborhood = cleanNeighborhood(mB[2]);

  let mNbCity = t.match(/\b([a-z0-9\s\-]+),\s*(sao jose|são jose|sao josé|são josé)\s*\/\s*([a-z]{2})\b/);
  if (mNbCity) {
    crit.neighborhood = cleanNeighborhood(mNbCity[1]);
    crit.city = "são josé";
    crit.state = mNbCity[3].toUpperCase();
  } else {
    let mEmNbCity = t.match(/\bem\s+([a-z0-9\s\-]+),\s*(sao jose|são jose|sao josé|são josé)\s*\/\s*([a-z]{2})\b/);
    if (mEmNbCity) {
      crit.neighborhood = cleanNeighborhood(mEmNbCity[1]);
      crit.city = "são josé";
      crit.state = mEmNbCity[3].toUpperCase();
    }
  }

  const cityState = t.match(/\b(sao jose|são jose|sao josé|são josé|florianopolis|florianópolis|palhoca|palhoça|biguaçu|biguacu|curitiba|sao paulo|são paulo|rio de janeiro)\s*\/\s*([a-z]{2})\b/);
  if (cityState) {
    crit.city = cityState[1].replace("sao", "são");
    crit.state = cityState[2].toUpperCase();
  } else {
    const cityOnly = t.match(/\bem\s+([a-z0-9\s\-]+)\b/);
    if (cityOnly?.[1]) {
      const candidate = cityOnly[1].trim();
      if (CITY_KNOWN.includes(candidate)) crit.city = candidate.replace("sao", "são");
      else if (!crit.neighborhood) crit.neighborhood = cleanNeighborhood(candidate);
    }
    const st = t.match(/\b(sc|rs|pr|sp|rj|mg|ba|df|go|es|pe|ce|pa|am|mt|ms|rn|pb|al|se|ma|pi|ro|rr|ap|to|ac)\b/);
    if (st) crit.state = st[1].toUpperCase();
  }

  if (!crit.city && crit.neighborhood) {
    const mapped = NEIGHBORHOOD_TO_CITY[cleanNeighborhood(crit.neighborhood)];
    if (mapped) { crit.city = mapped.city; if (!crit.state && mapped.state) crit.state = mapped.state; }
  }

  // --- Imóveis
  // Quartos: “2 quartos | 2 qtos | 2 q | 2 dorms | entre 2 e 3 quartos”
  const qRange = t.match(/\b(de|entre)\s*(\d+)\s*(a|e)\s*(\d+)\s*(quartos?|q(?:tos?)?|dorms?|dormitorios?)\b/);
  if (qRange) {
    crit.minBedrooms = parseInt(qRange[2], 10);
    crit.maxBedrooms = parseInt(qRange[4], 10);
  } else {
    const q = t.match(/\b(\d+)\s*(quartos?|q(?:tos?)?|dorms?|dormitorios?)\b/);
    if (q?.[1]) crit.bedrooms = parseInt(q[1], 10);
    if (!crit.bedrooms) {
      const mq = t.match(/\b(um|uma|dois|duas|tres|três|quatro|cinco|seis|sete|oito|nove|dez)\s*(quartos?|dormitorios?)\b/);
      if (mq?.[1]) crit.bedrooms = numberWordsPt[mq[1]];
    }
  }

  // Tipo
  for (const [type, synonyms] of Object.entries(TYPE_MAP)) {
    if (synonyms.some(s => t.includes(norm(s)))) { crit.typeHint = type; break; }
  }

  // Vagas/garagem: “2 vagas”, “até 2 vagas”, “a partir de 2 vagas”… ou apenas “com garagem”
  if (/\b(sem\s+garagem|sem\s+vaga)\b/.test(t)) crit.hasGarage = false;
  const vagasMin = t.match(/\b(a partir de|de|mín(?:imo)?)\s*(\d+)\s*vagas?\b/);
  const vagasMax = t.match(/\b(at[eé]|até)\s*(\d+)\s*vagas?\b/);
  const vagasEx = t.match(/\b(\d+)\s*vagas?\b/);
  if (vagasMin?.[2]) crit.minVagas = parseInt(vagasMin[2], 10);
  if (vagasMax?.[2]) crit.maxVagas = parseInt(vagasMax[2], 10);
  if (!crit.minVagas && vagasEx?.[1]) crit.minVagas = parseInt(vagasEx[1], 10);
  if (/\b(com|com\s+vaga[s]?|vaga|vagas|garagem)\b/.test(t)) crit.hasGarage = true;

  // Área: mín/máx/intervalo e símbolos
  const areaMin1 = t.match(/\b(area|área)\s*(minima|min|mín(?:imo)?)\s*(\d+[\d,\.]*)\s*(m2|m²)?\b/);
  const areaMax1 = t.match(/\b(area|área)\s*(maxima|max|máx(?:imo)?)\s*(\d+[\d,\.]*)\s*(m2|m²)?\b/);
  const areaGE = t.match(/\b(a partir de|de|>=|≥)\s*(\d+[\d,\.]*)\s*(m2|m²)?\b/);
  const areaLE = t.match(/\b(at[eé]|até|<=|≤)\s*(\d+[\d,\.]*)\s*(m2|m²)?\b/);
  const areaRange = t.match(/\bentre\s*(\d+[\d,\.]*)\s*(m2|m²)?\s*e\s*(\d+[\d,\.]*)\s*(m2|m²)?\b/);
  if (areaMin1?.[3]) crit.minArea = toNumber(areaMin1[3]);
  if (areaMax1?.[3]) crit.maxArea = toNumber(areaMax1[3]);
  if (areaGE?.[2]) crit.minArea = toNumber(areaGE[2]) ?? crit.minArea;
  if (areaLE?.[2]) crit.maxArea = toNumber(areaLE[2]) ?? crit.maxArea;
  if (areaRange) { crit.minArea = toNumber(areaRange[1]); crit.maxArea = toNumber(areaRange[3]); }
  // manter compat com areaMin/areaMax
  if (crit.areaMin === undefined && crit.minArea !== undefined) crit.areaMin = crit.minArea;
  if (crit.areaMax === undefined && crit.maxArea !== undefined) crit.areaMax = crit.maxArea;

  // --- Preços
  const priceMax1 = t.match(/\bat[eé]\s*(r?\$?\s*[\d\.\,]+(?:\s*(k|mil|milhoes|milhão))?)\b/);
  const priceMin1 = t.match(/\b(a partir de|de|mín(?:imo)?)\s*(r?\$?\s*[\d\.\,]+(?:\s*(k|mil|milhoes|milhão))?)\b/);
  const priceRange = t.match(/\bentre\s*(r?\$?\s*[\d\.\,]+(?:\s*(k|mil|milhoes|milhão))?)\s*e\s*(r?\$?\s*[\d\.\,]+(?:\s*(k|mil|milhoes|milhão))?)/);
  if (priceMin1?.[2]) crit.priceMin = normalizePrice(priceMin1[2]);
  if (priceMax1?.[1]) crit.priceMax = normalizePrice(priceMax1[1]);
  if (priceRange?.[1]) crit.priceMin = normalizePrice(priceRange[1]);
  if (priceRange?.[2]) crit.priceMax = normalizePrice(priceRange[2]);

  // --- Veículos (igual ao anterior)
  const yearTo = t.match(/\b(ate|até)\s*(\d{4})\b/);
  const yearFrom = t.match(/\b(a partir de|de)\s*(\d{4})\b/);
  const yearExact = t.match(/\bano\s*(\d{4})\b/);
  if (yearTo?.[2]) crit.yearMax = parseInt(yearTo[2], 10);
  if (yearFrom?.[2]) crit.yearMin = parseInt(yearFrom[2], 10);
  if (yearExact?.[1]) { crit.yearMin = parseInt(yearExact[1], 10); crit.yearMax = parseInt(yearExact[1], 10); }

  const km = t.match(/\b(km|quilometragem)\s*(ate|até)?\s*([\d\.\,]+)\b/);
  if (km?.[3]) crit.kmMax = toNumber(km[3]);

  const brands = ["toyota","honda","chevrolet","vw","volkswagen","fiat","hyundai","renault","ford","jeep","nissan","peugeot","citroen","bmw","mercedes","audi"];
  for (const b of brands) { if (t.includes(b)) { crit.brand = b; break; } }
  if (crit.brand) {
    const re = new RegExp(`${crit.brand}\\s+([a-z0-9\\-]+)`);
    const mm = t.match(re);
    if (mm?.[1]) crit.model = mm[1];
  }

  if (t.includes("automatic")) crit.transmission = "automatico";
  else if (t.includes("automati")) crit.transmission = "automatico";
  else if (t.includes("manual")) crit.transmission = "manual";

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

  // Serviços
  const services = ["corte","corte de cabelo","barba","sobrancelha","progressiva","manicure","pedicure","banho","tosa","consulta","vacina","banho e tosa"];
  for (const s of services) if (t.includes(s)) { crit.service = s; break; }
  const prof = t.match(/\bcom\s+([a-z]{2,})\b/);
  if (prof?.[1]) crit.professional = prof[1];

  // Educação
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
  let str = norm(s).replace(/[^\d,\.k\- ]/g, "").trim();
  let mult = 1;
  if (str.includes("milhao") || str.includes("milhoes")) mult = 1_000_000;
  else if (/\b(k|mil)\b/.test(str)) mult = 1_000;
  const n = toNumber(str);
  return n !== undefined ? Math.round(n * mult) : undefined;
}
function parsePriceStrict(s?: string | number) {
  if (s === null || s === undefined) return undefined;
  const n = Number(String(s).replace(/[^\d]/g, ""));
  return isNaN(n) ? undefined : n;
}

// Busca textual
function makeSearchBlob(it: any) {
  const bits: string[] = [];
  const push = (v: any) => { if (v !== null && v !== undefined) bits.push(String(v)); };

  push(getField(it, ["title","TituloSite","Titulo","nome"]));
  push(getField(it, ["description","Descricao","Descrição","resumo"]));
  push(getField(it, ["category","Categoria","tipo","Tipo","TipoImovel","tipoImovel"]));
  push(getField(it, ["slug","url","link"]));
  push(getField(it, ["address","endereco.logradouro","endereco.complemento"]));

  push(getField(it, ["location.city","Cidade","cidade","city"]));
  push(getField(it, ["location.neighborhood","Bairro","bairro","neighborhood"]));
  push(getField(it, ["location.state","Estado","estado","UF","uf","state"]));

  push(getField(it, ["Dormitorios","Dormitórios","dormitorios","dormitórios","Quartos","quartos","bedrooms"]));
  push(getField(it, ["AreaPrivativa","area","Área","Area","M2","m2","squareMeters"]));
  push(getField(it, ["Vagas","VagasGaragem","vagas","garagens"]));

  push(getField(it, ["marca","brand"]));
  push(getField(it, ["modelo","model"]));
  push(getField(it, ["ano","year"]));
  push(getField(it, ["km","quilometragem"]));
  push(getField(it, ["cambio","transmissao","transmission"]));
  push(getField(it, ["combustivel","fuel"]));

  push(getField(it, ["especialidade","specialty"]));
  push(getField(it, ["convenio","insurance"]));
  push(getField(it, ["servico","serviço","service"]));
  push(getField(it, ["profissional","professional"]));
  push(getField(it, ["modalidade","modality"]));
  push(getField(it, ["curso","course"]));

  push(getField(it, ["ValorVenda","Preco","Preço","price","valor","valor_total"]));

  return norm(bits.join(" | "));
}

function coerceItems(maybe: any): any[] {
  if (Array.isArray(maybe)) return maybe;
  if (maybe && Array.isArray(maybe.data)) return maybe.data;
  return [];
}

// ============== HARD-FILTER + RANKING ==============
export function filterAndRankItems(itemsIn: any[], criteria: Criteria): any[] {
  const items = coerceItems(itemsIn);
  if (!Array.isArray(items) || !items.length) return [];

  const rankedBase = items.map((it) => {
    // Aliases
    const bairro    = getField(it, ["location.neighborhood","neighborhood","Bairro","bairro"]);
    const cidade    = getField(it, ["location.city","city","Cidade","cidade"]);
    const estado    = getField(it, ["location.state","state","Estado","estado","UF","uf"]);
    const titulo    = getField(it, ["TituloSite","Titulo","title"]);
    const descr     = getField(it, ["description","Descricao","Descrição"]);
    const categoria = getField(it, ["category","Categoria","tipo","Tipo","TipoImovel","tipoImovel"]);
    const priceRaw  = getField(it, ["ValorVenda","Preco","Preço","price","valor","valor_total"]);
    const price     = toNumber(priceRaw);

    const dorm      = parseIntSafe(getField(it, ["bedrooms","Dormitorios","Dormitórios","dormitorios","dormitórios","Quartos","quartos"]));
    const area      = toNumber(getField(it, ["AreaPrivativa","area","Área","Area","M2","m2"]));
    const vagas     = parseIntSafe(getField(it, ["Vagas","VagasGaragem","vagas","garagens"]));
    const tipoItem  = String(categoria ?? titulo ?? descr ?? "");

    const brand     = getField(it, ["marca","brand"]);
    const model     = getField(it, ["modelo","model"]);
    const year      = parseIntSafe(getField(it, ["ano","year"]));
    const km        = toNumber(getField(it, ["km","quilometragem"]));
    const trans     = getField(it, ["cambio","transmissao","transmission"]);
    const fuel      = getField(it, ["combustivel","fuel"]);

    const specialty = getField(it, ["especialidade","specialty"]);
    const insurance = getField(it, ["convenio","insurance"]);
    const service   = getField(it, ["servico","serviço","service"]);
    const professional = getField(it, ["profissional","professional"]);
    const modality  = getField(it, ["modalidade","modality"]);
    const course    = getField(it, ["curso","course"]);

    const blob = makeSearchBlob(it);

    // ---------- HARD FILTER ----------
    // Geo
    if (criteria.city)        { const ok = normIncludes(cidade, criteria.city) || blob.includes(norm(criteria.city)); if (!ok) return null; }
    if (criteria.neighborhood){ const want = cleanNeighborhood(criteria.neighborhood); const ok = normIncludes(bairro, want) || blob.includes(norm(want)); if (!ok) return null; }
    if (criteria.state && estado && !normEq(estado, criteria.state)) return null;

    // Imóveis – quartos
    if (criteria.bedrooms !== undefined && dorm !== undefined && dorm !== criteria.bedrooms) return null;
    if (criteria.minBedrooms !== undefined && dorm !== undefined && dorm < criteria.minBedrooms) return null;
    if (criteria.maxBedrooms !== undefined && dorm !== undefined && dorm > criteria.maxBedrooms) return null;

    // Tipo
    if (criteria.typeHint && !(typeMatches(tipoItem, criteria.typeHint) || blob.includes(norm(criteria.typeHint)))) return null;

    // Área
    const areaMinEff = criteria.minArea ?? criteria.areaMin;
    const areaMaxEff = criteria.maxArea ?? criteria.areaMax;
    if (areaMinEff !== undefined && area !== undefined && area < areaMinEff) return null;
    if (areaMaxEff !== undefined && area !== undefined && area > areaMaxEff) return null;

    // Vagas / garagem
    if (criteria.hasGarage === true) {
      const vg = typeof vagas === "number" ? vagas : toNumber(vagas);
      if (!(vg && vg >= 1)) return null;
    }
    if (criteria.hasGarage === false) {
      const vg = typeof vagas === "number" ? vagas : toNumber(vagas);
      if (vg && vg >= 1) return null;
    }
    if (criteria.minVagas !== undefined && vagas !== undefined && vagas < criteria.minVagas) return null;
    if (criteria.maxVagas !== undefined && vagas !== undefined && vagas > criteria.maxVagas) return null;

    // Preço
    if (criteria.priceMin !== undefined && price !== undefined && price < criteria.priceMin) return null;
    if (criteria.priceMax !== undefined && price !== undefined && price > criteria.priceMax) return null;

    // Veículos
    if (criteria.brand && !(normIncludes(brand, criteria.brand) || blob.includes(norm(criteria.brand)))) return null;
    if (criteria.model && !(normIncludes(model, criteria.model) || blob.includes(norm(criteria.model)))) return null;
    if (criteria.yearMin !== undefined && year !== undefined && year < criteria.yearMin) return null;
    if (criteria.yearMax !== undefined && year !== undefined && year > criteria.yearMax) return null;
    if (criteria.kmMax !== undefined && km !== undefined && km > criteria.kmMax) return null;
    if (criteria.transmission && !matchesAlias(criteria.transmission, trans, TRANSMISSION_MAP)) return null;
    if (criteria.fuel && !matchesAlias(criteria.fuel, fuel, FUEL_MAP)) return null;

    // Saúde / Serviços / Educação (igual ao anterior)
    if (criteria.specialty && !(normIncludes(specialty, criteria.specialty) || blob.includes(norm(criteria.specialty)))) return null;
    if (criteria.insurance && !(normIncludes(insurance, criteria.insurance) || blob.includes(norm(criteria.insurance)))) return null;
    if (criteria.service && !(normIncludes(service, criteria.service) || blob.includes(norm(criteria.service)))) return null;
    if (criteria.professional && !(normIncludes(professional, criteria.professional) || blob.includes(norm(criteria.professional)))) return null;
    if (criteria.modality && !(normIncludes(modality, criteria.modality) || blob.includes(norm(criteria.modality)))) return null;
    if (criteria.course && !(normIncludes(course, criteria.course) || blob.includes(norm(criteria.course)))) return null;

    // ---------- RANKING ----------
    let score = 0;

    if (criteria.neighborhood && (anyIncludes([bairro, titulo], cleanNeighborhood(criteria.neighborhood)) || blob.includes(norm(cleanNeighborhood(criteria.neighborhood))))) score += 5;
    if (criteria.city && (anyIncludes([cidade, titulo], criteria.city) || blob.includes(norm(criteria.city)))) score += 3;
    if (criteria.state && estado && normEq(estado, criteria.state)) score += 1;

    if (criteria.typeHint && (typeMatches(tipoItem, criteria.typeHint) || blob.includes(norm(criteria.typeHint)))) score += 2;

    if (criteria.bedrooms !== undefined && dorm !== undefined && dorm === criteria.bedrooms) score += 2;
    if (criteria.minBedrooms !== undefined && dorm !== undefined && dorm >= criteria.minBedrooms) score += 1.2;
    if (criteria.maxBedrooms !== undefined && dorm !== undefined && dorm <= criteria.maxBedrooms) score += 0.8;

    const areaMinScore = (criteria.minArea ?? criteria.areaMin);
    if (area && areaMinScore && area >= areaMinScore) score += 0.4;

    if (criteria.hasGarage === true && vagas && vagas >= 1) score += 0.7;
    if (criteria.minVagas && vagas && vagas >= criteria.minVagas) score += 0.6;

    const priceStrict = parsePriceStrict(priceRaw);
    if (priceStrict && criteria.priceMax && priceStrict <= criteria.priceMax) score += 0.6;
    if (priceStrict && criteria.priceMin && priceStrict >= criteria.priceMin) score += 0.3;

    if (criteria.brand && normIncludes(brand, criteria.brand)) score += 1.5;
    if (criteria.model && normIncludes(model, criteria.model)) score += 1.0;
    if (criteria.yearMin && year && year >= criteria.yearMin) score += 0.5;
    if (criteria.yearMax && year && year <= criteria.yearMax) score += 0.5;
    if (criteria.kmMax && km && km <= criteria.kmMax) score += 0.7;

    if (criteria.specialty && normIncludes(specialty, criteria.specialty)) score += 1.2;
    if (criteria.insurance && normIncludes(insurance, criteria.insurance)) score += 0.8;
    if (criteria.service && normIncludes(service, criteria.service)) score += 1.2;
    if (criteria.professional && normIncludes(professional, criteria.professional)) score += 0.6;

    if (criteria.modality && normIncludes(modality, criteria.modality)) score += 0.8;
    if (criteria.course && normIncludes(course, criteria.course)) score += 0.8;

    return { it, score };
  }).filter(Boolean) as Array<{ it: any; score: number }>;

  const arr = rankedBase.length ? rankedBase : items.map(it => ({ it, score: 0 }));
  return arr.sort((a, b) => b.score - a.score).map(x => x.it);
}

export function paginateRanked(list: any[], page: number, pageSize: number) {
  const p = Math.max(1, page|0);
  const s = Math.max(1, pageSize|0);
  const start = (p - 1) * s;
  return list.slice(start, start + s);
}
