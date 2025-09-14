import { Request, Response } from "express";
import { z } from "zod";
import { fetchPublicContext } from "../../services/prompt/FetchPublicContext";
import { generatePromptWithLlm } from "../../services/prompt/GeneratePromptWithLlm";
import { buildPrompt } from "../../services/prompt/BuildPrompt"; // fallback

const complianceSchema = z
  .object({
    collectPII: z.boolean().optional(),
    allowPricing: z.boolean().optional(),
    allowMedical: z.boolean().optional(),
    allowLegalAdvice: z.boolean().optional(),
  })
  .default({});

const schema = z.object({
  businessName: z.string().min(1, "Informe o nome do negócio"),
  segment: z.string().min(1, "Informe o ramo/segmento"),
  mainGoal: z.string().min(1, "Informe o objetivo principal"),
  tone: z.string().min(1),
  siteUrl: z.string().optional().nullable(),
  socials: z.array(z.string()).optional().default([]),
  knowledgeNotes: z.string().optional().default(""),
  doNots: z.array(z.string()).optional().default([]),
  typicalQuestions: z.array(z.string()).optional().default([]),
  goodAnswersExamples: z.array(z.string()).optional().default([]),
  language: z.string().optional().default("pt-BR"),
  compliance: complianceSchema.optional(),
  // removido channelHints
});

export const generatePromptController = async (req: Request, res: Response) => {
  try {
    const input = schema.parse(req.body);

    // normalização de defaults
    const normalized = {
      ...input,
      compliance: {
        collectPII: false,
        allowPricing: true,
        allowMedical: false,
        allowLegalAdvice: false,
        ...(input.compliance || {}),
      },
    };

    // 1) coletar contexto público do site/redes (best-effort)
    const webContext = await fetchPublicContext(normalized.siteUrl, normalized.socials);

    // 2) gerar via OpenAI (se não houver OPENAI_API_KEY, cai no fallback)
    let prompt: string;
    try {
      prompt = await generatePromptWithLlm(normalized, webContext);
    } catch (e) {
      // fallback determinístico
      const fallback = buildPrompt({ ...normalized, channelHints: {} as any });
      prompt = fallback.prompt;
    }

    const summary = `Agente ${normalized.segment} — ${normalized.businessName} | objetivo: ${normalized.mainGoal} | tom: ${normalized.tone}`;

    return res.status(200).json({
      prompt,
      summary,
      meta: {
        businessName: normalized.businessName,
        segment: normalized.segment,
        mainGoal: normalized.mainGoal,
        tone: normalized.tone,
        siteUrl: normalized.siteUrl || null,
        socials: normalized.socials || [],
        language: normalized.language,
        usedOpenAI: !!process.env.OPENAI_API_KEY,
        webContextChars: webContext?.length || 0,
        createdAt: new Date().toISOString(),
      },
    });
  } catch (err: any) {
    if (err?.issues) {
      return res.status(400).json({ error: "ValidationError", details: err.issues });
    }
    console.error("Prompt generation error:", err);
    return res.status(500).json({ error: "InternalError" });
  }
};
