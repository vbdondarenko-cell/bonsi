import type { Metadata } from "next";
import Link from "next/link";
import { Pricing } from "@/components/sections/pricing";
import { Price } from "@/components/promo/price";
import { ButtonLink } from "@/components/ui/button";
import { Container, Section } from "@/components/ui/container";
import { Reveal } from "@/components/ui/reveal";
import { SectionHeading } from "@/components/ui/section-heading";
import { services, supportPlans } from "@/lib/services";

export const metadata: Metadata = {
  title: "Ціни",
  description:
    "Стартова вартість сайтів, інтернет-магазинів, вебзастосунків, ботів і підтримки. Точну ціну узгоджуємо після брифу, до початку роботи.",
  alternates: { canonical: "/pricing" },
};

export default function PricingPage() {
  return (
    <>
      <Container className="pt-20 sm:pt-28">
        <SectionHeading
          as="h1"
          eyebrow="Ціни"
          title="Прозора вартість без сюрпризів"
          description="Нижче — стартова вартість за напрямами. Остаточну суму й терміни ми погоджуємо після брифу, до початку роботи."
        />
      </Container>

      <Pricing withHeading={false} />

      <Section id="all-services">
        <Reveal>
          <SectionHeading eyebrow="Усі напрями" title="Вартість за послугами" />
        </Reveal>
        <ul className="mt-10 divide-y divide-line overflow-hidden rounded-[var(--radius-card)] border border-line bg-surface sm:mt-12">
          {services.map((service) => (
            <li key={service.id}>
              <Link
                href={`/services#${service.id}`}
                className="flex min-h-14 flex-wrap items-center justify-between gap-x-6 gap-y-1 px-5 py-4 transition-colors [@media(hover:hover)]:hover:bg-surface-2 sm:px-7"
              >
                <span className="text-base font-medium sm:text-lg">{service.title}</span>
                <span className="font-semibold text-accent-soft"><Price label={service.priceLabel} from={service.priceFrom} /></span>
              </Link>
            </li>
          ))}
        </ul>
      </Section>

      <Section id="support-plans">
        <Reveal>
          <SectionHeading
            eyebrow="Підтримка"
            title="Пакети технічної підтримки"
            description="Щомісячний догляд за сайтом після запуску: моніторинг, резервні копії й погоджені доопрацювання."
          />
        </Reveal>
        <ul className="mt-10 grid gap-4 sm:mt-12 lg:grid-cols-3">
          {supportPlans.map((plan, index) => (
            <li key={plan.id}>
              <Reveal delay={index * 0.08} className="h-full">
                <article className="card-shadow flex h-full flex-col rounded-[var(--radius-card)] border border-line bg-surface p-6 sm:p-8">
                  <p className="font-mono text-xs uppercase tracking-[0.18em] text-accent-soft">{plan.title}</p>
                  <p className="mt-5 text-3xl font-semibold tracking-[-0.03em]">{plan.priceLabel}</p>
                  <ul className="mt-6 flex flex-col gap-3 border-t border-line pt-6 text-sm">
                    {plan.points.map((point) => (
                      <li key={point} className="flex gap-3">
                        <span aria-hidden="true" className="mt-0.5 text-accent-soft">✓</span>
                        <span>{point}</span>
                      </li>
                    ))}
                  </ul>
                </article>
              </Reveal>
            </li>
          ))}
        </ul>
        <div className="mt-12 flex flex-col items-start gap-5 rounded-[var(--radius-card)] border border-line bg-surface p-6 sm:p-10">
          <h2 className="text-2xl font-semibold tracking-tight">Не знайшли свій випадок?</h2>
          <p className="max-w-xl text-muted">Опишіть задачу, і ми підготуємо індивідуальну оцінку.</p>
          <ButtonLink href="/contact#order">Обговорити проєкт</ButtonLink>
        </div>
      </Section>
    </>
  );
}
