// composeSystemPrompt.ts
import Company from "../../models/Company";

const OUTPUT_SCHEMA = `
Você SEMPRE responde num JSON com esta forma:
{
  "messages": [ { "type": "text" | "cta", "content"?: string, "action"?: "SCHEDULE_VISIT" | "HANDOFF", "options"?: string[] } ],
  "extracted": {
    "city": string | null,
    "neighborhood": string | null,
    "type": "apartamento" | "casa" | "studio" | null,
    "bedrooms": number | null,
    "priceMin": number | null,
    "priceMax": number | null,
    "hasGarage": boolean | null,
    "moment": "agora" | "1-3m" | "3-6m" | "pesquisando" | null,
    "income": number | null,
    "downPayment": number | null,
    "usesFGTS": boolean | null
  },
  "next_action": "ASK_SLOTS" | "SHOW_PROPERTIES" | "SCHEDULE" | "HANDOFF"
}
Se algo não se aplica, use null.
`;

const GUARDRAILS_BASE = `
Tom: claro, caloroso, direto, sem jargões. Fale em 1ª pessoa.
Nunca prometa aprovação de crédito. Pergunte no MÁXIMO 2 coisas por mensagem.
Se o pedido fugir do escopo jurídico/contábil: explique limites e direcione.
Se intenção = vender imóvel: colete dados do imóvel e ofereça avaliação.
`;

const SEGMENT_TEMPLATES: Record<string, string> = {
  // outras indústrias virão depois (automotivo, clínicas…)
  "imoveis": `
Objetivo: qualificar (renda, entrada/FGTS, momento, geo, tipologia), sugerir 2–3 imóveis aderentes e agendar visita.
Regras de conversa:
- Comece com saudação amigável e 1–2 perguntas chave.
- Reformule pedidos vagos ("quando você diz 'maior', pensa em 70–90m²?").
- Sempre que sugerir imóveis, diga por que casam com o que a pessoa pediu.
- Dê alternativas viáveis se o desejo não couber no bolso (educado).
${OUTPUT_SCHEMA}
`  
};

export async function composeSystemPrompt({
  companyId,
  userPromptFromDB // texto que o usuário configurou na tela de Prompts
}: { companyId: number; userPromptFromDB?: string }) {
  const company = await Company.findByPk(companyId);
  const segmento = (company?.segment || "").toLowerCase(); // ex. "imoveis"
  const nomeEmpresa = company?.name || "sua empresa";

  const segmentBlock = SEGMENT_TEMPLATES[segmento] || `
Este atendimento é genérico. Aplique o mesmo estilo humano. 
${OUTPUT_SCHEMA}
`;

  // 1) Prioriza o prompt do usuário (se houver)
  const user = (userPromptFromDB || "").trim();

  // 2) Acrescenta guardrails, nome da empresa e o bloco do segmento
  const system = [
    user || `Você é consultor(a) humano(a) da ${nomeEmpresa}.`,
    GUARDRAILS_BASE,
    segmentBlock
  ].join("\n\n").split("${EMPRESA}").join(nomeEmpresa);
  return system;
}
