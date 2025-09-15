import { Router } from "express";
import isAuth from "../middleware/isAuth";
import {
  createIntegration,
  inferIntegration,
  guidedFix,
  searchInventory,
  listIntegrations
} from "../controllers/InventoryController";
import { agentLookup } from "../controllers/InventoryAgentController";
import * as InventoryAgentController from "../controllers/InventoryAgentController";

const routes = Router();

routes.get("/inventory/integrations", isAuth, listIntegrations); // ← ADD
routes.post("/inventory/integrations", isAuth, createIntegration);
routes.post("/inventory/integrations/:id/infer", isAuth, inferIntegration);
routes.post("/inventory/integrations/:id/guided-fix", isAuth, guidedFix);
routes.post("/inventory/integrations/:id/search", isAuth, searchInventory);
routes.post("/inventory/agent/lookup", isAuth, agentLookup);
routes.post("/inventory/agent/lookup", InventoryAgentController.agentLookup);

export default routes;
