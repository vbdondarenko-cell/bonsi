"use client";

import { useRef, useState, type ReactNode } from "react";
import { cn } from "@/lib/cn";

/**
 * Горизонтальна карусель зі свайпом на телефоні (scroll-snap) і звичайна сітка від md.
 * Економить висоту сторінки на мобільному: картки гортаються вбік, а не стоять стовпчиком.
 * `listClassName` описує розкладку від md (grid-класи), `itemClassName` — клас кожної картки на md+.
 */
export function SwipeRow({
  items,
  label,
  listClassName,
  itemClassNames,
}: {
  items: ReactNode[];
  label: string;
  listClassName?: string;
  /** Класи карток для md+ (наприклад, col-span). Масив, а не функція: пропси з сервера мають бути серіалізованими. */
  itemClassNames?: (string | undefined)[];
}) {
  const ref = useRef<HTMLUListElement>(null);
  const [active, setActive] = useState(0);

  function onScroll() {
    const list = ref.current;
    const first = list?.firstElementChild as HTMLElement | null | undefined;
    if (!list || !first) return;
    const step = first.getBoundingClientRect().width + 12;
    setActive(Math.min(items.length - 1, Math.max(0, Math.round(list.scrollLeft / step))));
  }

  return (
    <div>
      <ul
        ref={ref}
        onScroll={onScroll}
        data-allow-overflow
        aria-label={label}
        className={cn(
          "-mx-5 flex snap-x snap-mandatory gap-3 overflow-x-auto scroll-px-5 px-5 pb-2 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden",
          "sm:-mx-8 sm:scroll-px-8 sm:px-8",
          "md:mx-0 md:snap-none md:overflow-visible md:px-0 md:pb-0",
          listClassName,
        )}
      >
        {items.map((item, index) => (
          <li
            key={index}
            className={cn("flex w-[84%] shrink-0 snap-center sm:w-[56%] md:w-auto md:shrink", itemClassNames?.[index])}
          >
            {item}
          </li>
        ))}
      </ul>
      <div className="mt-4 flex justify-center gap-1.5 md:hidden" aria-hidden="true">
        {items.map((_, index) => (
          <span
            key={index}
            className={cn("h-1.5 rounded-full transition-all duration-300", index === active ? "w-6 bg-accent-soft" : "w-1.5 bg-line")}
          />
        ))}
      </div>
    </div>
  );
}
