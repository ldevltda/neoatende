import IORedis, { RedisOptions } from "ioredis";
import dns from "node:dns";

type BucketState = { tokens: number; ts: number };

let _redis: IORedis | null = null;
let _redisHealthy = false;
const memBuckets = new Map<string, BucketState>();

async function preResolve(url: URL) {
  try {
    const all = await dns.promises.lookup(url.hostname, { all: true });
    const pick = all.find(a => a.family === 6) || all.find(a => a.family === 4);
    if (!pick) return null;
    return { host: pick.address, port: Number(url.port || 6379) };
  } catch {
    return null;
  }
}

async function buildRedisFromEnv(): Promise<IORedis | null> {
  const raw = process.env.REDIS_URL || process.env.REDIS_URI_CONNECTION;
  if (!raw) return null;

  let url: URL;
  try { url = new URL(raw); } catch { return null; }

  const pr = await preResolve(url); // pode ser null (sem problema)
  const tls = url.protocol === "rediss:";

  const baseOpts: RedisOptions = {
    host: pr?.host || url.hostname,
    port: pr?.port || Number(url.port || 6379),
    username: url.username || undefined,
    password: url.password || undefined,
    tls: tls ? {} : undefined,
    maxRetriesPerRequest: 2,
    enableReadyCheck: false,
    retryStrategy(times) { return Math.min(1000 * times, 15000); },
    reconnectOnError(err) { return /READONLY|ETIMEDOUT|ECONNRESET|ENOTFOUND/i.test(err.message); }
  };

  const client = new IORedis(baseOpts);
  client.on("ready", () => (_redisHealthy = true));
  client.on("error", () => (_redisHealthy = false)); // consome erro para não derrubar o processo
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
