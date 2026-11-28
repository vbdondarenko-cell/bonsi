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
    <span className="inline-flex flex-wrap items-baseline gap-x-2 gap-y-1 leading-tight">
      <span>{sale}</span>
      <s className="text-sm font-normal text-muted sm:text-base">{label}</s>
      <span className="rounded-full bg-accent px-2.5 py-0.5 text-xs font-medium tracking-normal text-white">
        −{promo.discountPercent}% · {promo.label}
      </span>
    </span>
  );
}
