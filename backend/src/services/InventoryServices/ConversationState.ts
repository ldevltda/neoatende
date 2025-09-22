// backend/src/services/InventoryServices/ConversationState.ts

export type AgentState = {
  mode: "smalltalk" | "inventory" | "booking";
  domain?: string;
  page: number;
  pageSize: number;
  slots: Record<string, any>;
  lastList?: any[];
  lastMapping?: Record<number, string>;
};

type TicketLike = { id: number; companyId: number };

const mem = new Map<string, AgentState>();

function keyOf(t: TicketLike) {
  return `inventory:state:${t.companyId}:${t.id}`;
}

export async function loadState(t: TicketLike): Promise<AgentState | null> {
  return mem.get(keyOf(t)) ?? null;
}

export async function saveState(t: TicketLike, s: AgentState): Promise<void> {
  mem.set(keyOf(t), s);
}

export async function clearState(t: TicketLike): Promise<void> {
  mem.delete(keyOf(t));
}
