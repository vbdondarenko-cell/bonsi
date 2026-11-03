export type OrderEvent = { id: number; actor_id: string | null; type: string; data: Record<string, string | null>; created_at: string };
export type OrderNote = { id: string; author_id: string | null; body: string; created_at: string };
export type OrderSnapshot = {
  id: string;
  status: string;
  assigned_to: string | null;
  order_events: OrderEvent[];
  order_notes: OrderNote[];
};

// Every order mutation appends an event in the same transaction. An older RSC
// refresh or action response must never replace a newer confirmed snapshot.
export function orderRevision(snapshot: OrderSnapshot): number {
  return Math.max(0, ...snapshot.order_events.map((event) => event.id));
}

export function newerOrderSnapshot(current: OrderSnapshot, incoming: OrderSnapshot): OrderSnapshot {
  if (incoming.id !== current.id) return current;
  return orderRevision(incoming) > orderRevision(current) ? incoming : current;
}
