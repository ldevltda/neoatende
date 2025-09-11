import { Request, Response } from "express";
import { z } from "zod";
import { buildPrompt } from "../../services/prompt/BuildPrompt";

const complianceSchema = z.object({
  collectPII: z.boolean().optional(),
  allowPricing: z.boolean().optional(),
  allowMedical: z.boolean().optional(),
  allowLegalAdvice: z.boolean().optional(),
}).default({}); // default no objeto, sem defaults internos

const channelHintsSchema = z.object({
  whatsapp: z.boolean().optional(),
  instagram: z.boolean().optional(),
  webchat: z.boolean().optional(),
}).default({}); // idem

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
  compliance: complianceSchema.optional(),     // objeto com default({})
  channelHints: channelHintsSchema.optional(), // objeto com default({})
});

export const generatePromptController = (req: Request, res: Response) => {
  try {
    const input = schema.parse(req.body);

    // Normalização de defaults de negócio (fica 100% previsível)
    const normalized = {
      ...input,
      compliance: {
        collectPII: false,
        allowPricing: true,
        allowMedical: false,
        allowLegalAdvice: false,
        ...(input.compliance || {}),
      },
      channelHints: {
        whatsapp: true,
        instagram: false,
        webchat: false,
        ...(input.channelHints || {}),
      },
    };

    const result = buildPrompt(normalized);
    return res.status(200).json(result);
  } catch (err: any) {
    if (err?.issues) {
      return res.status(400).json({ error: "ValidationError", details: err.issues });
    }
    console.error("Prompt generation error:", err);
    return res.status(500).json({ error: "InternalError" });
  }
};
