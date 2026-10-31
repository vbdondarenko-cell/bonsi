import { OrderForm } from "@/components/order-form";
import { Section } from "@/components/ui/container";
import { Reveal } from "@/components/ui/reveal";
import { SectionHeading } from "@/components/ui/section-heading";

export function OrderSection({ headingAs = "h2" }: { headingAs?: "h1" | "h2" }) {
  return (
    <Section id="order">
      <div className="grid gap-12 lg:grid-cols-[minmax(0,5fr)_minmax(0,7fr)] lg:gap-16">
        <Reveal>
          <SectionHeading
            as={headingAs}
            eyebrow="Заявка"
            title="Обговоримо ваш проєкт"
            description="Заповніть форму — заявка збережеться в нашій системі, а ви отримаєте номер звернення. Ми відповімо на вказаний email."
          />
          <ul className="mt-10 space-y-4 text-muted">
            <li className="flex gap-3">
              <span className="font-mono text-accent-soft">01</span>
              Оберіть послугу й опишіть ідею
            </li>
            <li className="flex gap-3">
              <span className="font-mono text-accent-soft">02</span>
              Вкажіть бюджет і бажані терміни
            </li>
            <li className="flex gap-3">
              <span className="font-mono text-accent-soft">03</span>
              Залиште контакти та надішліть заявку
            </li>
          </ul>
        </Reveal>
        <Reveal delay={0.1}>
          <OrderForm />
        </Reveal>
      </div>
    </Section>
  );
}
