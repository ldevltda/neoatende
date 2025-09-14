import { Router } from "express";
import isAuth from "../middleware/isAuth";
import {
  createIntegration,
  inferIntegration,
  guidedFix,
  searchInventory
} from "../controllers/InventoryController";

const routes = Router();

// Todas protegidas – ajusta conforme necessidade
routes.post("/inventory/integrations", isAuth, createIntegration);
routes.post("/inventory/integrations/:id/infer", isAuth, inferIntegration);
routes.post("/inventory/integrations/:id/guided-fix", isAuth, guidedFix);
routes.post("/inventory/integrations/:id/search", isAuth, searchInventory);

export default routes;
