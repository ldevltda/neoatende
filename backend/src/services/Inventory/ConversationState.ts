// src/services/Inventory/ConversationState.ts
import { cacheLayer } from "../../libs/cache";
import Ticket from "../../models/Ticket";

export type ConvState = {
  domain?: string;
  slots?: Record<string, any>;
  page?: number;
  pageSize?: number;
};

const key = (t: Ticket) => `conv:inv:${t.companyId}:${t.id}`;

export async function loadState(ticket: Ticket): Promise<ConvState | null> {
  try {
    const raw = await cacheLayer.get(key(ticket));
    return raw ? (JSON.parse(raw) as ConvState) : null;
  } catch { return null; }
}

export async function saveState(ticket: Ticket, state: ConvState): Promise<void> {
  await cacheLayer.set(key(ticket), JSON.stringify(state), "EX", 60 * 30);
}

export async function clearState(ticket: Ticket): Promise<void> {
  await cacheLayer.del(key(ticket));
}
