import type { ReactNode } from "react";
import { cn } from "@/lib/cn";

export function Container({
  children,
  className,
}: {
  children: ReactNode;
  className?: string;
}) {
  return (
    <div className={cn("mx-auto w-full max-w-[1200px] px-5 sm:px-8", className)}>
      {children}
    </div>
  );
}

export function Section({
  id,
  children,
  className,
  tone = "light",
}: {
  id?: string;
  children: ReactNode;
  className?: string;
  /** "void" — темний контрастний блок, як у 2brolab. */
  tone?: "light" | "void";
}) {
  return (
    <section id={id} data-cb className={cn("py-16 sm:py-20 lg:py-28", tone === "void" && "theme-void", className)}>
      <Container>{children}</Container>
    </section>
  );
}
