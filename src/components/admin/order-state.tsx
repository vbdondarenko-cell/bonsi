"use client";

import { createContext, useContext, useState, type ReactNode } from "react";
import { newerOrderSnapshot, type OrderSnapshot } from "@/lib/admin/order-snapshot";
import { STATUS_LABELS, type OrderStatus } from "@/lib/admin/orders";
import { StatusBadge, formatDateTime } from "@/components/admin/ui";

type OrderContext = { snapshot: OrderSnapshot; apply: (snapshot: OrderSnapshot) => void; who: (id: string | null) => string };
const Context = createContext<OrderContext | null>(null);

export function OrderStateProvider({ initial, admins, children }: {
  initial: OrderSnapshot;
  admins: Array<{ user_id: string; display_name: string }>;
  children: ReactNode;
}) {
  const [confirmed, setConfirmed] = useState(initial);
  const snapshot = newerOrderSnapshot(confirmed, initial);
  // Retain newer server props too, so a subsequent stale refresh cannot undo them.
  if (snapshot !== confirmed) setConfirmed(snapshot);
  const who = (id: string | null) => id ? admins.find((a) => a.user_id === id)?.display_name ?? "Адміністратор" : "Система";
  return <Context.Provider value={{ snapshot, who, apply: (next) => setConfirmed((old) => newerOrderSnapshot(old, next)) }}>{children}</Context.Provider>;
}

export function useOrderState() {
  const context = useContext(Context);
  if (!context) throw new Error("OrderStateProvider is required");
  return context;
}

export function OrderStatusBadge() {
  const { snapshot } = useOrderState();
  return <span data-testid="order-status"><StatusBadge status={snapshot.status} /></span>;
}

export function OrderHistory() {
  const { snapshot, who } = useOrderState();
  const label = (value: string | null) => value ? STATUS_LABELS[value as OrderStatus] ?? value : "—";
  return <ol data-testid="order-history" className="flex flex-col gap-4 border-l border-line pl-5">
    {[...snapshot.order_events].sort((a, b) => b.id - a.id).map((event) => {
      const description = event.type === "created" ? "Заявку створено з форми на сайті"
        : event.type === "status_changed" ? `Статус: ${label(event.data.from)} → ${label(event.data.to)}`
        : event.type === "assigned" ? event.data.to ? `Призначено: ${who(event.data.to)}` : "Виконавця знято"
        : event.type === "note_added" ? "Додано нотатку" : event.type;
      return <li key={event.id} data-event-id={event.id} className="relative">
        <span aria-hidden="true" className="absolute -left-[1.45rem] top-1.5 size-2 rounded-full bg-accent-soft" />
        <p className="text-sm">{description}</p>
        <p className="text-xs text-muted">{who(event.actor_id)} · {formatDateTime(event.created_at)}</p>
      </li>;
    })}
  </ol>;
}

export function OrderNotes() {
  const { snapshot, who } = useOrderState();
  return <ul className="mt-6 flex flex-col gap-4">
    {snapshot.order_notes.length === 0 ? <li className="text-sm text-muted">Нотаток ще немає.</li> :
      [...snapshot.order_notes].sort((a, b) => b.created_at.localeCompare(a.created_at)).map((note) => <li key={note.id} className="rounded-xl border border-line bg-surface-2/60 p-4">
        <p className="whitespace-pre-wrap break-words">{note.body}</p>
        <p className="mt-2 text-xs text-muted">{who(note.author_id)} · {formatDateTime(note.created_at)}</p>
      </li>)}
  </ul>;
}
