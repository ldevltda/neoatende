import dotenv from "dotenv";
dotenv.config();

const isProd = process.env.NODE_ENV === "production";

// 1ª prioridade: URL direta por secret
let url =
  (process.env.REDIS_URL || process.env.REDIS_URI_CONNECTION || "").trim();

// Em produção: se não tem URL, não usa Redis.
// Em dev: ainda deixamos o fallback local.
if (!url && !isProd) {
  const host = process.env.REDIS_HOST || "redis";
  const port = process.env.REDIS_PORT || "6379";
  const db = process.env.REDIS_DB || "0";
  url = `redis://${host}:${port}/${db}`;
}

export const REDIS_URI_CONNECTION = url;
export const REDIS_ENABLED = Boolean(url);

export default { url };