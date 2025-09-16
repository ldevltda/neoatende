import { Router } from "express";
import isAuth from "../middleware/isAuth";
import {
  listIntegrations,
  createIntegration,
  inferIntegration,
  guidedFix,
  searchInventory
} from "../controllers/InventoryController";
import { agentLookup } from "../controllers/InventoryAgentController";

const routes = Router();

/** Integrações (listar/criar/editar) */
routes.get("/inventory/integrations", isAuth, listIntegrations);
routes.post("/inventory/integrations", isAuth, createIntegration);

/** Inferir schema a partir de amostras */
routes.post("/inventory/integrations/:id/infer", isAuth, inferIntegration);

/** Ajuste assistido (stub) */
routes.post("/inventory/integrations/:id/guided-fix", isAuth, guidedFix);

/** Testar integração (executa provider) */
routes.post("/inventory/integrations/:id/search", isAuth, searchInventory);

/** Lookup para o AGENTE (orquestrador) */
routes.post("/inventory/agent/lookup", isAuth, agentLookup);

export default routes;
