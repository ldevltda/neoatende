// backend/src/libs/cache.ts
import IORedis from "ioredis";
import { getIORedisOptions } from "../config/redis";
import * as crypto from "crypto";

/**
 * Cliente redis lazy, usando as MESMAS opções centralizadas do projeto.
 */
let redisPromise: Promise<IORedis> | null = null;

async function createRedis(): Promise<IORedis> {
  const client = new IORedis(getIORedisOptions());

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

function encryptParams(params: unknown) {
  const str = JSON.stringify(params);
  return crypto.createHash("sha256").update(str).digest("base64");
}

export async function setFromParams(
  key: string,
  params: unknown,
  value: string,
  option?: "EX" | "PX" | "EXAT" | "PXAT" | "NX" | "XX" | "KEEPTTL",
  optionValue?: string | number
) {
  const finalKey = `${key}:${encryptParams(params)}`;
  return set(finalKey, value, option as any, optionValue as any);
}

export async function getFromParams(key: string, params: unknown) {
  const finalKey = `${key}:${encryptParams(params)}`;
  return get(finalKey);
}

export async function delFromParams(key: string, params: unknown) {
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
