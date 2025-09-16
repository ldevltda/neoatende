// backend/src/libs/cache.ts
import IORedis from "ioredis";
import { REDIS_URI_CONNECTION } from "../config/redis";
import * as crypto from "crypto";
import { logger } from "../utils/logger";

let client: IORedis | null = null;

function buildRedis(): IORedis | null {
  if (!REDIS_URI_CONNECTION) {
    logger.warn("Redis desabilitado (REDIS_URI/REDIS_URL não definido). Usando memória.");
    return null;
  }

  const isTLS = REDIS_URI_CONNECTION.startsWith("rediss://");

  const redis = new IORedis(REDIS_URI_CONNECTION, {
    // resiliente: não lança MaxRetriesPerRequestError
    maxRetriesPerRequest: null,
    enableReadyCheck: true,
    // backoff progressivo
    retryStrategy: (times) => Math.min(30000, Math.max(1000, times * 1000)),
    // não force família de IP — deixa o Node escolher (v4/v6)
    // se Upstash exigir TLS, isso ativa automaticamente
    ...(isTLS ? { tls: {} as any } : {}),
  });

  redis.on("ready", () => logger.info("[redis] ready"));
  redis.on("connect", () => logger.info("[redis] connect"));
  redis.on("reconnecting", () => logger.warn("[redis] reconnecting"));
  redis.on("end", () => logger.warn("[redis] end"));
  redis.on("error", (e) => logger.error(`[redis] ${e?.message || e}`));

  return redis;
}

function getRedis(): IORedis | null {
  if (client) return client;
  client = buildRedis();
  return client;
}

// ------- util de chave derivada de parâmetros
function encryptParams(params: any) {
  const str = JSON.stringify(params);
  return crypto.createHash("sha256").update(str).digest("base64");
}

// ------- fallback em memória quando Redis não está ready
const memory = new Map<string, { v: string; exp?: number }>();
const now = () => Date.now();

async function setMem(key: string, value: string, ttl?: number) {
  memory.set(key, { v: value, exp: ttl ? now() + ttl * 1000 : undefined });
}
async function getMem(key: string) {
  const item = memory.get(key);
  if (!item) return null;
  if (item.exp && item.exp < now()) {
    memory.delete(key);
    return null;
  }
  return item.v;
}
async function delMem(key: string) {
  memory.delete(key);
}
async function keysMem(pattern: string) {
  const regex = new RegExp("^" + pattern.replace("*", ".*") + "$");
  return Array.from(memory.keys()).filter((k) => regex.test(k));
}

// ------- API pública (mesma do seu projeto)
export async function set(
  key: string,
  value: string,
  option?: "EX" | "PX" | "EXAT" | "PXAT" | "NX" | "XX" | "KEEPTTL",
  optionValue?: string | number
) {
  const r = getRedis();
  if (r && r.status === "ready") {
    if (option !== undefined && optionValue !== undefined) {
      // @ts-ignore variações aceitas pelo ioredis
      return r.set(key, value, option, optionValue);
    }
    return r.set(key, value);
  }

  // fallback memória (suporta EX em segundos)
  if (option === "EX" && typeof optionValue === "number") {
    return setMem(key, value, optionValue as number);
  }
  return setMem(key, value);
}

export async function get(key: string) {
  const r = getRedis();
  if (r && r.status === "ready") {
    return r.get(key);
  }
  return getMem(key);
}

export async function getKeys(pattern: string) {
  const r = getRedis();
  if (r && r.status === "ready") {
    return r.keys(pattern);
  }
  return keysMem(pattern);
}

export async function del(key: string) {
  const r = getRedis();
  if (r && r.status === "ready") {
    return r.del(key);
  }
  return delMem(key);
}

export async function delFromPattern(pattern: string) {
  const r = getRedis();
  if (r && r.status === "ready") {
    const all = await r.keys(pattern);
    if (all && all.length) await r.del(...all);
    return;
  }
  const all = await keysMem(pattern);
  for (const k of all) memory.delete(k);
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

export const cacheLayer = {
  set,
  setFromParams,
  get,
  getFromParams,
  getKeys,
  del,
  delFromParams,
  delFromPattern,
};
