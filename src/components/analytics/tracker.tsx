"use client";

import { usePathname } from "next/navigation";
import { useEffect, useRef } from "react";
import { trackPageview } from "@/lib/analytics/client";

/** Невидимий компонент: шле перегляд сторінки при першому завантаженні й при кожному переході. */
export function Tracker() {
  const pathname = usePathname();
  const last = useRef<string | null>(null);

  useEffect(() => {
    // Строгий режим React у розробці запускає ефект двічі: той самий шлях двічі поспіль не рахуємо.
    if (last.current === pathname) return;
    last.current = pathname;
    trackPageview();
  }, [pathname]);

  return null;
}
