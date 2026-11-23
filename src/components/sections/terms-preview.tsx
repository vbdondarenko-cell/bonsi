import { ButtonLink } from "@/components/ui/button";
import { Section } from "@/components/ui/container";
import { Reveal } from "@/components/ui/reveal";
import { SectionHeading } from "@/components/ui/section-heading";

/**
 * Темний блок «Прозорі умови співпраці», як у 2brolab.
 * Тексти скорочені зі сторінки /cooperation, без нових обіцянок.
 */
const terms = [
  {
    title: "Старт після договору",
    text: "Розробка починається, коли погоджено пропозицію та договір і підтверджено передоплату, якщо вона передбачена.",
  },
  {
    title: "Обсяг не змінюється мовчки",
    text: "Нова вимога оформлюється як запит на зміну: ми оцінюємо вартість і термін, ви погоджуєте окрему додаткову угоду.",
  },
  {
    title: "Оплата за етапами",
    text: "Рахунки виставляються за етапами пропозиції. Оплатою вважається лише підтвердження студією надходження коштів.",
  },
] as const;

export function TermsPreview() {
  return (
    <Section tone="void" id="terms">
      <Reveal>
        <SectionHeading eyebrow="Умови" title="Прозорі умови співпраці" />
      </Reveal>
      <ol className="mt-12 grid gap-4 md:grid-cols-3">
        {terms.map((term, index) => (
          <li key={term.title}>
            <Reveal delay={index * 0.08} className="h-full">
              <div className="flex h-full flex-col gap-8 rounded-[var(--radius-card)] border border-line bg-surface p-6 sm:p-7">
                <span className="text-5xl font-semibold leading-none tracking-[-0.04em] text-accent-soft">
                  {String(index + 1).padStart(2, "0")}
                </span>
                <div>
                  <h3 className="text-xl font-semibold tracking-tight">{term.title}</h3>
                  <p className="mt-3 leading-relaxed text-muted">{term.text}</p>
                </div>
              </div>
            </Reveal>
          </li>
        ))}
      </ol>
      <div className="mt-10">
        <ButtonLink href="/cooperation" variant="ghost" className="w-full sm:w-auto">
          Усі умови співпраці
        </ButtonLink>
      </div>
    </Section>
  );
}
