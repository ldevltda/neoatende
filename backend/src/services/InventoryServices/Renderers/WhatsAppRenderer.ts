// backend/src/services/InventoryServices/Renderers/WhatsAppRenderer.ts
// Renderizador padrão para WhatsApp: multi-domínio, com links e ícones.
// Prioriza campos universais e alias comuns (ex.: dorm/dormitórios, cidade/cidade, uf/estado, etc).
// OBS: WhatsApp não suporta [texto](url); use a URL "crua" para ser clicável.

// ⬇️ ADICIONE/ATUALIZE ESTE TIPO
export type RenderOpts = {
  headerTitle?: string;
  /** Resumo amigável do que foi buscado, ex.: "em apartamento, campinas, são josé, sc" */
  criteriaSummary?: string;
  /** Dica de categoria para CTA (ex.: "Imóveis", "Veículos", "Saúde" ...) */
  categoryHint?: string;
  /** Máximo de cards a exibir (1..5) */
  maxItems?: number;
  /** Mostra emojis 1️⃣ 2️⃣ 3️⃣ como prefixo dos cards */
  showIndexEmojis?: boolean;
};

function normalize(s?: string) {
  return (s || "").normalize("NFD").replace(/\p{Diacritic}/gu, "").toLowerCase().trim();
}

// Accessor tolerante com alias e paths ("a.b.c"), case/acentos-insensitive
function getFieldLoose(obj: any, aliases: string[]) {
  for (const path of aliases) {
    let cur: any = obj;
    const parts = path.split(".");
    let ok = true;
    for (const rawKey of parts) {
      if (cur == null) { ok = false; break; }
      if (Object.prototype.hasOwnProperty.call(cur, rawKey)) {
        cur = cur[rawKey];
        continue;
      }
      const target = normalize(rawKey);
      const foundKey = Object.keys(cur).find(k => normalize(k) === target);
      if (foundKey !== undefined) cur = cur[foundKey]; else { ok = false; break; }
    }
    if (ok && cur !== undefined) return cur;
  }
  return undefined;
}

function toNumber(v: any): number | undefined {
  if (v === null || v === undefined) return undefined;
  if (typeof v === "number") return isNaN(v) ? undefined : v;

  let s = String(v).trim();
  if (!s) return undefined;

  // Mantém apenas dígitos, vírgula e ponto (e sinal)
  s = s.replace(/[^\d.,\-]/g, "");

  const hasComma = s.includes(",");
  const hasDot = s.includes(".");

  if (hasComma && hasDot) {
    // Quando tem os dois, o ÚLTIMO separador costuma ser o decimal
    const lastComma = s.lastIndexOf(",");
    const lastDot = s.lastIndexOf(".");
    const decimalSep = lastComma > lastDot ? "," : ".";
    const thousandSep = decimalSep === "," ? "." : ",";

    s = s.split(thousandSep).join("");   // remove separador de milhar
    s = s.replace(decimalSep, ".");      // normaliza decimal para ponto
  } else if (hasComma) {
    // Só vírgula → vírgula é decimal no padrão BR
    s = s.replace(/\./g, "");            // se tiver ponto, assume milhar
    s = s.replace(",", ".");
  } else if (hasDot) {
    // Só ponto → assume ponto como decimal (formato US)
    // (se houver vírgulas perdidas de milhar, já foram removidas acima)
  }

  const n = Number(s);
  return isNaN(n) ? undefined : n;
}

function fmtMoneyBR(v: any): string {
  if (v == null) return "Consulte";
  // Aceita string "R$ 450.000" direto
  if (typeof v === "string" && v.trim().startsWith("R$")) return v.trim();
  const n = typeof v === "number" ? v : toNumber(v);
  if (n == null) return "Consulte";
  return n.toLocaleString("pt-BR", { style: "currency", currency: "BRL", maximumFractionDigits: 0 });
}

function fmtAreaM2(v: any): string | undefined {
  const n = toNumber(v);
  if (n == null) return undefined;

  // Se tiver casas decimais, mostra 2; se for inteiro, mostra sem casas
  const hasDecimals = Math.abs(n % 1) > 1e-6;
  const txt = n.toLocaleString("pt-BR", {
    minimumFractionDigits: hasDecimals ? 2 : 0,
    maximumFractionDigits: hasDecimals ? 2 : 0
  });
  return `${txt} m²`;
}

function appendCTA(categoryHint?: string): string {
  switch ((categoryHint || "").toLowerCase()) {
    case "imóveis":
    case "imoveis":
      return "\n\n👉 Gostaria que eu agendasse uma visita em algum desses?";

    case "veículos":
    case "automóveis":
    case "autos":
      return "\n\n👉 Quer que eu agende um test drive para você?";

    case "saúde":
    case "consultas":
      return "\n\n👉 Gostaria que eu agendasse a consulta para você?";

    case "educação":
    case "cursos":
      return "\n\n👉 Deseja que eu reserve uma vaga neste curso?";

    case "eventos":
      return "\n\n👉 Quer que eu garanta seus ingressos agora?";

    case "serviços":
      return "\n\n👉 Deseja que eu agende este serviço para você?";

    default:
      return "\n\n👉 Posso ajudar a avançar com um próximo passo?";
  }
}

function icoIndex(i: number) {
  const map = ["0️⃣","1️⃣","2️⃣","3️⃣","4️⃣","5️⃣","6️⃣","7️⃣","8️⃣","9️⃣","🔟"];
  return i < map.length ? map[i] : `${i}.`;
}

function ellipsis(s?: string, max = 140): string | undefined {
  if (!s) return s;
  const t = s.trim();
  if (t.length <= max) return t;
  return t.slice(0, max - 1) + "…";
}

// =============== DETECÇÃO DE DOMÍNIO ===============
function detectDomain(item: any, categoryHint?: string): "realestate"|"vehicles"|"health"|"services"|"education"|"generic" {
  const hint = normalize(categoryHint);
  if (hint.includes("imove") || hint.includes("imóvel") || hint.includes("imóveis")) return "realestate";
  if (hint.includes("auto") || hint.includes("carro") || hint.includes("veiculo")) return "vehicles";
  if (hint.includes("saude") || hint.includes("clini") || hint.includes("consulta")) return "health";
  if (hint.includes("beleza") || hint.includes("barbearia") || hint.includes("servico")) return "services";
  if (hint.includes("educa") || hint.includes("curso") || hint.includes("academia")) return "education";

  const title = normalize(getFieldLoose(item, ["category","Categoria","tipo","Tipo","title","Titulo","TituloSite"]) || "");
  if (/(apart|casa|terreno|kitnet|studio)/.test(title)) return "realestate";
  if (/(carro|auto|veic|sedan|hatch|suv)/.test(title)) return "vehicles";
  if (/(consulta|dentista|dermato|clinica|saude)/.test(title)) return "health";
  if (/(corte|barba|manicure|banho|tosa|servico)/.test(title)) return "services";
  if (/(curso|aula|pilates|yoga|crossfit)/.test(title)) return "education";
  return "generic";
}

// =============== FORMATTERS POR DOMÍNIO ===============
function formatRealEstate(it: any) {
  const title = getFieldLoose(it, ["title","Titulo","TituloSite"]) || "Imóvel";
  const bairro = getFieldLoose(it, ["bairro","Bairro","location.neighborhood"]);
  const cidade = getFieldLoose(it, ["cidade","Cidade","location.city"]);
  const uf     = getFieldLoose(it, ["uf","UF","estado","Estado","location.state"]);
  const dorm   = getFieldLoose(it, ["dormitorios","Dormitórios","Dormitorios","Quartos","quartos","bedrooms"]);
  const vagas  = getFieldLoose(it, ["vagas","Vagas","garagens","Garagens"]);
  const area   = fmtAreaM2(getFieldLoose(it, ["area","AreaPrivativa","Área","Area","M2","m2","squareMeters"]));
  const preco  = fmtMoneyBR(getFieldLoose(it, ["price","Preco","Preço","ValorVenda","valor","valor_total"]));
  const url    = getFieldLoose(it, ["url","link","slug"]);

  const loc = [bairro, cidade, uf].filter(Boolean).join(", ");
  const desc1 = `🛏️ ${dorm || "?"} dormitór${String(dorm) === "1" ? "io" : "ios"}`
              + (vagas ? `  |  🚗 ${vagas} vaga${String(vagas) === "1" ? "" : "s"}` : "")
              + (area ? `  |  📐 ${area}` : "");
  const linhas = [
    `*${title}*${loc ? ` – ${loc}` : ""}`,
    desc1,
    `💰 ${preco}`,
    url ? `🔗 Detalhes: ${url}` : undefined
  ].filter(Boolean);
  return linhas.join("\n");
}

function formatVehicle(it: any) {
  const title = getFieldLoose(it, ["title","Titulo","nome","modelo","model"]) || "Veículo";
  const marca = getFieldLoose(it, ["marca","brand"]);
  const modelo= getFieldLoose(it, ["modelo","model"]);
  const ano   = getFieldLoose(it, ["ano","year"]);
  const km    = toNumber(getFieldLoose(it, ["km","quilometragem"]));
  const cambio= getFieldLoose(it, ["cambio","transmissao","transmission"]);
  const combust= getFieldLoose(it, ["combustivel","fuel"]);
  const preco = fmtMoneyBR(getFieldLoose(it, ["price","Preco","Preço","valor","valor_total"]));
  const url   = getFieldLoose(it, ["url","link","slug"]);

  const desc1 = [
    ano ? `📅 ${ano}` : undefined,
    km != null ? `🧭 ${km.toLocaleString("pt-BR")} km` : undefined,
    cambio ? `⚙️ ${String(cambio).toUpperCase()}` : undefined,
    combust ? `⛽ ${combust}` : undefined
  ].filter(Boolean).join("  |  ");

  const nome = [marca, modelo].filter(Boolean).join(" ");
  const header = nome ? `*${nome}*` : `*${title}*`;

  return [
    header,
    desc1 || undefined,
    `💰 ${preco}`,
    url ? `🔗 Detalhes: ${url}` : undefined
  ].filter(Boolean).join("\n");
}

function formatHealth(it: any) {
  const title = getFieldLoose(it, ["title","Titulo","nome"]) || "Consulta";
  const esp   = getFieldLoose(it, ["especialidade","specialty"]);
  const conv  = getFieldLoose(it, ["convenio","insurance"]);
  const cidade= getFieldLoose(it, ["cidade","Cidade","location.city"]);
  const bairro= getFieldLoose(it, ["bairro","Bairro","location.neighborhood"]);
  const url   = getFieldLoose(it, ["url","link","slug"]);
  const loc   = [bairro, cidade].filter(Boolean).join(", ");

  return [
    `*${title}*${esp ? ` – ${esp}` : ""}`,
    loc ? `📍 ${loc}` : undefined,
    conv ? `🩺 Convênio: ${conv}` : undefined,
    url ? `🔗 Agendar: ${url}` : undefined
  ].filter(Boolean).join("\n");
}

function formatService(it: any) {
  const title = getFieldLoose(it, ["title","Titulo","nome","service","servico","serviço"]) || "Serviço";
  const prof  = getFieldLoose(it, ["profissional","professional"]);
  const preco = fmtMoneyBR(getFieldLoose(it, ["price","Preco","Preço","valor"]));
  const url   = getFieldLoose(it, ["url","link","slug"]);
  const dur   = getFieldLoose(it, ["duracao","duration"]);

  return [
    `*${title}*${prof ? ` – com ${prof}` : ""}`,
    dur ? `⏱️ Duração: ${dur}` : undefined,
    `💰 ${preco}`,
    url ? `🔗 Reservar: ${url}` : undefined
  ].filter(Boolean).join("\n");
}

function formatEducation(it: any) {
  const title = getFieldLoose(it, ["title","Titulo","curso","course","nome"]) || "Curso";
  const mod   = getFieldLoose(it, ["modalidade","modality"]);
  const grade = getFieldLoose(it, ["horario","schedule"]);
  const preco = fmtMoneyBR(getFieldLoose(it, ["price","Preco","Preço","valor"]));
  const url   = getFieldLoose(it, ["url","link","slug"]);

  return [
    `*${title}*`,
    [mod ? `🎒 ${mod}` : undefined, grade ? `🗓️ ${grade}` : undefined].filter(Boolean).join("  |  ") || undefined,
    `💰 ${preco}`,
    url ? `🔗 Inscrição: ${url}` : undefined
  ].filter(Boolean).join("\n");
}

function formatGeneric(it: any) {
  const title = getFieldLoose(it, ["title","Titulo","nome"]) || "Item";
  const desc  = ellipsis(getFieldLoose(it, ["description","Descricao","Descrição","resumo"]), 180);
  const preco = fmtMoneyBR(getFieldLoose(it, ["price","Preco","Preço","valor"]));
  const url   = getFieldLoose(it, ["url","link","slug"]);

  return [
    `*${title}*`,
    desc || undefined,
    (preco !== "Consulte") ? `💰 ${preco}` : undefined,
    url ? `🔗 Detalhes: ${url}` : undefined
  ].filter(Boolean).join("\n");
}

function renderCard(item: any, domain: ReturnType<typeof detectDomain>) {
  switch (domain) {
    case "realestate": return formatRealEstate(item);
    case "vehicles":   return formatVehicle(item);
    case "health":     return formatHealth(item);
    case "services":   return formatService(item);
    case "education":  return formatEducation(item);
    default:           return formatGeneric(item);
  }
}

// =============== PÚBLICO ===============
export function renderWhatsAppList(items: any[], opts: RenderOpts = {}): string {
  const max = Math.min(Math.max(opts.maxItems ?? 5, 1), 5);
  const total = Array.isArray(items) ? items.length : 0;
  const shown = (items || []).slice(0, max);

  // Cabeçalho
  const head = opts.headerTitle
    ?? (opts.criteriaSummary
        ? `🌟 Encontrei algumas opções ${opts.criteriaSummary}:`
        : `🌟 Encontrei algumas opções que podem te interessar:`);

  // Se NÃO houver itens, devolve somente o "não encontrei" (sem CTA)
  if (!total || shown.length === 0) {
    const crit = (opts.criteriaSummary || "").trim();
    const notFound = crit
      ? `Não encontrei opções ${crit} no momento.`
      : `Não encontrei opções no momento.`;
    return notFound;
  }

  // Corpo da mensagem (cards)
  const body = shown.map((it, idx) => {
    const domain = detectDomain(it, opts.categoryHint);
    const card = renderCard(it, domain);
    const prefix = (opts.showIndexEmojis ?? true) ? `${icoIndex(idx + 1)} ` : "";
    return `${prefix}${card}`;
  }).join("\n\n");

  // CTA só quando há itens
  const cta = appendCTA(opts.categoryHint);

  return `${head}\n\n${body}${cta}`;
}
