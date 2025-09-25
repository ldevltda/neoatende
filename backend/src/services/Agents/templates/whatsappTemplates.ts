// backend/src/services/Agents/templates/whatsappTemplates.ts
export const T = {
  saudacao: (nome?: string) =>
    `Oi${nome ? `, ${nome}` : ""}! Eu sou da Barbi Imóveis 👋
Pra te ajudar sem enrolação: qual bairro você prefere e qual sua *renda familiar mensal* (aprox.)?
Se tiver *entrada* ou FGTS, conta também. Prometo ser bem objetivo(a) 😉`,

  entradaFGTS: () =>
    `Perfeito! Você planeja usar *FGTS* ou tem alguma *entrada*? Pode ser aproximado (ex.: R$ 40 mil).`,

  ajusteExpectativa: (desejo: string, bairroAlvo?: string) =>
    `Entendi seu desejo em *${desejo}*. Pelo que você comentou, o banco normalmente não financia 100%; a parte não financiada vem de *entrada/FGTS*.
Pra te colocar numa opção que *cabe no bolso* e não aperta, separei 3 imóveis na faixa mais viável${bairroAlvo ? ` em ${bairroAlvo}` : ""}.
Quer ver agora e já deixo uma visita pré-agendada?`,

  cardLista: (cards: Array<{
    title: string; bairroCidade?: string; areaM2?: string; dorm?: number; vagas?: number; preco?: string; link?: string;
  }>) => {
    const bullets = cards.slice(0, 3).map((c, i) =>
      [
        `*${i + 1}) ${c.title}*`,
        c.bairroCidade && `• ${c.bairroCidade}`,
        c.areaM2 && `• ${c.areaM2}`,
        (c.dorm || c.vagas) && `• ${c.dorm ?? "?"} dorm · ${c.vagas ?? "?"} vaga(s)`,
        c.preco && `• ${c.preco}`,
        c.link && `• ${c.link}`
      ].filter(Boolean).join("\n")
    );
    return `${bullets.join("\n\n")}\n\n👉 Quer ver por dentro? Agendo sua visita agora.`;
  },

  agendamento: () =>
    `Tenho *quarta às 18h* ou *sábado às 10h* pra te mostrar com calma. Qual horário te atende melhor?`,

  desqualificaGentil: () =>
    `Show! Quando você avançar na *entrada* (ou liberar FGTS), me chama. Enquanto isso, te envio 2–3 conteúdos práticos pra *subsídio/entrada* e ajustar a simulação. Pode ser?`,

  handoff: (especialista: string) =>
    `Esse caso pede um cuidado mais personalizado. Vou te passar com a *${especialista}*, nossa especialista — ela te chama ainda hoje. Tudo bem?`,

  financiamentoResumo: (faixaMin: number, faixaMax: number, prazo: number, parcela: number) =>
    `Pelo seu perfil, a *faixa estimada* do imóvel fica entre *R$ ${faixaMin.toLocaleString("pt-BR")}* e *R$ ${faixaMax.toLocaleString("pt-BR")}* (prazo ~ *${prazo} meses* e parcela estimada até *R$ ${Math.round(parcela).toLocaleString("pt-BR")}*).
Quer que eu te mostre 2–3 opções nessa faixa e já deixo uma visita pré-agendada?`
};
