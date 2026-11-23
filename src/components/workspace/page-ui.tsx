import type { ReactNode } from "react";

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

export const adminFieldClass =
  "w-full min-h-11 rounded-xl border border-line bg-surface px-3.5 py-2.5 text-base text-fg " +
  "placeholder:text-muted/70 transition-colors hover:border-muted/60 focus-visible:border-accent-soft " +
  "aria-[invalid=true]:border-danger";
