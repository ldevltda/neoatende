// backend/src/config/redis.ts
import IORedis, { RedisOptions } from "ioredis";

/**
 * Pega a URL do Redis. Suporta nomes diferentes usados no projeto.
 */
export function getRedisUrl(): string {
  const url =
    process.env.REDIS_URL ||
    process.env.REDIS_URI ||
    process.env.REDIS_URI_CONNECTION ||
    "";
  if (!url) {
    throw new Error(
      "Redis URL não encontrada. Defina REDIS_URL no ambiente (.env)."
    );
  }
  return url.trim();
}

/**
 * Faz o parse manual da URL para criarmos o client com host/port e,
 * assim, aplicarmos TLS quando precisar.
 */
export function parseRedisUrl(urlStr: string) {
  const u = new URL(urlStr);
  const useTls =
    u.protocol === "rediss:" || process.env.REDIS_TLS === "1" ? true : false;
  const host = u.hostname;
  const port = Number(u.port || 6379);
  const username = decodeURIComponent(u.username || "default");
  const password = decodeURIComponent(u.password || "");

  return { host, port, username, password, useTls };
}

/**
 * Opções robustas para rodar no Fly + Upstash (ioredis):
 * - enableReadyCheck: false
 * - maxRetriesPerRequest: null (requisito do Bull)
 * - retryStrategy: backoff exponencial até 30s
 * - connectTimeout: 10s
 * - tls: {} quando for rediss://
 */
export function getIORedisOptions(): RedisOptions {
  const { host, port, username, password, useTls } = parseRedisUrl(
    getRedisUrl()
  );

  const opts: RedisOptions = {
    host,
    port,
    username,
    password,
    enableReadyCheck: false,
    maxRetriesPerRequest: null as any,
    connectTimeout: 10_000,
    retryStrategy: (times: number) => Math.min(1000 * 2 ** times, 30000)
  };

  if (useTls) {
    // Upstash TLS
    opts.tls = { servername: host };
  }

  return opts;
}

/**
 * Helper para o Bull: devolve a factory createClient com as MESMAS opções
 * para client/subscriber/bclient.
 */
export function makeBullCreateClient() {
  const url = getRedisUrl();
  const base = getIORedisOptions();
  const parsed = parseRedisUrl(url);

  // Criamos via objeto (host/port/username/password) para garantir TLS etc.
  const conn: RedisOptions = {
    ...base,
    host: parsed.host,
    port: parsed.port,
    username: parsed.username,
    password: parsed.password
  };

  return (_type: "client" | "subscriber" | "bclient") => new IORedis(conn);
}

/**
 * Verifica rapidamente se o Redis está acessível (PING com timeout).
 * Útil para falhar cedo se host/env estiver errado.
 */
export async function assertRedisReachable(timeoutMs = 8000): Promise<void> {
  const client = new IORedis(getIORedisOptions());
  const timer = setTimeout(() => {
    try {
      client.disconnect();
    } catch {}
  }, timeoutMs);

  try {
    await client.ping();
  } finally {
    clearTimeout(timer);
    try {
      client.disconnect();
    } catch {}
  }
}
