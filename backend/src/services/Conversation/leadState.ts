// leadState.ts (memória curta por ticket)
type Slots = {
  city?: string | null;
  neighborhood?: string | null;
  type?: string | null;
  bedrooms?: number | null;
  priceMin?: number | null;
  priceMax?: number | null;
  hasGarage?: boolean | null;
  moment?: string | null;
  income?: number | null;
  downPayment?: number | null;
  usesFGTS?: boolean | null;
};

const _memory = new Map<number, Slots>(); // key = ticketId

export function getSlots(ticketId: number): Slots {
  return _memory.get(ticketId) || {};
}
export function mergeSlots(ticketId: number, patch: Partial<Slots>) {
  const cur = getSlots(ticketId);
  _memory.set(ticketId, { ...cur, ...patch });
}
export function slotsMissing(s: Slots) {
  const ask: string[] = [];
  if (!s.neighborhood && !s.city) ask.push("cidade ou bairro");
  if (!s.type) ask.push("tipo (apto/casa)");
  if (s.bedrooms == null) ask.push("número de dormitórios");
  if (s.priceMax == null) ask.push("faixa de preço (máximo aproximado)");
  return ask;
}
