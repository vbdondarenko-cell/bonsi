import type { Metadata } from "next";
import Link from "next/link";
import { ButtonLink } from "@/components/ui/button";
import { Container, Section } from "@/components/ui/container";
import { EmptyState } from "@/components/ui/empty-state";
import { SectionHeading } from "@/components/ui/section-heading";
import { cases } from "@/lib/cases";

export const metadata: Metadata = {
  title: "Портфоліо",
  description: "Виконані проєкти BONSI Studios: завдання, технології та результат.",
  alternates: { canonical: "/portfolio" },
};

export default function PortfolioPage() {
  return (
    <>
      <Container className="pt-20 sm:pt-28">
        <SectionHeading
          as="h1"
          eyebrow="Портфоліо"
          title="Кейси BONSI"
          description="Завдання, технології та результат — лише для реально виконаних проєктів."
        />
      </Container>
      <Section>
        {cases.length === 0 ? (
          <EmptyState
            title="Перші кейси зʼявляться тут"
            description="Ми не публікуємо вигаданих клієнтів, результатів чи відгуків. Щойно проєкти будуть готові до публікації, повні сторінки кейсів зʼявляться в цьому розділі."
            action={<ButtonLink href="/contact">Обговорити проєкт</ButtonLink>}
          />
        ) : (
          <ul className="grid gap-4 md:grid-cols-2">
            {cases.map((item) => (
              <li key={item.slug}>
                <Link
                  href={`/portfolio/${item.slug}`}
                  className="block h-full rounded-[var(--radius-card)] border border-line bg-surface p-8 transition-colors hover:border-accent-soft/70"
                >
                  <h2 className="text-2xl font-semibold tracking-tight">{item.title}</h2>
                  <p className="mt-3 leading-relaxed text-muted">{item.summary}</p>
                  <p className="mt-6 font-mono text-xs uppercase tracking-[0.14em] text-accent-soft">
                    {item.stack.join(" · ")}
                  </p>
                </Link>
              </li>
            ))}
          </ul>
        )}
      </Section>
    </>
  );
}
