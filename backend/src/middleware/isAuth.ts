// src/middleware/isAuth.ts
import { verify } from "jsonwebtoken";
import { Request, Response, NextFunction } from "express";
import AppError from "../errors/AppError";
import authConfig from "../config/auth";

interface TokenPayload {
  id: string | number;
  username?: string;
  profile: string;
  companyId: number;
  iat: number;
  exp: number;
}

const isAuth = (req: Request, _res: Response, next: NextFunction): void => {
  const authHeader = req.headers.authorization;

  if (!authHeader) {
    // mantém seu comportamento original
    throw new AppError("ERR_SESSION_EXPIRED", 401);
  }

  // suporta "Bearer <token>" ou apenas "<token>"
  const parts = authHeader.split(" ");
  const token = parts.length === 2 ? parts[1] : parts[0];

  // Prioridade: mantém o segredo atual primeiro (compat total)
  const candidates = [
    authConfig?.secret,               // o que você já usa hoje
    process.env.JWT_SECRET,           // comum em outros pontos do sistema
    process.env.JWT_KEY,              // compatibilidade legada
    process.env.SERVICE_JWT_SECRET    // tokens de serviço (ex.: inventory-bot)
  ].filter(Boolean) as string[];

  let decoded: TokenPayload | null = null;

  for (const secret of candidates) {
    try {
      decoded = verify(token, secret) as TokenPayload;
      break; // validou com esse segredo, segue o fluxo
    } catch {
      // tenta o próximo segredo
    }
  }

  if (!decoded) {
    // mantém sua mensagem/status atuais
    throw new AppError(
      "Invalid token. We'll try to assign a new one on next request",
      403
    );
  }

  const { id, profile, companyId } = decoded;

  // mantém exatamente a mesma forma de req.user que você já usa
  (req as any).user = {
    id: typeof id === "number" ? String(id) : id,
    profile,
    companyId
  };

  return next();
};

export default isAuth;
