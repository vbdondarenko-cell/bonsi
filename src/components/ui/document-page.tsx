import type { ReactNode } from "react";
import { Container } from "@/components/ui/container";

/** Типова сторінка-документ (умови, політики): заголовок, примітка й нумеровані розділи. */
export function DocumentPage({ title, note, sections }: { title: string; note?: ReactNode; sections: Array<{ title: string; body: ReactNode }> }) {
  return (
    <Container className="max-w-3xl pb-24 pt-20 sm:pt-28">
      <p className="font-mono text-xs uppercase tracking-[0.2em] text-accent-soft">Документи</p>
      <h1 className="mt-4 text-balance text-3xl font-semibold tracking-tight sm:text-5xl">{title}</h1>
      {note ? <p className="mt-4 rounded-xl border border-line bg-surface p-4 text-sm leading-relaxed text-muted">{note}</p> : null}
      <div className="mt-12 space-y-10 leading-relaxed text-muted">
        {sections.map((s) => (
          <section key={s.title}>
            <h2 className="mb-3 text-xl font-semibold text-fg">{s.title}</h2>
            {s.body}
          </section>
        ))}
      </div>
    </Container>
  );
}
