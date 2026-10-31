import { Section } from "@/components/ui/container";
import { Reveal } from "@/components/ui/reveal";
import { SectionHeading } from "@/components/ui/section-heading";

const pillars = [
  {
    index: "01",
    title: "Сайти",
    text: "Лендинги, корпоративні сайти та інтернет-магазини з акцентом на швидкість і зрозумілу структуру.",
  },
  {
    index: "02",
    title: "Вебплатформи",
    text: "Застосунки з базою даних, ролями й кабінетами, де дані зберігаються й перевіряються на сервері.",
  },
  {
    index: "03",
    title: "Мобільні додатки",
    text: "Android та iOS: від прототипу інтерфейсу до серверної частини й підготовки до публікації.",
  },
];

export function Specialization() {
  return (
    <Section>
      <Reveal>
        <SectionHeading
          eyebrow="Спеціалізація"
          title="Повний цикл розробки цифрового продукту"
          description="Дизайн, фронтенд, бекенд і перевірка якості — в одній невеликій команді. Менше передач між підрядниками, більше відповідальності за результат."
        />
      </Reveal>
      <div className="mt-14 grid gap-px overflow-hidden rounded-[var(--radius-card)] border border-line bg-line md:grid-cols-3">
        {pillars.map((pillar, index) => (
          <Reveal key={pillar.index} delay={index * 0.08} className="bg-bg">
            <article className="h-full p-8 sm:p-10">
              <p className="font-mono text-sm text-accent-soft">{pillar.index}</p>
              <h3 className="mt-10 text-2xl font-semibold tracking-tight">{pillar.title}</h3>
              <p className="mt-4 leading-relaxed text-muted">{pillar.text}</p>
            </article>
          </Reveal>
        ))}
      </div>
    </Section>
  );
}
