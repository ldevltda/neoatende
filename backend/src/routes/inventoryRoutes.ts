import { Router } from "express";
import isAuth from "../middleware/isAuth";
import {
  createIntegration,
  inferIntegration,
  guidedFix,
  searchInventory,
  listIntegrations // ← ADD
} from "../controllers/InventoryController";

const routes = Router();

routes.get("/inventory/integrations", isAuth, listIntegrations); // ← ADD
routes.post("/inventory/integrations", isAuth, createIntegration);
routes.post("/inventory/integrations/:id/infer", isAuth, inferIntegration);
routes.post("/inventory/integrations/:id/guided-fix", isAuth, guidedFix);
routes.post("/inventory/integrations/:id/search", isAuth, searchInventory);

export default routes;
