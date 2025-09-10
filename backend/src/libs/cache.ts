import IORedis, { RedisOptions } from "ioredis";
import { REDIS_URI_CONNECTION } from "../config/redis";
import * as crypto from "crypto";

/**
 * Conexão Redis robusta:
 * - Usa a URL original (não troca hostname por IP)
 * - Habilita TLS somente quando schema for rediss://
 * - SNI correto (servername = hostname)
 * - Sem forçar IPv6
 */

let redisPromise: Promise<IORedis> | null = null;

function createRedis(): IORedis {
  if (!REDIS_URI_CONNECTION) {
    console.warn("[redis] REDIS_URI_CONNECTION não definido — cache desabilitado.");
    // cria um client “dummy” que sempre falha para evitar null checks
    // (ou você pode lançar um erro se preferir)
  }

  const u = new URL(REDIS_URI_CONNECTION);
  const isTLS = u.protocol === "rediss:";

  const baseOptions: RedisOptions = {
    // não forçar família/IP — deixe o driver resolver
    // robustez de reconexão
    maxRetriesPerRequest: null,
    enableReadyCheck: true,
    retryStrategy: (times) => Math.min(times * 200, 2000),
    reconnectOnError: () => true,
  };

  const tlsOptions: RedisOptions = isTLS
    ? {
        tls: {
          // MUITO importante para SNI: usa o hostname da URL
          servername: u.hostname,
          // alguns provedores (Upstash, proxies) exigem isso atrás de LB
          rejectUnauthorized: false,
        } as any,
      }
    : {};

  // passa a URL completa + opções
  const client = new IORedis(REDIS_URI_CONNECTION, {
    ...baseOptions,
    ...tlsOptions,
  });

  client.on("connect", () => console.info("[redis] conectado"));
  client.on("error", (e) => console.warn("[redis] " + e.message));

  return client;
}

async function getRedis(): Promise<IORedis> {
  if (!redisPromise) redisPromise = Promise.resolve(createRedis());
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
    // @ts-ignore
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
  delFromPattern,
};
