import dotenv from "dotenv";
dotenv.config();

/**
 * Monta a URL do Redis priorizando uma única fonte:
 * 1) REDIS_URL
 * 2) REDIS_URI_CONNECTION
 * 3) Monta com REDIS_HOST/REDIS_PORT/REDIS_DB (defaults para Docker: host "redis")
 */
const REDIS_URL_ENV =
  process.env.REDIS_URL ||
  process.env.REDIS_URI_CONNECTION ||
  `redis://${process.env.REDIS_HOST || "redis"}:${process.env.REDIS_PORT || "6379"}/${process.env.REDIS_DB || "0"}`;

export const REDIS_URI_CONNECTION = REDIS_URL_ENV;

export default {
  url: REDIS_URI_CONNECTION
};
