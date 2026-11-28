"use client";

import { useEffect, useState } from "react";
import { promoEndsAt } from "@/lib/promo";

type Left = { d: number; h: number; m: number; s: number } | null;

function compute(): Left {
  const diff = promoEndsAt().getTime() - Date.now();
  if (diff <= 0) return { d: 0, h: 0, m: 0, s: 0 };
  return {
    d: Math.floor(diff / 86_400_000),
    h: Math.floor(diff / 3_600_000) % 24,
    m: Math.floor(diff / 60_000) % 60,
    s: Math.floor(diff / 1000) % 60,
  };
}

const pad = (n: number) => String(n).padStart(2, "0");

/** Відлік до кінця акції. На сервері показує «––», щоб розмітка збігалась під час гідратації. */
export function Countdown({ className = "" }: { className?: string }) {
  const [left, setLeft] = useState<Left>(null);

  useEffect(() => {
    setLeft(compute());
    const id = window.setInterval(() => setLeft(compute()), 1000);
    return () => window.clearInterval(id);
  }, []);

  const cells: [string, string][] = [
    [left ? pad(left.d) : "––", "днів"],
    [left ? pad(left.h) : "––", "годин"],
    [left ? pad(left.m) : "––", "хвилин"],
    [left ? pad(left.s) : "––", "секунд"],
  ];

  return (
    <div role="timer" aria-label="До кінця акції" className={`flex gap-2 sm:gap-3 ${className}`}>
      {cells.map(([value, label]) => (
        <div key={label} className="promo-glass min-w-[4.25rem] flex-1 rounded-2xl px-3 py-3 text-center sm:min-w-[5.5rem] sm:flex-none sm:px-5 sm:py-4">
          <div className="font-mono text-2xl font-semibold tabular-nums leading-none sm:text-4xl">{value}</div>
          <div className="mt-2 text-[0.65rem] uppercase tracking-[0.18em] text-muted">{label}</div>
        </div>
      ))}
    </div>
  );
}
