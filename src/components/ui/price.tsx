"use client";

import { useSyncExternalStore } from "react";
import { discountedAmount, getActivePromo, replaceAmountInLabel } from "@/lib/promo";

const subscribe = () => () => {};

/** Ціна зі святковою знижкою. Рахується в браузері за поточною датою, тож працює і на статичних сторінках. */
export function Price({ label, amount }: { label: string; amount: number | null }) {
  const promoId = useSyncExternalStore(
    subscribe,
    () => getActivePromo()?.id ?? null,
    () => null, // на сервері й до гідратації — звичайна ціна
  );
  const promo = promoId ? getActivePromo() : null;

  if (!promo || amount == null) return <>{label}</>;

  const sale = replaceAmountInLabel(label, discountedAmount(amount, promo.discountPercent));
  return (
    <span className="inline-flex flex-wrap items-baseline gap-x-2">
      <span>{sale}</span>
      <s className="text-[0.6em] font-normal text-muted">{label}</s>
      <span className="rounded-full bg-accent px-2 py-0.5 text-[0.55em] font-medium text-white no-underline">
        −{promo.discountPercent}% · {promo.label}
      </span>
    </span>
  );
}
