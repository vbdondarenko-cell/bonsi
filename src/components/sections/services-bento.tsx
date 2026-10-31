import Link from "next/link";
import { Section } from "@/components/ui/container";
import { Reveal } from "@/components/ui/reveal";
import { SectionHeading } from "@/components/ui/section-heading";
import { cn } from "@/lib/cn";
import { services } from "@/lib/services";

const spanClass = { 2: "md:col-span-2", 3: "md:col-span-3" } as const;

export function ServicesBento({ withHeading = true }: { withHeading?: boolean }) {
  return (
    <Section id="services">
      {withHeading ? (
        <Reveal>
          <SectionHeading
            eyebrow="Послуги"
            title="Що ми робимо"
            description="Оберіть напрям — детальніше про склад робіт і результат ми розповімо на сторінці послуг."
          />
        </Reveal>
      ) : null}
      <ul className={cn("grid gap-4 md:grid-cols-6", withHeading && "mt-14")}>
        {services.map((service, index) => (
          <li key={service.id} className={spanClass[service.span]}>
            <Reveal delay={(index % 3) * 0.06} className="h-full">
              <Link
                href={`/services#${service.id}`}
                className="group flex h-full min-h-56 flex-col justify-between gap-10 rounded-[var(--radius-card)] border border-line bg-surface p-7 transition-[border-color,background-color,transform] duration-300 hover:-translate-y-1 hover:border-accent-soft/70 hover:bg-surface-2 motion-reduce:hover:translate-y-0"
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
            </Reveal>
          </li>
        ))}
      </ul>
    </Section>
  );
}
