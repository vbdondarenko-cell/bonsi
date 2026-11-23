import Link from "next/link";
import { Section } from "@/components/ui/container";
import { Reveal } from "@/components/ui/reveal";
import { SectionHeading } from "@/components/ui/section-heading";
import { SwipeRow } from "@/components/ui/swipe-row";
import { TiltCard } from "@/components/ui/tilt-card";
import { services } from "@/lib/services";

const spanClass = { 2: "md:col-span-2", 3: "md:col-span-3" } as const;

/** Блок «Що ми робимо»: на телефоні — карусель зі свайпом, від md — сітка. Ціни живуть на сторінці /pricing. */
export function ServicesBento({ withHeading = true }: { withHeading?: boolean }) {
  const items = services.map((service, index) => (
    <Reveal key={service.id} delay={(index % 3) * 0.06} className="h-full w-full">
      <TiltCard className="h-full" max={5}>
        <Link
          href={`/services#${service.id}`}
          className="group flex h-full min-h-48 flex-col justify-between gap-8 rounded-[var(--radius-card)] card-shadow border border-line bg-surface p-6 transition-[border-color,background-color,transform] duration-300 sm:min-h-56 sm:p-7 [@media(hover:hover)]:hover:-translate-y-1 [@media(hover:hover)]:hover:border-accent-soft/70 motion-reduce:hover:translate-y-0"
        >
          <div>
            <h3 className="text-xl font-semibold tracking-tight">{service.title}</h3>
            <p className="mt-3 leading-relaxed text-muted">{service.summary}</p>
          </div>
          <span className="inline-flex items-center gap-2 font-mono text-xs uppercase tracking-[0.16em] text-accent-soft">
            Детальніше
            <span
              aria-hidden="true"
              className="transition-transform duration-300 group-hover:translate-x-1 motion-reduce:transform-none"
            >
              →
            </span>
          </span>
        </Link>
      </TiltCard>
    </Reveal>
  ));

  return (
    <Section id="services">
      {withHeading ? (
        <Reveal>
          <SectionHeading
            eyebrow="Послуги"
            title="Що ми робимо"
            description="Оберіть напрям і перегляньте склад робіт на сторінці послуг. Вартість — в окремому розділі «Ціни»."
          />
        </Reveal>
      ) : null}
      <div className={withHeading ? "mt-10 sm:mt-14" : undefined}>
        <SwipeRow
          label="Послуги"
          items={items}
          listClassName="md:grid md:grid-cols-6 md:gap-4"
          itemClassNames={services.map((service) => spanClass[service.span])}
        />
      </div>
    </Section>
  );
}
