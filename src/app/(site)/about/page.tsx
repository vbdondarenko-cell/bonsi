import type { Metadata } from "next";
import { Container, Section } from "@/components/ui/container";
import { Reveal } from "@/components/ui/reveal";
import { SectionHeading } from "@/components/ui/section-heading";
import { team } from "@/lib/team";

export const metadata: Metadata = {
  title: "Про нас",
  description: "BONSI Studios — студія двох засновників-розробників. Наш підхід до розробки цифрових продуктів.",
  alternates: { canonical: "/about" },
};

const principles = [
  {
    title: "Спочатку розуміння задачі",
    text: "Перш ніж малювати й писати код, з’ясовуємо, кому й навіщо потрібен продукт.",
  },
  {
    title: "Невеликі перевірені кроки",
    text: "Показуємо проміжний результат і перевіряємо його на реальних пристроях і браузерах.",
  },
  {
    title: "Справжня функціональність",
    text: "Форми зберігають дані, кнопки працюють. Ми не імітуємо те, чого не зробили.",
  },
  {
    title: "Код, який можна підтримувати",
    text: "Масштабована структура, багаторазові компоненти й зрозуміла документація.",
  },
];

export default function AboutPage() {
  return (
    <>
      <Container className="pt-20 sm:pt-28">
        <SectionHeading
          as="h1"
          eyebrow="Про нас"
          title="Двоє розробників і повний цикл створення продукту"
          description="BONSI — невелика студія, яка створює сайти, вебплатформи та мобільні додатки на замовлення. Ми самі проєктуємо, розробляємо й супроводжуємо те, що запускаємо."
        />
      </Container>

      <Section>
        <Reveal>
          <SectionHeading eyebrow="Підхід" title="Як ми думаємо про розробку" />
        </Reveal>
        <ul className="mt-14 grid gap-4 md:grid-cols-2">
          {principles.map((item, index) => (
            <li key={item.title}>
              <Reveal delay={(index % 2) * 0.08} className="h-full">
                <div className="h-full rounded-[var(--radius-card)] border border-line bg-surface p-8">
                  <h3 className="text-xl font-semibold tracking-tight">{item.title}</h3>
                  <p className="mt-3 leading-relaxed text-muted">{item.text}</p>
                </div>
              </Reveal>
            </li>
          ))}
        </ul>
      </Section>

      <Section>
        <Reveal>
          <SectionHeading eyebrow="Команда" title="Два засновники" />
        </Reveal>
        <ul className="mt-14 grid gap-4 md:grid-cols-2">
          {team.map((member, index) => (
            <li key={member.name ?? `${member.role}-${index}`}>
              <Reveal delay={index * 0.08} className="h-full">
                <div className="h-full rounded-[var(--radius-card)] border border-line p-8">
                  <p className="font-mono text-xs uppercase tracking-[0.18em] text-accent-soft">
                    {member.role}
                  </p>
                  {member.name ? (
                    <h3 className="mt-5 text-2xl font-semibold tracking-tight">{member.name}</h3>
                  ) : null}
                  <p className="mt-4 leading-relaxed text-muted">{member.about}</p>
                </div>
              </Reveal>
            </li>
          ))}
        </ul>
      </Section>
    </>
  );
}
