import IORedis from "ioredis";
import { REDIS_URI_CONNECTION } from "../config/redis";
import * as crypto from "crypto";

/**
 * Conexão única do Redis com opções de reconexão.
 * (ioredis já retorna Promises — não precisamos de util.promisify)
 */
const redis = new IORedis(REDIS_URI_CONNECTION, {
  maxRetriesPerRequest: null,
  enableReadyCheck: true,
  retryStrategy: (times) => Math.min(times * 100, 2000),
  reconnectOnError: () => true
});

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
    // @ts-ignore - assinaturas do set variam; ioredis resolve corretamente
    return redis.set(key, value, option, optionValue);
  }
  return redis.set(key, value);
}

export async function get(key: string) {
  return redis.get(key);
}

export async function getKeys(pattern: string) {
  return redis.keys(pattern);
}

export async function del(key: string) {
  return redis.del(key);
}

export async function delFromPattern(pattern: string) {
  const all = await getKeys(pattern);
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
