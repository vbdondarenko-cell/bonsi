"use client";

import { useSyncExternalStore } from "react";
import { getActivePromo } from "@/lib/promo";

const subscribe = () => () => {};

/** true у вікні новорічної акції (6 грудня – 2 січня, Київ). На сервері й до гідратації — false. */
export function useWinter(): boolean {
  return useSyncExternalStore(
    subscribe,
    () => getActivePromo() !== null,
    () => false,
  );
}
