import type { Metadata } from "next";
import { ButtonLink } from "@/components/ui/button";
import { Container, Section } from "@/components/ui/container";
import { SectionHeading } from "@/components/ui/section-heading";

export const metadata: Metadata = {
  title: "Питання та відповіді",
  description: "Відповіді на часті питання про замовлення, оплату, зміни, передачу та підтримку.",
  alternates: { canonical: "/faq" },
};

const faq = [
  { q: "Заявка зобов’язує мене до чогось?", a: "Ні. Заявка — лише запит. Ціна й терміни фіксуються в пропозиції та договорі, які ви погоджуєте окремо." },
  { q: "Коли починається робота?", a: "Після погодженої пропозиції, договору та підтвердженої передоплати (якщо вона передбачена)." },
  { q: "Що, якщо потрібно змінити або додати функціонал?", a: "Ви подаєте запит на зміну в кабінеті. Ми оцінюємо вартість і термін, ви погоджуєте додаткову угоду — лише після цього робота та рахунок за нею стають чинними." },
  { q: "Як ви підтверджуєте оплату?", a: "Оплатою вважається підтвердження студією надходження коштів. Кнопка «Я сплатив(ла)» лише повідомляє нас про платіж." },
  { q: "Чи є погодження в кабінеті електронним підписом?", a: "Ні. Це фіксація рішення в журналі з версією документа, а не кваліфікований електронний підпис." },
  { q: "Що я отримаю наприкінці?", a: "Результати, доступи, документацію та інструкції. Паролі й ключі передаємо окремим захищеним каналом, а не у звичайних повідомленнях." },
  { q: "Що з підтримкою після запуску?", a: "Звернення подаються в кабінеті. Умови гарантії визначає договір; платне доопрацювання оформлюється окремою погодженою зміною." },
  { q: "Чи можна побачити приклади робіт?", a: "Ми публікуємо лише реальні кейси та лише за згодою власника проєкту. Якщо розділ «Портфоліо» ще порожній — значить, жодного кейсу не підтверджено для публікації." },
];

export default function FaqPage() {
  return (
    <>
      <Container className="pt-20 sm:pt-28">
        <SectionHeading as="h1" eyebrow="FAQ" title="Питання та відповіді" />
      </Container>
      <Section>
        <div className="mx-auto max-w-3xl divide-y divide-line rounded-[var(--radius-card)] border border-line bg-surface">
          {faq.map((item) => (
            <details key={item.q} className="group p-6">
              <summary className="cursor-pointer list-none text-lg font-medium focus-visible:outline-2 focus-visible:outline-offset-4">{item.q}</summary>
              <p className="mt-3 leading-relaxed text-muted">{item.a}</p>
            </details>
          ))}
        </div>
        <div className="mt-12 text-center">
          <ButtonLink href="/contact">Не знайшли відповідь? Напишіть нам</ButtonLink>
        </div>
      </Section>
    </>
  );
}
