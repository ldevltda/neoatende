import dotenv from "dotenv";
dotenv.config();

/**
 * Escolhe a URL do Redis a partir de:
 * 1) REDIS_URL
 * 2) REDIS_URI_CONNECTION
 * 3) Monta com REDIS_HOST/REDIS_PORT/REDIS_DB (fallback)
 *
 * Observação: Upstash geralmente usa TLS (rediss://).
 */
const RAW_URL =
  process.env.REDIS_URL ||
  process.env.REDIS_URI_CONNECTION ||
  `redis://${process.env.REDIS_HOST || "redis"}:${process.env.REDIS_PORT || "6379"}/${process.env.REDIS_DB || "0"}`;

// Exporta a string que o restante do código usa
export const REDIS_URI_CONNECTION = RAW_URL;

export default {
  url: REDIS_URI_CONNECTION
};

// teste