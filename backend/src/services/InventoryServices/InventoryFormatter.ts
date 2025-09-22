// Formatação genérica de resultados — não assume domínio.
// Usado pelo listener para montar a resposta “bonita” no WhatsApp.

export function formatInventoryReply(payload: any): string {
  const items: any[] = payload?.items || [];
  const page = payload?.page || 1;
  const pageSize = payload?.pageSize || Math.min(items.length, 5) || 0;
  const total = payload?.total ?? items.length ?? 0;

  const crit = payload?.criteria || payload?.query?.criteria || {};
  const filtros = payload?.query?.filtros || {};
  const whereBits = [crit.neighborhood || filtros.neighborhood, crit.city || filtros.city, crit.state || filtros.state]
    .filter(Boolean).join(", ");
  const where = whereBits ? ` em ${whereBits}` : "";

  const head = total > 0
    ? `🌟 Encontrei algumas opções${where}:\n`
    : "Não encontrei itens para esse critério.";

  const top = items.slice(0, Math.min(pageSize || 5, 5));

  const pick = (obj: any, keys: string[]) =>
    keys.find(k => obj?.[k] != null && obj?.[k] !== "" && obj?.[k] !== "0");

  const lines = top.map((it, idx) => {
    const titleKey =
      pick(it, ["title","name","TituloSite","Titulo","Nome","Descrição","Descricao","Codigo","codigo"]) || "title";
    const title = String(it[titleKey] ?? `Item ${idx + 1}`);

    const priceKey = pick(it, ["price","valor","preco","Preço","ValorVenda","Valor","amount"]);
    const priceStr = priceKey ? `\n💰 ${String(it[priceKey]).toString().replace(/[^\d.,a-zA-Z\$€£R$ ]/g,"")}` : "";

    const urlKey = pick(it, ["url","URL","link","Link","slug"]);
    const linkStr = urlKey ? `\n🔗 Ver detalhes ➜ ${it[urlKey]}` : "";

    const attrs: string[] = [];
    const attrPairs: Array<[string,string]> = [
      ["color","🎨"],["cor","🎨"],
      ["size","📏"],["tamanho","📏"],
      ["memory","💾"],["ram","💾"],["storage","💽"],
      ["warranty","🛡"],["garantia","🛡"],
      ["brand","🏷"],["marca","🏷"],
      ["model","🔧"],["modelo","🔧"],
      ["dormitorios","🛏"],["quartos","🛏"],["vagas","🚗"],["area","📐"],["metragem","📐"]
    ];
    for (const [k, icon] of attrPairs) {
      if (it[k] != null && String(it[k]).trim() !== "") attrs.push(`${icon} ${it[k]}`);
    }

    const idxEmoji = ["1️⃣","2️⃣","3️⃣","4️⃣","5️⃣"][idx] || `${idx + 1}.`;
    return `${idxEmoji} *${title}*\n${attrs.join(" | ")}${priceStr}${linkStr}`;
  });

  const footer = total > page * pageSize
    ? `\n👉 *Diga "ver mais"* para ver a próxima página.`
    : "";

  return `${head}\n${lines.join("\n\n")}${footer}`.trim();
}

export default { formatInventoryReply };
