// backend/src/services/InventoryServices/Renderers/WhatsAppRenderer.ts
type ListOptions = {
  maxItems?: number;
  headerTitle?: string;
  showIndexEmojis?: boolean;
  categoryHint?: string;
};

function toBR(n: any) {
  const num = Number(String(n).replace(",", "."));
  if (Number.isNaN(num)) return n;
  return num.toLocaleString("pt-BR", { maximumFractionDigits: 2 });
}

export function renderWhatsAppList(items: any[], opts: ListOptions = {}): string {
  const max = opts.maxItems ?? 3;
  const take = (items || []).slice(0, max);
  if (!take.length) return "Não encontrei imóveis com esses filtros agora. Quer ajustar bairro, preço ou nº de dormitórios?";

  const rows = take.map((p, i) => {
    const title = p.title || p.titulo || p.name || p.nome || `Imóvel ${i + 1}`;
    const bairro = p.bairro || p.neighborhood || "";
    const cidade = p.cidade || p.city || "";
    const area = p.area || p.area_m2 || p.m2 || p.areaUtil;
    const dorm = p.dormitorios || p.quartos || p.bedrooms;
    const vagas = p.vagas || p.garagens || p.parking;
    const preco = p.price || p.preco || p.valor;
    const link = p.url || p.link || p.permalink || "";

    const idx = opts.showIndexEmojis ? ["①","②","③","④","⑤"][i] || `${i+1})` : `${i+1})`;
    const parts = [
      `*${idx} ${title}*`,
      (bairro || cidade) && `• ${[bairro, cidade].filter(Boolean).join(" / ")}`,
      area && `• ${toBR(area)} m²`,
      (dorm || vagas) && `• ${dorm ?? "?"} dorm · ${vagas ?? "?"} vaga(s)`,
      preco && `• ${preco}`,
      link && `• ${link}`
    ].filter(Boolean);

    return parts.join("\n");
  });

  const head = opts.headerTitle ? `*${opts.headerTitle}*\n\n` : "";
  return `${head}${rows.join("\n\n")}\n\n` +
         `Para detalhes, envie *#1* ou *detalhes 1*. ` +
         `Para mais opções, diga *ver mais*. ` +
         `👉 Quer ver por dentro? Diga *agendar visita*.`;
}

export function renderPropertyDetails(item: any): string {
  if (!item) return "Não encontrei esse imóvel. Pode me mandar o código ou o número da lista? (#1, #2, ...)";
  const title = item.title || item.titulo || item.name || "Imóvel";
  const bairro = item.bairro || item.neighborhood || "";
  const cidade = item.cidade || item.city || "";
  const area = item.area || item.area_m2 || item.m2 || item.areaUtil;
  const dorm = item.dormitorios || item.quartos || item.bedrooms;
  const vagas = item.vagas || item.garagens || item.parking;
  const banh = item.banheiros || item.bathrooms;
  const preco = item.price || item.preco || item.valor;
  const link = item.url || item.link || item.permalink || "";
  const desc = item.description || item.descricao || "";

  const parts = [
    `*${title}*`,
    (bairro || cidade) && `${[bairro, cidade].filter(Boolean).join(" / ")}`,
    area && `Área: ${toBR(area)} m²`,
    (dorm || vagas) && `Dorms/Vagas: ${dorm ?? "?"}/${vagas ?? "?"}`,
    banh && `Banheiros: ${banh}`,
    preco && `Preço: ${preco}`,
    desc && `—\n${desc}`,
    link && `🔗 ${link}`,
  ].filter(Boolean);

  return `${parts.join("\n")}\n\n👉 Gostou? Posso *agendar uma visita* pra você.`;
}
