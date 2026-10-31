import type { Metadata } from "next";
import { ButtonLink } from "@/components/ui/button";
import { Container, Section } from "@/components/ui/container";
import { Reveal } from "@/components/ui/reveal";
import { SectionHeading } from "@/components/ui/section-heading";
import { services } from "@/lib/services";

export const metadata: Metadata = {
  title: "Послуги",
  description:
    "Landing pages, корпоративні сайти, інтернет-магазини, вебзастосунки, мобільні Android/iOS-додатки, UI/UX дизайн, підтримка й модернізація.",
  alternates: { canonical: "/services" },
};

export default function ServicesPage() {
  return (
    <>
      <Container className="pt-20 sm:pt-28">
        <SectionHeading
          as="h1"
          eyebrow="Послуги"
          title="Що ми створюємо та підтримуємо"
          description="Від одного лендингу до платформи з кабінетами й мобільного додатка. Обсяг і склад робіт узгоджуємо на етапі брифу."
        />
      </Container>

      <Section>
        <ul className="flex flex-col">
          {services.map((service, index) => (
            <li key={service.id} id={service.id} className="scroll-mt-24 border-t border-line last:border-b">
              <Reveal>
                <article className="grid gap-8 py-10 md:grid-cols-[minmax(0,5fr)_minmax(0,7fr)] md:gap-16 md:py-14">
                  <div>
                    <p className="font-mono text-sm text-accent-soft">
                      {String(index + 1).padStart(2, "0")}
                    </p>
                    <h2 className="mt-4 text-3xl font-semibold tracking-tight sm:text-4xl">
                      {service.title}
                    </h2>
                    <p className="mt-4 max-w-md leading-relaxed text-muted">{service.summary}</p>
                  </div>
                  <ul className="flex flex-col gap-3 self-center">
                    {service.points.map((point) => (
                      <li
                        key={point}
                        className="rounded-2xl border border-line bg-surface px-5 py-4 text-fg"
                      >
                        {point}
                      </li>
                    ))}
                  </ul>
                </article>
              </Reveal>
            </li>
          ))}
        </ul>
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
