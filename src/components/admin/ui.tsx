import type { ReactNode } from "react";
import { STATUS_LABELS, type OrderStatus } from "@/lib/admin/orders";
import { cn } from "@/lib/cn";

const statusTone: Record<OrderStatus, string> = {
  new: "border-accent-soft/50 bg-accent/15 text-accent-soft",
  in_review: "border-[#e0b054]/40 bg-[#e0b054]/10 text-[#e0b054]",
  accepted: "border-ok/40 bg-ok/10 text-ok",
  in_progress: "border-[#5aa9ff]/40 bg-[#5aa9ff]/10 text-[#5aa9ff]",
  done: "border-line bg-surface-2 text-fg",
  rejected: "border-danger/40 bg-danger/10 text-danger",
};

export function StatusBadge({ status }: { status: string }) {
  const known = status in STATUS_LABELS;
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1.5 whitespace-nowrap rounded-full border px-2.5 py-1 text-xs font-medium",
        known ? statusTone[status as OrderStatus] : "border-line text-muted",
      )}
    >
      <span aria-hidden="true" className="size-1.5 rounded-full bg-current" />
      {known ? STATUS_LABELS[status as OrderStatus] : status}
    </span>
  );
}

const dateFormat = new Intl.DateTimeFormat("uk-UA", {
  dateStyle: "medium",
  timeStyle: "short",
  timeZone: "Europe/Kyiv",
});

export function formatDateTime(value: string): string {
  return dateFormat.format(new Date(value));
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
