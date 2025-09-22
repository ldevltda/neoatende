import IORedis from "ioredis";

let _redis: IORedis | null = null;

function getRedis(): IORedis {
  if (_redis) return _redis;
  const url = process.env.REDIS_URL || process.env.REDIS_URI_CONNECTION;
  if (!url) throw new Error("REDIS_URL/REDIS_URI_CONNECTION not set");
  const isTLS = url.startsWith("rediss://");
  _redis = new IORedis(url, { tls: isTLS ? {} : undefined, maxRetriesPerRequest: 2 });
  return _redis;
}

/** Token-bucket simples por chave (ex.: ai:companyId) */
export class RateLimiter {
  private capacity: number;
  private refillPerSec: number;

  constructor(capacity = 5, refillPerSec = 1) {
    this.capacity = capacity;
    this.refillPerSec = refillPerSec;
  }

  static forGlobal() {
    return new RateLimiter(
      Number(process.env.AI_BUCKET_CAPACITY || 5),
      Number(process.env.AI_BUCKET_REFILL || 1)
    );
  }

  async consume(key: string, tokens = 1) {
    const redis = getRedis();
    const now = Math.floor(Date.now() / 1000);
    const stateKey = `rl:${key}`;
    const data = await redis.hmget(stateKey, "tokens", "ts");
    let cur = Number(data[0] || this.capacity);
    const last = Number(data[1] || now);

    // refill
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
  }
}
