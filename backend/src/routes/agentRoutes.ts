import { Router } from "express";
import isAuth from "../middleware/isAuth";
import * as Planner from "../services/AI/Planner";
import { calcularBudget } from "../services/Finance/FinancingCalculator";

const routes = Router();

routes.post("/agent/plan", isAuth, async (req, res) => {
  const { text } = req.body || {};
  const out = await Planner.plan({ text });
  return res.json(out);
});

routes.post("/agent/finance/calc", isAuth, async (req, res) => {
  const out = calcularBudget(req.body || {});
  return res.json(out);
});

export default routes;
