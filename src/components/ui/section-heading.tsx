import type { ReactNode } from "react";
import { cn } from "@/lib/cn";

export function SectionHeading({
  eyebrow,
  title,
  description,
  as: Tag = "h2",
  className,
}: {
  eyebrow?: string;
  title: ReactNode;
  description?: ReactNode;
  as?: "h1" | "h2";
  className?: string;
}) {
  return (
    <header className={cn("max-w-3xl", className)}>
      {eyebrow ? (
        <p className="mb-5 font-mono text-xs uppercase tracking-[0.18em] text-accent-soft">
          {eyebrow}
        </p>
      ) : null}
      <Tag className="text-[clamp(2rem,5.5vw,3.75rem)] font-semibold leading-[1.05] tracking-[-0.03em]">
        {title}
      </Tag>
      {description ? (
        <p className="mt-6 max-w-2xl text-lg leading-relaxed text-muted">{description}</p>
      ) : null}
    </header>
  );
}
