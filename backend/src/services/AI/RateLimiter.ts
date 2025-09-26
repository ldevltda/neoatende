// backend/src/services/AI/RateLimiter.ts
import IORedis from "ioredis";
import { getIORedisOptions } from "../../config/redis";

type BucketState = { tokens: number; ts: number };

let _redis: IORedis | null = null;
let _redisHealthy = false;
const memBuckets = new Map<string, BucketState>();

async function buildRedisFromEnv(): Promise<IORedis | null> {
  const url = process.env.REDIS_URL;
  if (!url) return null;

  const client = new IORedis(getIORedisOptions());
  client.on("ready", () => (_redisHealthy = true));
  client.on("error", () => (_redisHealthy = false)); // não derruba o processo
  return client;
}

async function getRedis(): Promise<IORedis | null> {
  if (_redis) return _redis;
  _redis = await buildRedisFromEnv();
  return _redis;
}

export class RateLimiter {
  private capacity: number;
  private refillPerSec: number;
  private mode: "redis" | "memory" | "off";

  constructor(capacity = 5, refillPerSec = 1) {
    this.capacity = capacity;
    this.refillPerSec = refillPerSec;
    const envMode = (process.env.AI_LIMITER_MODE || "redis").toLowerCase() as any;
    this.mode = envMode === "off" ? "off" : envMode === "memory" ? "memory" : "redis";
  }

  static forGlobal() {
    return new RateLimiter(
      Number(process.env.AI_BUCKET_CAPACITY || 5),
      Number(process.env.AI_BUCKET_REFILL || 1)
    );
  }

  async consume(key: string, tokens = 1) {
    if (this.mode === "off") return;

    if (this.mode === "redis") {
      const redis = await getRedis();
      if (redis && _redisHealthy) {
        try {
          const now = Math.floor(Date.now() / 1000);
          const stateKey = `rl:${key}`;
          const data = await redis.hmget(stateKey, "tokens", "ts");
          let cur = Number(data[0] || this.capacity);
          const last = Number(data[1] || now);
          const delta = now - last;
          cur = Math.min(this.capacity, cur + delta * this.refillPerSec);
          if (cur < tokens) throw new Error("RATE_LIMIT_EXCEEDED");
          cur -= tokens;
          await redis
            .multi()
            .hset(stateKey, "tokens", Math.floor(cur))
            .hset(stateKey, "ts", now)
            .expire(stateKey, 120)
            .exec();
          return;
        } catch {
          // se Redis falhar, cai para memória
        }
      }
      // sem redis ou unhealthy → memory
    }

    // Modo memória (ou fallback)
    const now = Math.floor(Date.now() / 1000);
    const st = memBuckets.get(key) || { tokens: this.capacity, ts: now };
    const delta = now - st.ts;
    const refilled = Math.min(this.capacity, st.tokens + delta * this.refillPerSec);
    if (refilled < tokens) throw new Error("RATE_LIMIT_EXCEEDED");
    memBuckets.set(key, { tokens: refilled - tokens, ts: now });
  }
}
