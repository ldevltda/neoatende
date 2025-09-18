import { Router } from "express";
import { handleIncomingLead } from "../controllers/LeadWebhookController";

const leadRoutes = Router();

// Webhook público (sem isAuth); usa header "key"
leadRoutes.post("/imoveis/envia-primeira-mensagem", handleIncomingLead);

export default leadRoutes;
