import { Router } from "express";
import { generatePromptController } from "../controllers/openai/GeneratePromptController";

const router = Router();

router.post("/prompts/generate", generatePromptController);

export default router;
