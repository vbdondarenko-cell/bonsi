import { Section } from "@/components/ui/container";
import { Reveal } from "@/components/ui/reveal";
import { SectionHeading } from "@/components/ui/section-heading";
import { processSteps } from "@/lib/services";

export function Process() {
  return (
    <Section>
      <Reveal>
        <SectionHeading
          eyebrow="Процес"
          title="Як ми працюємо"
          description="Чотири етапи з проміжними результатами, які ви можете переглянути й скоригувати."
        />
      </Reveal>
      <ol className="mt-14 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {processSteps.map((step, index) => (
          <li key={step.title}>
            <Reveal delay={index * 0.08} className="h-full">
              <div className="flex h-full flex-col gap-8 rounded-[var(--radius-card)] border border-line p-7">
                <span className="font-mono text-sm text-accent-soft">
                  {String(index + 1).padStart(2, "0")}
                </span>
                <div>
                  <h3 className="text-xl font-semibold tracking-tight">{step.title}</h3>
                  <p className="mt-3 leading-relaxed text-muted">{step.text}</p>
                </div>
              </div>
            </Reveal>
          </li>
        ))}
      </ol>
    </Section>
  );
}
