import { Section } from "@/components/ui/container";
import { Reveal } from "@/components/ui/reveal";
import { SectionHeading } from "@/components/ui/section-heading";
import { cn } from "@/lib/cn";
import { advantages } from "@/lib/services";

const spanClass = { 2: "md:col-span-2", 3: "md:col-span-3" } as const;

export function Advantages() {
  return (
    <Section>
      <Reveal>
        <SectionHeading eyebrow="Переваги" title="Чому BONSI" />
      </Reveal>
      <ul className="mt-14 grid gap-4 md:grid-cols-6">
        {advantages.map((item, index) => (
          <li key={item.title} className={cn(spanClass[item.span])}>
            <Reveal delay={(index % 3) * 0.06} className="h-full">
              <div className="h-full rounded-[var(--radius-card)] border border-line bg-surface p-7">
                <h3 className="text-lg font-semibold tracking-tight">{item.title}</h3>
                <p className="mt-3 leading-relaxed text-muted">{item.text}</p>
              </div>
            </Reveal>
          </li>
        ))}
      </ul>
    </Section>
  );
}
