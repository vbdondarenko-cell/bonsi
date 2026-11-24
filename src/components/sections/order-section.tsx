import { OrderForm } from "@/components/order-form";
import type { ServiceId } from "@/lib/orders/options";
import { Section } from "@/components/ui/container";
import { Reveal } from "@/components/ui/reveal";
import { SectionHeading } from "@/components/ui/section-heading";

export function OrderSection({ headingAs = "h2", initialService, initialPlan }: { headingAs?: "h1" | "h2"; initialService?: ServiceId; initialPlan?: string }) {
  return (
    <Section id="order">
      <div className="grid gap-12 lg:grid-cols-[minmax(0,5fr)_minmax(0,7fr)] lg:gap-16">
        <Reveal>
          <SectionHeading
            as={headingAs}
            eyebrow="Заявка"
            title="Обговоримо ваш проєкт"
            description="Дайте відповідь на кілька коротких запитань — це займе близько хвилини. Більшість з них можна пропустити."
          />
          <ul className="mt-10 space-y-4 text-muted">
            <li className="flex gap-3">
              <span className="font-mono text-accent-soft">01</span>
              Оберіть послугу й відповідайте на уточнення в чаті
            </li>
            <li className="flex gap-3">
              <span className="font-mono text-accent-soft">02</span>
              Залиште імʼя та email — на нього прийде номер звернення
            </li>
            <li className="flex gap-3">
              <span className="font-mono text-accent-soft">03</span>
              Продовжте розмову з нами в Telegram — повідомлення вже буде готове
            </li>
          </ul>
        </Reveal>
        <Reveal delay={0.1}>
          <OrderForm initialService={initialService} initialPlan={initialPlan} />
        </Reveal>
      </div>
    </Section>
  );
}
