import { Router } from "express";
import isAuth from "../middleware/isAuth";
import { agentLookup, agentAuto } from "../controllers/InventoryAgentController";
import {
  listIntegrations,
  createIntegration,
  inferIntegration,
  searchInventory,
  guidedFix
} from "../controllers/InventoryController";

const routes = Router();

// integrações
routes.get("/inventory/integrations", isAuth, listIntegrations);
routes.post("/inventory/integrations", isAuth, createIntegration);
routes.post("/inventory/integrations/:id/infer", isAuth, inferIntegration);
routes.post("/inventory/integrations/:id/search", isAuth, searchInventory);
routes.post("/inventory/integrations/:id/guided-fix", isAuth, guidedFix);

// agente
routes.post("/inventory/agent/lookup", isAuth, agentLookup); // já existia
routes.post("/inventory/agent/auto", isAuth, agentAuto);     // NOVO

export default routes;
