// backend/src/services/Agent/AvailabilitySkill.ts
import { buscarDadosExternos } from "../IntegrationsServices/AgentToolbox";

type SkillOptions = {
  baseURL: string;             // ex.: process.env.BACKEND_URL
  token: string;               // token interno do servidor (não o do usuário final)
  defaultPageSize?: number;    // opcional
};

function isAvailabilityQuestion(text: string) {
  const t = (text || "").toLowerCase();
  // Regras simples; pode evoluir pra NLU se quiser
  return (
    /dispon[ií]vel/.test(t) ||
    /ainda tem/.test(t) ||
    /est[aá] (a[ií]nda)? dispon/.test(t) ||
    /esse im[óo]vel/.test(t)
  );
}

export async function tryHandleAvailability(
  userText: string,
  { baseURL, token, defaultPageSize = 5 }: SkillOptions
) {
  if (!isAvailabilityQuestion(userText)) return null;

  // 1) Consulta usando intenção livre (o resolver vai escolher "Vista" por categoryHint/nome)
  const result = await buscarDadosExternos({
    baseURL,
    token,
    text: userText,
    page: 1,
    pageSize: defaultPageSize
  });

  const items = Array.isArray(result?.items) ? result.items : [];

  // 2) Nenhum item encontrado
  if (!items.length) {
    return {
      handled: true,
      reply:
        "Eu conferi agora e não localizei um imóvel com essas características. Quer me dizer a região ou o orçamento para eu buscar alternativas?",
      data: { items }
    };
  }

  // 3) Se vier 1, responde direto; se vier mais, lista curtas sugestões
  if (items.length === 1) {
    const im = items[0];
    const titulo = im?.TituloSite || im?.title || im?.nome || "Imóvel encontrado";
    const preco = im?.Valor || im?.price || im?.preco;
    const codigo = im?.Codigo || im?.codigo || im?.id || "";

    const precoFmt =
      typeof preco === "number"
        ? preco.toLocaleString("pt-BR", { style: "currency", currency: "BRL" })
        : preco || "";

    const url =
      im?.url ||
      im?.Link ||
      (im?.Codigo ? `https://barbiimoveis.com.br/imovel/${im.Codigo}` : undefined);

    const linhas = [
      `Sim! Esse imóvel está **disponível** ✅`,
      `**${titulo}** ${precoFmt ? `• ${precoFmt}` : ""}`,
      codigo ? `Código: ${codigo}` : null,
      url ? `Link: ${url}` : null,
      "",
      `Posso te enviar mais fotos e detalhes?`
    ].filter(Boolean);

    return { handled: true, reply: linhas.join("\n"), data: { items } };
  }

  // 4) Vários itens – lista os 3 primeiros
  const tops = items.slice(0, 3).map((im: any) => {
    const titulo = im?.TituloSite || im?.title || im?.nome || "Imóvel";
    const preco = im?.Valor || im?.price || im?.preco;
    const precoFmt =
      typeof preco === "number"
        ? preco.toLocaleString("pt-BR", { style: "currency", currency: "BRL" })
        : preco || "";
    const codigo = im?.Codigo || im?.codigo || im?.id || "";
    const url =
      im?.url ||
      im?.Link ||
      (im?.Codigo ? `https://barbiimoveis.com.br/imovel/${im.Codigo}` : undefined);

    return `• ${titulo}${precoFmt ? ` — ${precoFmt}` : ""}${codigo ? ` (cód. ${codigo})` : ""}${url ? `\n  ${url}` : ""}`;
  });

  const reply = [
    `Encontrei **${items.length} imóveis** que batem com o que você descreveu. Aqui vão alguns:`,
    ...tops,
    "",
    `Quer que eu filtre por bairro, faixa de preço ou número de quartos?`
  ].join("\n");

  return { handled: true, reply, data: { items } };
}
