// src/**/redisClient.ts (ou o caminho do seu arquivo atual)

import Redis from "ioredis";
import crypto from "crypto";
import { logger } from "../utils/logger"; // ajuste o caminho se preciso
import { REDIS_URI_CONNECTION, REDIS_ENABLED } from "../config/redis";

/** Interface mínima que usamos do Redis */
interface IRedisLite {
  set(key: string, value: string, ...args: any[]): Promise<any>;
  get(key: string): Promise<string | null>;
  keys(pattern: string): Promise<string[]>;
  del(...keys: string[]): Promise<number>;
}

/** Cliente real (quando REDIS_ENABLED) ou um shim no-op */
let client: IRedisLite;

if (REDIS_ENABLED && REDIS_URI_CONNECTION) {
  const useTLS = REDIS_URI_CONNECTION.startsWith("rediss://");
  const redis = new Redis(
    REDIS_URI_CONNECTION,
    useTLS ? { tls: {} } : undefined
  );

  redis.on("connect", () => logger.info("[redis] conectado"));
  redis.on("error", (e) => logger.warn(`[redis] ${e.message}`));

  client = redis as unknown as IRedisLite;
} else {
  logger.warn("[redis] desabilitado (sem REDIS_URL em produção).");
  // shim seguro para produção sem Redis
  client = {
    async set() { return "OK"; },
    async get() { return null; },
    async keys() { return []; },
    async del() { return 0; }
  };
}

/** Helpers */
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
  if (option !== undefined && optionValue !== undefined) {
    // assinaturas variam; o ioredis resolve corretamente
    // @ts-ignore
    return client.set(key, value, option, optionValue);
  }
  return client.set(key, value);
}

export async function get(key: string) {
  return client.get(key);
}

export async function getKeys(pattern: string) {
  return client.keys(pattern);
}

export async function del(key: string) {
  return client.del(key);
}

export async function delFromPattern(pattern: string) {
  const all = await getKeys(pattern);
  if (!all || all.length === 0) return;
  await client.del(...all);
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
