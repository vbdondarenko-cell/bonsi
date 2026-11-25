import type { ReactNode } from "react";
import { cn } from "@/lib/cn";

const dateFormat = new Intl.DateTimeFormat("uk-UA", {
  dateStyle: "medium",
  timeStyle: "short",
  timeZone: "Europe/Kyiv",
});

export function formatDateTime(value: string): string {
  return dateFormat.format(new Date(value));
}

const numberFormat = new Intl.NumberFormat("uk-UA");

export function formatNumber(value: number): string {
  return numberFormat.format(value);
}

export function PageHeader({ eyebrow, title, children }: { eyebrow: string; title: string; children?: ReactNode }) {
  return (
    <div className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
      <div>
        <p className="font-mono text-xs uppercase tracking-[0.2em] text-accent-soft">{eyebrow}</p>
        <h1 className="mt-3 text-balance text-3xl font-semibold tracking-tight sm:text-4xl">{title}</h1>
      </div>
      {children}
    </div>
  );
}

export function Panel({ title, children, className }: { title?: string; children: ReactNode; className?: string }) {
  return (
    <section className={cn("rounded-[var(--radius-card)] border border-line bg-surface/70 p-5 sm:p-6", className)}>
      {title ? <h2 className="mb-4 text-sm font-medium uppercase tracking-wider text-muted">{title}</h2> : null}
      {children}
    </section>
  );
}

export const adminFieldClass =
  "w-full min-h-11 rounded-xl border border-line bg-surface px-3.5 py-2.5 text-base text-fg " +
  "placeholder:text-muted/70 transition-colors hover:border-muted/60 focus-visible:border-accent-soft " +
  "aria-[invalid=true]:border-danger";
