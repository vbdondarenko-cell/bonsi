import { ButtonLink } from "@/components/ui/button";
import { Section } from "@/components/ui/container";
import { Reveal } from "@/components/ui/reveal";
import { SectionHeading } from "@/components/ui/section-heading";
import { faq } from "@/lib/faq";

/** FAQ-акордеон на головній, як «Залишились питання?» у 2brolab. JSON-LD лишається на /faq. */
export function FaqPreview() {
  const items = faq.slice(0, 6);

  return (
    <Section id="faq">
      <div className="grid gap-10 lg:grid-cols-[minmax(0,4fr)_minmax(0,7fr)] lg:gap-16">
        <Reveal>
          <SectionHeading eyebrow="FAQ" title="Залишились питання?" />
          <ButtonLink href="/faq" variant="ghost" className="mt-8 w-full sm:w-auto">
            Усі питання
          </ButtonLink>
        </Reveal>
        <Reveal delay={0.08}>
          <div className="divide-y divide-line rounded-[var(--radius-card)] border border-line bg-surface">
            {items.map((item) => (
              <details key={item.q} className="group">
                <summary className="flex min-h-14 cursor-pointer list-none items-center justify-between gap-4 px-5 py-4 text-base font-medium focus-visible:outline-2 focus-visible:outline-offset-[-2px] sm:px-6 sm:text-lg [&::-webkit-details-marker]:hidden">
                  {item.q}
                  <span
                    aria-hidden="true"
                    className="font-mono text-xl text-accent-soft transition-transform duration-200 group-open:rotate-45 motion-reduce:transition-none"
                  >
                    +
                  </span>
                </summary>
                <p className="px-5 pb-5 leading-relaxed text-muted sm:px-6">{item.a}</p>
              </details>
            ))}
          </div>
        </Reveal>
      </div>
    </Section>
  );
}
