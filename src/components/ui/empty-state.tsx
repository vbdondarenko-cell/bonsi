import type { ReactNode } from "react";

export function EmptyState({
  title,
  description,
  action,
  as: Heading = "h2",
}: {
  title: string;
  description: string;
  action?: ReactNode;
  /** Рівень заголовка: за замовчуванням h2, щоб не пропускати рівень після h1 сторінки. */
  as?: "h2" | "h3";
}) {
  return (
    <div className="flex flex-col items-start gap-5 rounded-[var(--radius-card)] border border-dashed border-line bg-surface/50 p-8 sm:p-12">
      <svg
        width="40"
        height="40"
        viewBox="0 0 40 40"
        fill="none"
        aria-hidden="true"
        className="text-accent-soft"
      >
        <rect x="5" y="9" width="30" height="22" rx="4" stroke="currentColor" strokeWidth="1.8" />
        <path d="M5 15h30" stroke="currentColor" strokeWidth="1.8" />
        <circle cx="10" cy="12" r="1" fill="currentColor" />
        <circle cx="14" cy="12" r="1" fill="currentColor" />
      </svg>
      <div className="max-w-xl">
        <Heading className="text-xl font-semibold tracking-tight">{title}</Heading>
        <p className="mt-3 leading-relaxed text-muted">{description}</p>
      </div>
      {action}
    </div>
  );
}
