import Link from "next/link";
import { ButtonLink } from "@/components/ui/button";
import { Section } from "@/components/ui/container";
import { EmptyState } from "@/components/ui/empty-state";
import { Reveal } from "@/components/ui/reveal";
import { SectionHeading } from "@/components/ui/section-heading";
import { cases } from "@/lib/cases";

export function PortfolioPreview() {
  const featured = cases.slice(0, 3);

  return (
    <Section>
      <Reveal>
        <SectionHeading
          eyebrow="Портфоліо"
          title="Проєкти, якими ми можемо поділитися"
          description="Ми публікуємо лише реальні виконані роботи з перевіреними даними."
        />
      </Reveal>
      <div className="mt-14">
        {featured.length === 0 ? (
          <EmptyState
            title="Перші кейси зʼявляться тут"
            description="Ми ще наповнюємо портфоліо й не публікуємо вигаданих проєктів чи відгуків. Розкажіть про свою задачу — можливо, наступний кейс буде вашим."
            action={<ButtonLink href="#order">Обговорити проєкт</ButtonLink>}
          />
        ) : (
          <ul className="grid gap-4 md:grid-cols-3">
            {featured.map((item) => (
              <li key={item.slug}>
                <Link
                  href={`/portfolio/${item.slug}`}
                  className="block h-full rounded-[var(--radius-card)] border border-line bg-surface p-7 transition-colors hover:border-accent-soft/70"
                >
                  <h3 className="text-xl font-semibold tracking-tight">{item.title}</h3>
                  <p className="mt-3 leading-relaxed text-muted">{item.summary}</p>
                </Link>
              </li>
            ))}
          </ul>
        )}
      </div>
    </Section>
  );
}
