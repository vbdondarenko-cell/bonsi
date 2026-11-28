
import type { Metadata } from "next";
import { JsonLd } from "@/components/seo/json-ld";
import { ButtonLink } from "@/components/ui/button";
import { Container, Section } from "@/components/ui/container";
import { Reveal } from "@/components/ui/reveal";
import { Price } from "@/components/ui/price";
import { SectionHeading } from "@/components/ui/section-heading";
import { servicesJsonLd } from "@/lib/seo";
import { services, supportPlans } from "@/lib/services";

export const metadata: Metadata = {
  title: "Розробка сайтів, магазинів і вебзастосунків — послуги BONSI",
  description:
    "Послуги BONSI Studios: landing page від 3 000 ₴, сайти для бізнесу, інтернет-магазини, вебзастосунки, Telegram-боти, UI/UX та технічна підтримка.",
  alternates: { canonical: "/services" },
};

export default function ServicesPage() {
  return (
    <>
      <JsonLd data={servicesJsonLd()} />
      <Container className="pt-20 sm:pt-28">
        <SectionHeading
          as="h1"
          eyebrow="Послуги"
          title="Сайти та цифрові продукти для вашого бізнесу"
          description="Оберіть потрібний формат, перегляньте стартову вартість і склад робіт. Фінальну ціну визначаємо після короткого брифу та узгодження технічного завдання."
        />
      </Container>

      <Section>
        <ul className="grid gap-4 md:grid-cols-2">
          {services.filter((service) => service.id !== "support").map((service, index) => (
            <li key={service.id} id={service.id} className="scroll-mt-24">
              <Reveal delay={(index % 2) * 0.05} className="h-full">
                <article className="group flex h-full flex-col rounded-[var(--radius-card)] border border-line bg-surface p-6 transition-[border-color,background-color,transform] duration-300 hover:-translate-y-1 hover:border-accent-soft/60 hover:bg-surface-2 motion-reduce:hover:translate-y-0 sm:p-8">
                  <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
                    <div className="min-w-0">
                      <p className="font-mono text-xs uppercase tracking-[0.16em] text-accent-soft">
                        {String(index + 1).padStart(2, "0")} / Послуга
                      </p>
                      <h2 className="mt-4 text-2xl font-semibold tracking-tight sm:text-3xl">{service.title}</h2>
                    </div>
                    <p className="self-start rounded-full border border-accent-soft/30 bg-accent/10 px-3 py-2 text-sm font-semibold text-accent-soft lg:shrink-0 sm:px-4 sm:text-base">
                      <Price label={service.priceLabel} amount={service.priceFrom} />
                    </p>
                  </div>
                  <p className="mt-5 leading-relaxed text-muted">{service.summary}</p>
                  <p className="mt-4 text-sm leading-relaxed text-fg/85">
                    <span className="font-medium">Підійде: </span>{service.audience}
                  </p>
                  <ul className="mt-6 flex flex-col gap-3">
                    {service.points.map((point) => (
                      <li key={point} className="flex gap-3 rounded-xl border border-line bg-bg/50 px-4 py-3 text-sm leading-relaxed text-fg/90">
                        <span aria-hidden="true" className="mt-0.5 text-accent-soft">✦</span>
                        <span>{point}</span>
                      </li>
                    ))}
                  </ul>
                  <p className="mt-5 text-sm leading-relaxed text-muted">
                    <span className="font-medium text-fg">Результат: </span>{service.outcome}
                  </p>
                  <ButtonLink href={`/contact?service=${service.id}#order`} className="mt-7 self-start" variant="ghost">
                    Замовити послугу
                  </ButtonLink>
                </article>
              </Reveal>
            </li>
          ))}
        </ul>

        {(() => {
          const support = services.find((service) => service.id === "support")!;
          return (
            <section id="support" className="scroll-mt-24 mt-16 rounded-[var(--radius-card)] border border-line bg-surface/70 p-6 sm:mt-20 sm:p-10">
              <div className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
                <div>
                  <p className="font-mono text-xs uppercase tracking-[0.16em] text-accent-soft">10 / Супровід</p>
                  <h2 className="mt-3 text-3xl font-semibold tracking-tight">{support.title}</h2>
                  <p className="mt-4 max-w-2xl leading-relaxed text-muted">{support.summary} {support.audience}</p>
                </div>
                <p className="text-xl font-semibold text-accent-soft">від 500 ₴/міс.</p>
              </div>
              <ul className="mt-8 grid gap-4 lg:grid-cols-3">
                {supportPlans.map((plan) => (
                  <li key={plan.id}>
                    <article className="flex h-full flex-col rounded-2xl border border-line bg-bg/60 p-5 sm:p-6">
                      <h3 className="text-xl font-semibold">{plan.title}</h3>
                      <p className="mt-3 text-2xl font-semibold tracking-tight text-accent-soft"><Price label={plan.priceLabel} amount={plan.price} /></p>
                      <ul className="mt-5 flex flex-col gap-3 text-sm leading-relaxed text-muted">
                        {plan.points.map((point) => <li key={point}>{point}</li>)}
                      </ul>
                      <ButtonLink href={`/contact?service=support&package=${plan.id}#order`} className="mt-7 self-start" variant="ghost">
                        Обрати пакет
                      </ButtonLink>
                    </article>
                  </li>
                ))}
              </ul>
              <p className="mt-6 max-w-3xl text-sm leading-relaxed text-muted">
                Пакети включають лише зазначений обсяг. Додаткові роботи узгоджуємо окремо; цілодобова та необмежена підтримка не входить.
              </p>
              <p className="mt-4 text-sm text-muted"><span className="font-medium text-fg">Результат: </span>{support.outcome}</p>
            </section>
          );
        })()}
        <div className="mt-14 flex flex-col items-start gap-5 rounded-[var(--radius-card)] border border-line bg-surface p-8 sm:p-10">
          <h2 className="text-2xl font-semibold tracking-tight">Не знайшли свій випадок?</h2>
          <p className="max-w-xl text-muted">
            Опишіть задачу своїми словами — ми підкажемо, який формат підійде.
          </p>
          <ButtonLink href="/contact">Обговорити проєкт</ButtonLink>
        </div>
      </Section>
    </>
  );
}
