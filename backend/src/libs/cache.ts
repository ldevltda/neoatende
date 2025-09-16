// backend/src/libs/cache.ts
import IORedis from "ioredis";
import { logger } from "../utils/logger";

const url = process.env.REDIS_URI || process.env.REDIS_URL;

let redis: IORedis | null = null;

if (url) {
  redis = new IORedis(url, {
    // Evita MaxRetriesPerRequestError “explodir” a app:
    maxRetriesPerRequest: null,       // recomendado quando usamos filas/cache
    enableReadyCheck: true,
    connectTimeout: 5000,
    retryStrategy(times) {
      // backoff progressivo até 30s
      const delay = Math.min(30000, Math.max(1000, times * 1000));
      return delay;
    }
  });

  redis.on("error", (err) => {
    logger.error(`Redis error: ${err?.message || err}`);
  });
}

const memory = new Map<string, { v: string; exp?: number }>();
const now = () => Date.now();

export const cacheLayer = {
  isReady() {
    return !!redis && redis.status === "ready";
  },
  async get(key: string): Promise<string | null> {
    try {
      if (redis && redis.status === "ready") {
        return (await redis.get(key)) as string | null;
      }
    } catch (e) {
      logger.warn(`cache.get(${key}) via redis falhou: ${(e as Error).message}`);
    }

    const item = memory.get(key);
    if (!item) return null;
    if (item.exp && item.exp < now()) {
      memory.delete(key);
      return null;
    }
    return item.v;
  },
  async set(key: string, val: string, ttlSeconds?: number) {
    try {
      if (redis && redis.status === "ready") {
        if (ttlSeconds) {
          await redis.set(key, val, "EX", ttlSeconds);
        } else {
          await redis.set(key, val);
        }
        return;
      }
    } catch (e) {
      logger.warn(`cache.set(${key}) via redis falhou: ${(e as Error).message}`);
    }

    memory.set(key, { v: val, exp: ttlSeconds ? now() + ttlSeconds * 1000 : undefined });
  },
  async del(key: string) {
    try {
      if (redis && redis.status === "ready") {
        await redis.del(key);
      }
    } catch (e) {
      logger.warn(`cache.del(${key}) via redis falhou`);
    }
    memory.delete(key);
  },
};
