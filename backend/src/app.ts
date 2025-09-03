import "./bootstrap";
import "reflect-metadata";
import "express-async-errors";
import express, { Request, Response, NextFunction } from "express";
import path from "path";
import cors from "cors";
import cookieParser from "cookie-parser";
import * as Sentry from "@sentry/node";

import "./database";
import uploadConfig from "./config/upload";
import AppError from "./errors/AppError";
import routes from "./routes";
import { logger } from "./utils/logger";
import { messageQueue, sendScheduledMessages } from "./queues";
import bodyParser from "body-parser";

Sentry.init({ dsn: process.env.SENTRY_DSN });

const app = express();

// filas
app.set("queues", {
  messageQueue,
  sendScheduledMessages
});

// payloads grandes
app.use(bodyParser.json({ limit: "10mb" }));
app.use(express.json());
app.use(cookieParser());

// CORS (se o front está sendo servido pelo próprio back, pode abrir para o mesmo host)
app.use(
  cors({
    credentials: true,
    origin: process.env.FRONTEND_URL || true
  })
);

// Sentry - request handler
app.use(Sentry.Handlers.requestHandler());

// arquivos públicos enviados
app.use("/public", express.static(uploadConfig.directory));

// ------------------------------
// 1) Rotas da API primeiro
// ------------------------------
app.use(routes);

// ------------------------------
// 2) Frontend estático (build)
//    O Dockerfile copia o build para /app/frontend-build
//    Em runtime, o transpiled JS fica em /app/dist; por isso subimos um nível.
// ------------------------------
const STATIC_DIR = path.join(__dirname, "..", "frontend-build");

// Servir os arquivos estáticos (JS/CSS/IMG) do build
app.use(express.static(STATIC_DIR));

// Se for uma rota de SPA (ex.: /login, /register, /qualquercoisa), devolver index.html
// Obs: isso vem *depois* das rotas da API para não interceptá-las.
app.get("*", (req, res) => {
  res.sendFile(path.join(STATIC_DIR, "index.html"));
});

// Sentry - error handler
app.use(Sentry.Handlers.errorHandler());

// Handler de erros da aplicação
app.use(async (err: Error, req: Request, res: Response, _next: NextFunction) => {
  if (err instanceof AppError) {
    logger.warn(err);
    return res.status(err.statusCode).json({ error: err.message });
  }
  logger.error(err);
  return res.status(500).json({ error: "ERR_INTERNAL_SERVER_ERROR" });
});

export default app;
