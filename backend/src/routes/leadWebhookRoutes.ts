import { Router } from "express";
import { handleIncomingLead, handleIncomingLeadGHL } from "../controllers/LeadWebhookController";

const leadRoutes = Router();

// genérico (mantém como está)
leadRoutes.post("/imoveis/envia-primeira-mensagem", handleIncomingLead);

// **específico GHL**
leadRoutes.post("/imoveis/envia-primeira-mensagem-ghl", handleIncomingLeadGHL);

export default leadRoutes;
