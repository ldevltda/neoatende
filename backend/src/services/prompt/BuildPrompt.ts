type ChannelHints = {
  whatsapp?: boolean;
  instagram?: boolean;
  webchat?: boolean;
};

type Compliance = {
  collectPII?: boolean;
  allowPricing?: boolean;
  allowMedical?: boolean;
  allowLegalAdvice?: boolean;
};

export interface PromptInput {
  businessName: string;
  segment: string;
  mainGoal: string;
  tone: string;
  siteUrl?: string | null;
  socials?: string[];
  knowledgeNotes?: string;
  doNots?: string[];
  typicalQuestions?: string[];
  goodAnswersExamples?: string[];
  language?: string; // "pt-BR" default
  compliance?: Compliance;
  channelHints?: ChannelHints;
}

const SEGMENT_SNIPPETS: Record<string, string> = {
  "imobiliaria": `
- **Procedimentos Imobiliários**: explique etapas (pré-qualificação, simulação, documentação, análise de crédito, assinatura e entrega de chaves).
- **Minha Casa Minha Vida**: faixas de renda, subsídios, documentação básica, mitos comuns (sem prometer aprovação).
- **Visitas**: combine horários e preferências (bairro, nº de quartos, vaga, lazer, faixa de preço, momento para mudar).
- **Transparência**: se não tiver um dado, ofereça confirmar e retornar; registre preferências do lead.`,
  "loja-de-veiculos": `
- **Veículos**: ano/modelo, km, histórico, laudo, garantia, financiamento e entrada.
- **Troca**: colete dados do usado (ano/modelo, estado, fotos) e ofereça avaliação.`,
  "restaurante": `
- **Reservas**: data/horário, nº de pessoas, restrições alimentares.
- **Cardápio**: especialidades, valores aproximados, horários/espera.`,
};

const TONE_PRESETS: Record<string, string> = {
  "acolhedor": "Acolhedor, educado, próximo e propositivo; frases curtas, foco em ajudar.",
  "consultivo": "Consultivo e claro; explique brevemente o porquê das recomendações.",
  "vendas-diretas": "Objetivo e persuasivo; destaque benefícios e CTA sem soar agressivo.",
  "formal": "Formal, direto ao ponto, sem gírias.",
};
const DEFAULT_TONE = "consultivo";

const langHeader = (lang?: string) => {
  if ((lang || "pt-BR") === "pt-BR") {
    return `Responda sempre em **Português do Brasil** com ortografia e pontuação corretas.`;
  }
  return `Answer in **${lang}** with correct grammar and punctuation.`;
};

const channelGuidance = (channels?: ChannelHints) => {
  const c = channels || {};
  const hints: string[] = [];
  if (c.whatsapp) hints.push("- Use mensagens curtas, com quebras de linha e CTA objetivo.");
  if (c.instagram) hints.push("- Evite textos longos; convide para DM/WhatsApp quando fizer sentido.");
  if (c.webchat) hints.push("- Mantenha clareza e formatação leve; inclua links quando útil.");
  return hints.join("\n");
};

const complianceGuardrails = (c?: Compliance) => {
  const cfg = c || {};
  const rules: string[] = [];
  if (!cfg.allowLegalAdvice) rules.push("- Não forneça aconselhamento jurídico; recomende consultar um profissional.");
  if (!cfg.allowMedical) rules.push("- Não forneça aconselhamento médico.");
  if (!cfg.allowPricing) rules.push("- Se não tiver preço atualizado, informe que precisa confirmar e ofereça retorno.");
  if (!cfg.collectPII) rules.push("- Solicite apenas dados necessários e explique o uso (contato/orçamento).");
  return rules.join("\n");
};

const asBullets = (arr?: string[]) =>
  (arr || []).filter(Boolean).map(t => `- ${t}`).join("\n");

export function buildPrompt(input: PromptInput) {
  const {
    businessName,
    segment,
    mainGoal,
    tone,
    siteUrl,
    socials = [],
    knowledgeNotes = "",
    doNots = [],
    typicalQuestions = [],
    goodAnswersExamples = [],
    language = "pt-BR",
    compliance = {},
    channelHints = {},
  } = input;

  const toneText = TONE_PRESETS[tone] || TONE_PRESETS[DEFAULT_TONE];
  const segmentHelp = SEGMENT_SNIPPETS[segment?.toLowerCase()] || "";

  const prompt = `
${langHeader(language)}

# Identidade do Agente
Você é um agente virtual do negócio **${businessName}** no segmento **${segment}**.
Objetivo principal: **${mainGoal}**.
Tom de voz: **${toneText}**.

# Fontes e Contexto
- Site oficial: ${siteUrl || "não informado"}
- Redes sociais: ${socials.length ? socials.join(", ") : "não informado"}
- Observações/Conhecimento adicional do negócio:
${knowledgeNotes ? `\n${knowledgeNotes}\n` : "- (sem observações)"}

# O que **NÃO** responder / evitar
${doNots.length ? asBullets(doNots) : "- Evite assuntos fora do escopo do negócio e conteúdos sensíveis."}

# Orientações por Canal
${channelGuidance(channelHints)}

# Diretrizes de Conformidade
${complianceGuardrails(compliance)}

# Diretrizes de Conversa
- Seja claro, educado e propositivo.
- Se a pergunta for genérica, puxe contexto com **perguntas simples** (faixa de valor, urgência, preferências).
- Se faltar informação para responder com qualidade, **explique o que falta** e **colete os dados**.
- **Ofereça o próximo passo (CTA)** quando fizer sentido (ex.: “Posso te enviar opções no WhatsApp?” ou “Agendamos uma visita?”).

# Específicos do Segmento
${segmentHelp || "- (sem instruções específicas para este segmento ainda)"}

# Perguntas típicas dos clientes (priorize entendimento)
${typicalQuestions.length ? asBullets(typicalQuestions) : "- Preço, disponibilidade, localização, prazos"}

# Exemplos de respostas ideais (guia de estilo)
${goodAnswersExamples.length ? asBullets(goodAnswersExamples) : "- Adicione exemplos para padronizar tom e estrutura"}

# Formatação das Saídas
- Priorize respostas curtas de **2–6 linhas**.
- Use listas com “- ” para enumerar.
- Quando possível, finalize com **pergunta de avanço ou CTA**.
`.trim();

  const summary = `Agente ${segment} para ${businessName} | objetivo: ${mainGoal} | tom: ${tone}`;

  return {
    prompt,
    summary,
    meta: {
      businessName,
      segment,
      mainGoal,
      tone: tone || DEFAULT_TONE,
      siteUrl: siteUrl || null,
      socials,
      language,
      createdAt: new Date().toISOString(),
    },
  };
}
