import { Section } from "@/components/ui/container";
import { Reveal } from "@/components/ui/reveal";
import { SectionHeading } from "@/components/ui/section-heading";
import { ServiceDeck } from "@/components/sections/service-deck";
import { services } from "@/lib/services";

/** Блок «Що ми робимо»: компактна колода карток, що розкривається у ряд зі свайпом. Ціни живуть на сторінці /pricing. */
export function ServicesBento({ withHeading = true }: { withHeading?: boolean }) {
  return (
    <Section id="services">
      <div className={withHeading ? "grid grid-cols-[minmax(0,1fr)] items-center gap-6 lg:grid-cols-[minmax(0,0.85fr)_minmax(0,1.15fr)] lg:gap-14" : undefined}>
        {withHeading ? (
          <Reveal>
            <SectionHeading
              eyebrow="Послуги"
              title="Що ми робимо"
              description="Торкніться колоди, щоб розкрити всі напрями, і гортайте їх свайпом. Вартість — в окремому розділі «Ціни»."
            />
          </Reveal>
        ) : null}
        <Reveal>
          <ServiceDeck services={services} />
        </Reveal>
      </div>
    </Section>
  );
}
