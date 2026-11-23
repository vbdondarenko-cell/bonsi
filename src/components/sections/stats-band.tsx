import { Section } from "@/components/ui/container";
import { Reveal } from "@/components/ui/reveal";
import { processSteps, services } from "@/lib/services";

/**
 * Темна смуга з ключовими фактами, як блок «Два брати, які змінили систему» у 2brolab.
 * Усі цифри беруться з реальних даних сайту, нічого не вигадано. Цін тут немає: вони на /pricing.
 */
export function StatsBand() {
  const stats = [
    { value: "2", label: "розробники ведуть проєкт без посередників" },
    { value: String(processSteps.length), label: "етапи з проміжними результатами" },
    { value: String(services.length), label: "напрямів: від сайтів до мобільних застосунків" },
  ];

  return (
    <Section tone="void" className="!py-14 sm:!py-20">
      <ul className="grid grid-cols-3 gap-px overflow-hidden rounded-[var(--radius-card)] border border-line bg-line">
        {stats.map((stat, index) => (
          <li key={stat.label} className="bg-bg">
            <Reveal delay={index * 0.08} className="h-full">
              <div className="flex h-full flex-col gap-2 p-4 sm:gap-4 sm:p-9">
                <p className="text-[clamp(2.25rem,6vw,3.5rem)] font-semibold leading-none tracking-[-0.04em]">
                  {stat.value}
                </p>
                <p className="max-w-[16rem] text-xs leading-snug text-muted sm:text-base">{stat.label}</p>
              </div>
            </Reveal>
          </li>
        ))}
      </ul>
    </Section>
  );
}
