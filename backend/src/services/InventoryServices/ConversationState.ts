import Redis from "ioredis";

export type AgentState = {
  mode: "smalltalk" | "inventory" | "booking";
  domain?: string;
  page: number;
  pageSize: number;
  slots: Record<string, any>;
  lastList?: any[];
  lastMapping?: Record<number, string>;
  loops?: number;
  lastPlannerConfidence?: number;
  updatedAt?: number;
};

type TicketLike = { id: number; companyId: number };

const mem = new Map<string, AgentState>();
let redis: Redis | undefined;

(function initRedis() {
  const url = process.env.REDIS_URL;
  if (!url) return;
  try {
    const r = new Redis(url, { lazyConnect: true, maxRetriesPerRequest: 3 } as any);
    r.on("error", () => { /* fallback silencioso */ });
    r.connect().then(() => { redis = r; }).catch(() => { redis = undefined; });
  } catch {
    redis = undefined;
  }
})();

function keyOf(t: TicketLike) {
  return `inventory:state:${t.companyId}:${t.id}`;
}

export async function loadState(t: TicketLike): Promise<AgentState | null> {
  const k = keyOf(t);
  if (redis) {
    try {
      const raw = await redis.get(k);
      return raw ? (JSON.parse(raw) as AgentState) : null;
    } catch { /* fallback */ }
  }
  return mem.get(k) ?? null;
}

export async function saveState(t: TicketLike, s: Partial<AgentState>) {
  const k = keyOf(t);
  const prev = (await loadState(t)) || ({} as AgentState);
  const val: AgentState = { ...prev, ...s, updatedAt: Date.now(), page: prev.page || 1, pageSize: prev.pageSize || 3, mode: prev.mode || "inventory", slots: { ...(prev.slots || {}), ...(s.slots || {}) } };

  if (redis) {
    try { await redis.set(k, JSON.stringify(val), "EX", 60 * 60 * 24 * 3); return; } catch { /* fallback */ }
  }
  mem.set(k, val);
}

export async function clearState(t: TicketLike) {
  const k = keyOf(t);
  if (redis) {
    try { await redis.del(k); return; } catch { /* fallback */ }
  }
  mem.delete(k);
}
