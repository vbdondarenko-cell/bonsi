"use client";

import Link from "next/link";
import { useRef, useState } from "react";
import { motion, useReducedMotion } from "motion/react";
import { cn } from "@/lib/cn";
import { TiltCard } from "@/components/ui/tilt-card";
import type { Service } from "@/lib/services";

/** Як лежить картка в закритій колоді (залежить від глибини). */
const fan = [
  { rotate: 0, x: 0, y: 0 },
  { rotate: 4, x: 10, y: 8 },
  { rotate: -5, x: -8, y: 16 },
  { rotate: 8, x: 16, y: 24 },
];

/**
 * Колода карток послуг. Закрита — компактна стопка. По кліку картки «вилітають» з-за краю колоди
 * в горизонтальний ряд, який гортається свайпом (scroll-snap), стрілками або коліщатком.
 */
export function ServiceDeck({ services }: { services: Service[] }) {
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);
  const listRef = useRef<HTMLUListElement>(null);
  const reduce = useReducedMotion();
  const total = services.length;

  function onScroll() {
    const list = listRef.current;
    const first = list?.firstElementChild as HTMLElement | null | undefined;
    if (!list || !first) return;
    const step = first.getBoundingClientRect().width;
    setActive(Math.min(total - 1, Math.max(0, Math.round(list.scrollLeft / step))));
  }

  function scrollByCard(direction: 1 | -1) {
    const list = listRef.current;
    const first = list?.firstElementChild as HTMLElement | null | undefined;
    if (!list || !first) return;
    list.scrollBy({ left: direction * first.getBoundingClientRect().width, behavior: reduce ? "auto" : "smooth" });
  }

  function toggle() {
    const next = !open;
    if (!next && listRef.current) listRef.current.scrollLeft = 0;
    setActive(0);
    setOpen(next);
  }

  return (
    <div>
      <div className="relative">
        <ul
          ref={listRef}
          onScroll={onScroll}
          data-allow-overflow
          aria-label="Послуги"
          inert={!open}
          className={cn(
            "-mx-5 flex px-5 py-8 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden sm:-mx-8 sm:px-8 lg:mx-0 lg:px-4",
            open ? "snap-x snap-mandatory overflow-x-auto scroll-px-5 sm:scroll-px-8 lg:scroll-px-4" : "overflow-hidden",
          )}
        >
          {services.map((service, index) => {
            const f = fan[Math.min(index, fan.length - 1)];
            const hidden = !open && index > fan.length - 1;
            return (
              <motion.li
                key={service.id}
                initial={false}
                animate={{ x: open ? "0%" : `${-index * 100}%` }}
                transition={
                  reduce
                    ? { duration: 0 }
                    : { type: "spring", stiffness: 170, damping: 22, delay: open ? index * 0.05 : (total - index) * 0.02 }
                }
                style={{ zIndex: total - index }}
                className="flex w-[84%] shrink-0 snap-center sm:w-[56%] md:w-[340px]"
              >
                <motion.div
                  initial={false}
                  animate={{
                    rotate: open ? 0 : f.rotate,
                    x: open ? 0 : f.x,
                    y: open ? 0 : f.y,
                    opacity: hidden ? 0 : 1,
                  }}
                  transition={reduce ? { duration: 0 } : { type: "spring", stiffness: 160, damping: 20 }}
                  className="h-full w-full px-2"
                >
                  <TiltCard className="h-full" max={open ? 5 : 0}>
                    <Link
                      href={`/services#${service.id}`}
                      className="group flex h-full min-h-56 flex-col justify-between gap-8 rounded-[var(--radius-card)] card-shadow border border-line bg-surface p-6 transition-[border-color,transform] duration-300 sm:p-7 [@media(hover:hover)]:hover:border-accent-soft/70"
                    >
                      <div>
                        <p className="font-mono text-xs uppercase tracking-[0.16em] text-accent-soft">
                          {String(index + 1).padStart(2, "0")} / {String(total).padStart(2, "0")}
                        </p>
                        <h3 className="mt-3 text-xl font-semibold tracking-tight">{service.title}</h3>
                        <p className="mt-3 leading-relaxed text-muted">{service.summary}</p>
                      </div>
                      <span className="inline-flex items-center gap-2 font-mono text-xs uppercase tracking-[0.16em] text-accent-soft">
                        Детальніше
                        <span aria-hidden="true" className="transition-transform duration-300 group-hover:translate-x-1">
                          →
                        </span>
                      </span>
                    </Link>
                  </TiltCard>
                </motion.div>
              </motion.li>
            );
          })}
        </ul>

        {!open ? (
          <button
            type="button"
            onClick={toggle}
            aria-expanded={false}
            aria-label={`Розкрити колоду: ${total} послуг`}
            className="absolute inset-0 z-50 cursor-pointer rounded-[var(--radius-card)] focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-accent-soft"
          >
            <span className="pointer-events-none absolute bottom-2 left-1/2 -translate-x-1/2 whitespace-nowrap rounded-full border border-line bg-surface px-4 py-2 font-mono text-xs uppercase tracking-[0.16em] text-accent-soft card-shadow">
              Торкніться, щоб розкрити · {total} послуг
            </span>
          </button>
        ) : null}
      </div>

      {open ? (
        <div className="mt-2 flex items-center justify-between gap-4">
          <p className="font-mono text-xs uppercase tracking-[0.16em] text-muted" aria-live="polite">
            {active + 1} / {total}
            <span className="hidden sm:inline"> · свайпайте →</span>
          </p>
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => scrollByCard(-1)}
              disabled={active === 0}
              aria-label="Попередня послуга"
              className="grid h-10 w-10 place-items-center rounded-full border border-line bg-surface text-lg transition-colors hover:border-accent-soft/70 disabled:opacity-40"
            >
              ←
            </button>
            <button
              type="button"
              onClick={() => scrollByCard(1)}
              disabled={active === total - 1}
              aria-label="Наступна послуга"
              className="grid h-10 w-10 place-items-center rounded-full border border-line bg-surface text-lg transition-colors hover:border-accent-soft/70 disabled:opacity-40"
            >
              →
            </button>
            <button
              type="button"
              onClick={toggle}
              aria-expanded
              className="h-10 rounded-full border border-line bg-surface px-4 font-mono text-xs uppercase tracking-[0.16em] text-muted transition-colors hover:border-accent-soft/70"
            >
              Згорнути
            </button>
          </div>
        </div>
      ) : null}
    </div>
  );
}
