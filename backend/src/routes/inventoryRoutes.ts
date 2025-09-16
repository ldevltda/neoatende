import { Router } from "express";
import isAuth from "../middleware/isAuth";
import {
  createIntegration,
  inferIntegration,
  guidedFix,
  searchInventory,
  listIntegrations // ← já existe
} from "../controllers/InventoryController";

// +++
import { agentLookup } from "../controllers/InventoryAgentController"; // ← ADICIONE

const routes = Router();

routes.get("/inventory/integrations", isAuth, listIntegrations);
routes.post("/inventory/integrations", isAuth, createIntegration);
routes.post("/inventory/integrations/:id/infer", isAuth, inferIntegration);
routes.post("/inventory/integrations/:id/guided-fix", isAuth, guidedFix);
routes.post("/inventory/integrations/:id/search", isAuth, searchInventory);

// +++
routes.post("/inventory/agent/lookup", isAuth, agentLookup); // ← ADICIONE

export default routes;
