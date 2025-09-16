import "./bootstrap";
import "reflect-metadata";
import "express-async-errors";

import express, { Request, Response, NextFunction } from "express";
import path from "path";
import cors from "cors";
import cookieParser from "cookie-parser";
import * as Sentry from "@sentry/node";
import bodyParser from "body-parser";

import "./database";
import uploadConfig from "./config/upload";
import AppError from "./errors/AppError";
import routes from "./routes";
import { logger } from "./utils/logger";
import { messageQueue, sendScheduledMessages } from "./queues";
import OpenaiRoutes from "./routes/OpenaiRoutes";

Sentry.init({ dsn: process.env.SENTRY_DSN });

const app = express();

// Filas disponíveis na app
app.set("queues", {
  messageQueue,
  sendScheduledMessages
});

// Payloads grandes
app.use(bodyParser.json({ limit: "10mb" }));
app.use(express.json());
app.use(cookieParser());

// CORS
app.use(
  cors({
    credentials: true,
    origin: process.env.FRONTEND_URL || true
  })
);

// Sentry - request handler (antes das rotas)
app.use(Sentry.Handlers.requestHandler());

// Arquivos públicos enviados (mídias)
app.use("/public", express.static(uploadConfig.directory));

/**
 * ================================
 * ROTAS DE API (ANTES DO FALLBACK)
 * ================================
 */
app.use("/openai", OpenaiRoutes); // ✅ mover para cima
app.use(routes);                  // suas demais rotas

/**
 * ================================
 * FRONTEND ESTÁTICO (SPA)
 * ================================
 */
const STATIC_DIR = path.join(__dirname, "..", "frontend-build");

// servir assets do build (js/css/img)
app.use(express.static(STATIC_DIR));

// fallback da SPA (depois das rotas de API)
app.get("*", (_req, res) => {
  res.sendFile(path.join(STATIC_DIR, "index.html"));
});

/**
 * ================================
 * MIDDLEWARES DE ERRO (POR ÚLTIMO)
 * ================================
 */

// Sentry - error handler
app.use(Sentry.Handlers.errorHandler());

// Handler de erros da aplicação
app.use((err: any, _req: Request, res: Response, next: NextFunction) => {
  // ✅ evita “Cannot set headers after they are sent”
  if (res.headersSent) return next(err);

  if (err instanceof AppError) {
    logger.warn(err);
    return res.status(err.statusCode).json({ error: err.message });
  }

  logger.error(err);
  const status =
    err?.status || err?.httpCode || err?.statusCode || 500;

  return res.status(status).json({ error: "ERR_INTERNAL_SERVER_ERROR" });
});

export default app;
