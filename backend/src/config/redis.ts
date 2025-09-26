// backend/src/config/redis.ts
import { URL } from "node:url";
import dns from "node:dns/promises";

const pickRedisUrl = () =>
  process.env.REDIS_URL ||          // <-- sua .env terá só isso
  process.env.REDIS_URI ||          // fallbacks antigos (se existirem em algum ambiente)
  process.env.UPSTASH_REDIS_URL ||  // fallbacks antigos
  "";

/** Retorna a URL do Redis ou lança erro com mensagem clara */
export const getRedisUrl = (): string => {
  const url = pickRedisUrl();
  if (!url) {
    throw new Error(
      "Redis URL não configurada. Defina REDIS_URL no .env (ou via secret no Fly)."
    );
  }
  return url;
};

export type IORedisOptions = {
  host: string;
  port: number;
  username?: string;
  password?: string;
  tls?: Record<string, unknown>;
  connectTimeout?: number;
  maxRetriesPerRequest?: number | null;
  enableReadyCheck?: boolean;
  lazyConnect?: boolean;
};

/** Constrói opções compatíveis com ioredis/Bull a partir da URL única */
export const getIORedisOptions = (): IORedisOptions => {
  const raw = getRedisUrl();
  const u = new URL(raw);

  // Liga TLS quando for rediss:// OU domínio da Upstash
  const isTls = u.protocol === "rediss:" || /\.upstash\.io$/i.test(u.hostname);

  return {
    host: u.hostname,
    port: Number(u.port || 6379),
    username: u.username || "default",
    password: u.password || undefined,
    tls: isTls ? {} : undefined,
    connectTimeout: 20_000,
    // evita crash "MaxRetriesPerRequestError"
    maxRetriesPerRequest: null,
    // Upstash não precisa do ready check
    enableReadyCheck: false,
    lazyConnect: false,
  };
};

/** Verifica se o host resolve em DNS para falhar cedo com mensagem clara */
export const assertRedisReachable = async () => {
  const { host } = getIORedisOptions();
  await dns.lookup(host).catch((err: any) => {
    throw new Error(
      `DNS falhou para o host Redis "${host}" (${err?.code || err?.message}). ` +
      `Confirme o endpoint em .env (REDIS_URL).`
    );
  });
};
