import { Section } from "@/components/ui/container";
import { Reveal } from "@/components/ui/reveal";
import { SectionHeading } from "@/components/ui/section-heading";
import { SwipeRow } from "@/components/ui/swipe-row";
import { processSteps } from "@/lib/services";

/** Блок «Як ми працюємо»: на телефоні — карусель зі свайпом, від md — сітка 2 / 4 колонки. */
export function Process() {
  const items = processSteps.map((step, index) => (
    <Reveal key={step.title} delay={index * 0.08} className="h-full w-full">
      <div className="flex h-full flex-col gap-6 card-shadow rounded-[var(--radius-card)] border border-line bg-surface p-6 sm:gap-8 sm:p-7">
        <span className="text-5xl font-semibold leading-none tracking-[-0.04em] text-accent-soft">
          {String(index + 1).padStart(2, "0")}
        </span>
        <div>
          <h3 className="text-xl font-semibold tracking-tight">{step.title}</h3>
          <p className="mt-3 leading-relaxed text-muted">{step.text}</p>
        </div>
      </div>
    </Reveal>
  ));

  return (
    <Section tone="void">
      <Reveal>
        <SectionHeading
          eyebrow="Процес"
          title="Як ми працюємо"
          description="Чотири етапи з проміжними результатами, які ви можете переглянути й скоригувати."
        />
      </Reveal>
      <div className="mt-10 sm:mt-14">
        <SwipeRow label="Етапи роботи" items={items} listClassName="md:grid md:grid-cols-2 md:gap-4 lg:grid-cols-4" />
      </div>
    </Section>
  );
}
