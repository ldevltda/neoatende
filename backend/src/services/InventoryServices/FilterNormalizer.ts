// backend/src/services/InventoryServices/FilterNormalizer.ts
export type Slots = Record<string, any>;

const toNumber = (v: any) => {
  if (v == null) return v;
  if (typeof v === "number") return v;
  const m = String(v).match(/\d+(?:[.,]\d+)?/);
  if (!m) return v;
  const n = Number(m[0].replace(",", "."));
  return isNaN(n) ? v : n;
};

const norm = (s?: string) =>
  (s || "").normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().trim();

function normalizeCommon(slots: Slots): Slots {
  const out: Slots = {};
  for (const [k0, v0] of Object.entries(slots || {})) {
    const k = norm(k0);
    let v: any = typeof v0 === "string" ? v0.trim() : v0;

    // preço
    if (["preco", "preço", "valor", "ate", "até", "max", "budget", "precomax"].includes(k)) {
      out.precoMax = toNumber(v); continue;
    }
    if (["min", "precomin", "de"].includes(k)) {
      out.precoMin = toNumber(v); continue;
    }

    // localização
    if (["cidade"].includes(k)) { out.cidade = String(v); continue; }
    if (["uf", "estado"].includes(k)) { out.uf = String(v).toUpperCase(); continue; }
    if (["bairro", "regiao", "região"].includes(k)) { out.bairro = String(v); continue; }

    out[k0] = v0;
  }
  return out;
}

function normalizeImoveis(slots: Slots): Slots {
  const s = normalizeCommon(slots);
  const out: Slots = { ...s };

  // tipo
  const tipo = norm(s.tipo || s["tipo_imovel"] || s["property_type"]);
  if (tipo) {
    if (/\b(apto|apart|apartamento)\b/.test(tipo)) out.tipo = "apartamento";
    else if (/\bcasa\b/.test(tipo)) out.tipo = "casa";
    else if (/\bcomercial|sala|loja|sobreloja\b/.test(tipo)) out.tipo = "comercial";
  }

  // quartos → dormitorios
  const quartos = s.quartos ?? s.qtde_quartos ?? s.dormitorios ?? s.dorms ?? s["dormitórios"];
  if (quartos != null) out.dormitorios = toNumber(quartos);

  // vagas
  const vagas = s.vagas ?? s.vaga ?? s.garagem ?? s.garagens;
  if (vagas != null) out.vagas = toNumber(vagas);

  // área
  const area = s.area ?? s["m2"] ?? s["m²"] ?? s.area_privativa ?? s.area_util;
  if (area != null) out.area = toNumber(area);

  return out;
}

function normalizeCarros(slots: Slots): Slots {
  const s = normalizeCommon(slots);
  const out: Slots = { ...s };

  if (s.precoMax != null) out.precoMax = toNumber(s.precoMax);
  if (s.precoMin != null) out.precoMin = toNumber(s.precoMin);

  const portas = s.portas ?? s.qtde_portas;
  if (portas != null) out.portas = toNumber(portas);

  const cambio = norm(s.cambio || s.transmissao);
  if (cambio) {
    if (/\b(auto|automatico)\b/.test(cambio)) out.cambio = "automatico";
    else if (/\bmanual\b/.test(cambio)) out.cambio = "manual";
  }

  const comb = norm(s.combustivel || s.comb);
  if (comb) {
    if (/\bflex\b/.test(comb)) out.combustivel = "flex";
    else if (/\bdiesel\b/.test(comb)) out.combustivel = "diesel";
    else if (/\betanol|alcool\b/.test(comb)) out.combustivel = "etanol";
    else if (/\bgasolina\b/.test(comb)) out.combustivel = "gasolina";
    else if (/\beletrico\b/.test(comb)) out.combustivel = "eletrico";
  }

  return out;
}

export function normalizeFilters(domainHint?: string, slots?: Slots): Slots {
  const d = norm(domainHint);
  if (!slots) return {};
  if (/imoveis|im[oó]veis|imobiliaria|imobiliária|property|real\s*estate/.test(d)) {
    return normalizeImoveis(slots);
  }
  if (/carros|veiculos|ve[ií]culos|autos|autom[oó]veis/.test(d)) {
    return normalizeCarros(slots);
  }
  return normalizeCommon(slots);
}
