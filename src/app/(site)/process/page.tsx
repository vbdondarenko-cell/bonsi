import type { Metadata } from "next";
import { ButtonLink } from "@/components/ui/button";
import { Container, Section } from "@/components/ui/container";
import { SectionHeading } from "@/components/ui/section-heading";

export const metadata: Metadata = {
  title: "Як ми працюємо",
  description: "Від заявки до підтримки: прозорі етапи, погодження в кабінеті клієнта та зафіксований обсяг робіт.",
  alternates: { canonical: "/process" },
};

const steps = [
  { title: "Заявка", text: "Ви описуєте задачу у формі. Це ще не проєкт і не договір — ми вивчаємо запит і відповідаємо або пояснюємо, чому не беремо його." },
  { title: "Обговорення", text: "Уточнюємо цілі, обсяг, терміни й бюджет у чаті кабінету клієнта." },
  { title: "Комерційна пропозиція", text: "Отримуєте етапи, вартість і терміни. Можна запросити зміни — кожна версія зберігається." },
  { title: "Договір", text: "Погоджуєте договір у кабінеті; рішення фіксується з версією документа." },
  { title: "Передоплата", text: "Після підтвердження студією надходження коштів проєкт стає активним." },
  { title: "Розробка й тестування", text: "Працюємо етапами, показуємо результат, ви приймаєте його або повертаєте з коментарями." },
  { title: "Передача", text: "Передаємо результати, доступи й документацію; ви приймаєте передачу в кабінеті." },
  { title: "Завершення й підтримка", text: "Проєкт завершується, діє гарантія за договором, а звернення подаються в розділі «Підтримка»." },
];

export default function ProcessPage() {
  return (
    <>
      <Container className="pt-20 sm:pt-28">
        <SectionHeading as="h1" eyebrow="Процес" title="Як ми працюємо" description="Кожен крок видно в кабінеті клієнта: пропозиції, документи, оплати, етапи й зміни." />
      </Container>
      <Section>
        <ol className="grid gap-4 md:grid-cols-2">
          {steps.map((step, i) => (
            <li key={step.title} className="rounded-[var(--radius-card)] border border-line bg-surface p-8">
              <p className="font-mono text-xs text-accent-soft">{String(i + 1).padStart(2, "0")}</p>
              <h2 className="mt-2 text-xl font-semibold tracking-tight">{step.title}</h2>
              <p className="mt-3 leading-relaxed text-muted">{step.text}</p>
            </li>
          ))}
        </ol>
        <div className="mt-12">
          <ButtonLink href="/contact">Залишити заявку</ButtonLink>
        </div>
      </Section>
    </>
  );
}
