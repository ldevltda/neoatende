import { OpenAI as OpenAIClient } from "openai";

export function createOpenAIClient(apiKeyFromPrompt?: string) {
  const apiKey = apiKeyFromPrompt || process.env.OPENAI_API_KEY;
  if (!apiKey) throw new Error("OPENAI_API_KEY not set and no per-prompt key provided");
  return new OpenAIClient({ apiKey });
}
