// backend/src/config/redis.ts
import IORedis, { RedisOptions } from "ioredis";

export function getRedisUrl(): string {
  const url = process.env.REDIS_URL || "";
  if (!url.trim()) {
    throw new Error("❌ Redis URL não encontrada. Defina REDIS_URL no ambiente (.env / secrets).");
  }
  return url.trim();
}

export function parseRedisUrl(urlStr: string) {
  const u = new URL(urlStr);
  const useTls = u.protocol === "rediss:" || process.env.REDIS_TLS === "1";
  const host = u.hostname;
  const port = Number(u.port || 6379);
  const username = decodeURIComponent(u.username || "default");
  const password = decodeURIComponent(u.password || "");
  return { host, port, username, password, useTls };
}

/**
 * Opções padronizadas para TODO cliente ioredis do projeto.
 * - integradas com Bull (enableReadyCheck=false, maxRetriesPerRequest=null)
 */
export function getIORedisOptions(): RedisOptions {
  const { host, port, username, password, useTls } = parseRedisUrl(getRedisUrl());

  const opts: RedisOptions = {
    host,
    port,
    username,
    password,
    // Bull exige:
    enableReadyCheck: false,
    maxRetriesPerRequest: null as unknown as number,
    // Estabilidade:
    connectTimeout: 10_000,
    retryStrategy: (times) => Math.min(1000 * 2 ** times, 30_000),
    // Ajuda no Fly (preferir IPv6 quando disponível):
    family: 6, // se não houver v6, o SO cai pra v4
  };

  if (useTls) {
    opts.tls = { servername: host };
  }
  return opts;
}

export function makeBullCreateClient() {
  const base = getIORedisOptions();
  return (_type: "client" | "subscriber" | "bclient") => new IORedis(base);
}

export async function assertRedisReachable(timeoutMs = 8000): Promise<void> {
  const client = new IORedis(getIORedisOptions());
  const timer = setTimeout(() => {
    try { client.disconnect(); } catch {}
  }, timeoutMs);

  try {
    await client.ping();
  } finally {
    clearTimeout(timer);
    try { client.disconnect(); } catch {}
  }
}
