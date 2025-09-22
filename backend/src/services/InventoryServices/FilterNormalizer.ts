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

    // -------- preço --------
    // EN + PT → precoMax / precoMin
    if (["preco", "preço", "valor", "max", "teto", "budget", "ate", "até", "pricemax", "price_max", "priceTo", "price_to"].includes(k)) {
      out.precoMax = toNumber(v); continue;
    }
    if (["min", "floor", "de", "pricemin", "price_min", "priceFrom", "price_from", "a_partir_de"].includes(k)) {
      out.precoMin = toNumber(v); continue;
    }

    // -------- paginação --------
    if (["page", "pagina", "página"].includes(k)) { out.__page = toNumber(v); continue; }
    if (["pagesize", "page_size", "per_page", "perpage", "tamanho", "limit", "limite"].includes(k)) { out.__pageSize = toNumber(v); continue; }

    // -------- localização (EN + PT) → cidade / uf / bairro --------
    if (["city", "cidade", "municipio", "município"].includes(k)) { out.cidade = String(v); continue; }
    if (["state", "uf", "estado"].includes(k)) { out.uf = String(v).toUpperCase(); continue; }
    if (["neighborhood", "bairro", "regiao", "região", "distrito", "zona"].includes(k)) { out.bairro = String(v); continue; }

    // pass-through (outras chaves tratadas por normalizadores específicos)
    out[k0] = v0;
  }

  return out;
}

/** Imóveis */
function normalizeImoveis(slots: Slots): Slots {
  const s = normalizeCommon(slots);
  const out: Slots = { ...s };

  // tipo → tipo (apartamento, casa, comercial...)
  const tipo = norm(s.tipo || s["tipo_imovel"] || s["property_type"] || s.type || s.typeHint || s.categoria);
  if (tipo) {
    if (/\b(apto|apart|apartamento|flat)\b/.test(tipo)) out.tipo = "apartamento";
    else if (/\bcasa|sobrado|residencia|residência\b/.test(tipo)) out.tipo = "casa";
    else if (/\bcomercial|sala|loja|sobreloja\b/.test(tipo)) out.tipo = "comercial";
  }

  // quartos → dormitorios (EN+PT)
  const quartos = s.quartos ?? s.qtde_quartos ?? s.dormitorios ?? s.dorms ?? s["dormitórios"] ?? s.bedrooms;
  if (quartos != null) out.dormitorios = toNumber(quartos);

  // garagem/hasGarage → vagas
  const vagas = s.vagas ?? s.vaga ?? s.garagem ?? s.garagens;
  if (vagas != null) out.vagas = toNumber(vagas);
  if (out.vagas == null && typeof s.hasGarage === "boolean" && s.hasGarage) out.vagas = 1; // heurística segura

  // área (quando vier consolidado) + faixas
  const area = s.area ?? s["m2"] ?? s["m²"] ?? s.area_privativa ?? s.area_util;
  if (area != null) out.area = toNumber(area);
  if (s.areaMin != null) out.areaMin = toNumber(s.areaMin);
  if (s.areaMax != null) out.areaMax = toNumber(s.areaMax);

  return out;
}

/** Veículos */
function normalizeCarros(slots: Slots): Slots {
  const s = normalizeCommon(slots);
  const out: Slots = { ...s };

  out.marca  = s.marca ?? s.brand;
  out.modelo = s.modelo ?? s.model;
  if (s.yearMin != null) out.ano_min = toNumber(s.yearMin);
  if (s.yearMax != null) out.ano_max = toNumber(s.yearMax);
  if (s.kmMax   != null) out.km_max  = toNumber(s.kmMax);
  if (s.transmission) out.transmissao = s.transmission;
  if (s.fuel)         out.combustivel = s.fuel;

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
