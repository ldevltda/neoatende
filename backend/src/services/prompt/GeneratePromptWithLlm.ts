import { OpenAI as OpenAIClient } from "openai";

type Compliance = {
  collectPII?: boolean;
  allowPricing?: boolean;
  allowMedical?: boolean;
  allowLegalAdvice?: boolean;
};

export interface LlmInput {
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
  language?: string; // default pt-BR
  compliance?: Compliance;
}

export async function generatePromptWithLlm(input: LlmInput, webContext: string) {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) throw new Error("OPENAI_API_KEY not set");

  const openai = new OpenAIClient({ apiKey });

  const language = input.language || "pt-BR";
  const sys = `
Você é um especialista em design de prompts para agentes de atendimento ao cliente.
Sua tarefa: gerar um ÚNICO "prompt de sistema" impecável para um agente do negócio informado.
- Instruções claras, anti-alucinação, tom alinhado, e CTAs.
- Use o idioma: ${language}.
- Incorpore SOMENTE fatos que aparecerem no contexto público (abaixo) e nas respostas do usuário; se algo não estiver no contexto, não invente.
- Quando faltarem dados, inclua diretrizes para o agente coletar as informações essenciais.
- Formato: texto puro (sem markdown code fences), com seções e listas.
- Saída final deve ser apenas o prompt, nada mais.
`.trim();

  const user = `
DADOS DO NEGÓCIO (fornecidos pelo usuário)
{
  "businessName": ${JSON.stringify(input.businessName)},
  "segment": ${JSON.stringify(input.segment)},
  "mainGoal": ${JSON.stringify(input.mainGoal)},
  "tone": ${JSON.stringify(input.tone)},
  "siteUrl": ${JSON.stringify(input.siteUrl || null)},
  "socials": ${JSON.stringify(input.socials || [])},
  "knowledgeNotes": ${JSON.stringify(input.knowledgeNotes || "")},
  "doNots": ${JSON.stringify(input.doNots || [])},
  "typicalQuestions": ${JSON.stringify(input.typicalQuestions || [])},
  "goodAnswersExamples": ${JSON.stringify(input.goodAnswersExamples || [])},
  "compliance": ${JSON.stringify(input.compliance || {})}
}

CONTEÚDO PÚBLICO EXTRAÍDO (site/redes - pode estar vazio):
${webContext || "(sem conteúdo público disponível)"}

GERE o prompt de sistema ideal para o agente que atenderá clientes desse negócio.
Inclua:
- Identidade do agente, objetivo, tom de voz.
- Regras de segurança/compliance (conforme 'compliance').
- Como o agente deve usar informações do negócio (do contexto).
- Limites e assuntos proibidos (doNots).
- Estratégia de conversa (coleta de dados, esclarecimentos, follow-ups).
- Perguntas típicas a priorizar, se fornecidas.
- Guia de estilo (exemplos do usuário, se existirem).
- Formatação: respostas curtas (2-6 linhas), tópicos quando necessário, e sempre com CTA quando apropriado.
`.trim();

  const completion = await openai.chat.completions.create({
    model: "gpt-4o-mini",
    temperature: 0.4,
    messages: [
      { role: "system", content: sys },
      { role: "user", content: user },
    ],
  });

  const prompt = (completion.choices?.[0]?.message?.content || "").trim();
  return prompt;
}
