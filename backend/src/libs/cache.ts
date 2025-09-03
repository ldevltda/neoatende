import IORedis, { RedisOptions } from "ioredis";
import { REDIS_URI_CONNECTION } from "../config/redis";
import * as crypto from "crypto";
import dns from "dns/promises";

/**
 * Criamos o cliente Redis de forma lazy (on-demand) para:
 * - Resolver o hostname para IPv6 (AAAA), que é o que o Fly expõe no nslookup
 * - Habilitar TLS automaticamente quando a URL for rediss://
 * - Usar opções de reconexão estáveis
 */

let redisPromise: Promise<IORedis> | null = null;

async function createRedis(): Promise<IORedis> {
  // Faz o parse da URL (funciona para redis:// e rediss://)
  const u = new URL(REDIS_URI_CONNECTION);
  const isTLS = u.protocol === "rediss:";
  const port = Number(u.port || "6379");
  const username = u.username || undefined;
  const password = u.password || undefined;

  // Resolve hostname para IPv6 (AAAA) — se falhar, usa o host original
  let host = u.hostname;
  try {
    const { address } = await dns.lookup(u.hostname, { family: 6 });
    host = address;
  } catch {
    // sem drama; segue com o hostname
  }

  const options: RedisOptions = {
    host,
    port,
    username,
    password,
    // família IPv6 melhora com Fly/Upstash
    family: 6,
    // opções de robustez
    maxRetriesPerRequest: null,
    enableReadyCheck: true,
    retryStrategy: (times) => Math.min(times * 200, 2000),
    reconnectOnError: () => true,
    ...(isTLS ? { tls: {} } : {})
  };

  const client = new IORedis(options);

  // logs “amigáveis” (não derrubam o processo)
  client.on("error", (e) => {
    console.warn("[redis] " + e.message);
  });

  return client;
}

async function getRedis(): Promise<IORedis> {
  if (!redisPromise) redisPromise = createRedis();
  return redisPromise;
}

function encryptParams(params: any) {
  const str = JSON.stringify(params);
  return crypto.createHash("sha256").update(str).digest("base64");
}

export async function setFromParams(
  key: string,
  params: any,
  value: string,
  option?: "EX" | "PX" | "EXAT" | "PXAT" | "NX" | "XX" | "KEEPTTL",
  optionValue?: string | number
) {
  const finalKey = `${key}:${encryptParams(params)}`;
  return set(finalKey, value, option as any, optionValue as any);
}

export async function getFromParams(key: string, params: any) {
  const finalKey = `${key}:${encryptParams(params)}`;
  return get(finalKey);
}

export async function delFromParams(key: string, params: any) {
  const finalKey = `${key}:${encryptParams(params)}`;
  return del(finalKey);
}

export async function set(
  key: string,
  value: string,
  option?: "EX" | "PX" | "EXAT" | "PXAT" | "NX" | "XX" | "KEEPTTL",
  optionValue?: string | number
) {
  const redis = await getRedis();
  if (option !== undefined && optionValue !== undefined) {
    // @ts-ignore – ioredis aceita as variações corretamente
    return redis.set(key, value, option, optionValue);
  }
  return redis.set(key, value);
}

export async function get(key: string) {
  const redis = await getRedis();
  return redis.get(key);
}

export async function getKeys(pattern: string) {
  const redis = await getRedis();
  return redis.keys(pattern);
}

export async function del(key: string) {
  const redis = await getRedis();
  return redis.del(key);
}

export async function delFromPattern(pattern: string) {
  const redis = await getRedis();
  const all = await redis.keys(pattern);
  if (!all || all.length === 0) return;
  await redis.del(...all);
}

export const cacheLayer = {
  set,
  setFromParams,
  get,
  getFromParams,
  getKeys,
  del,
  delFromParams,
  delFromPattern
};

// teste