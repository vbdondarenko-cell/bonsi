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
            description="Залиште контакт, за яким вам зручно відповісти. Ми надішлемо підтвердження заявки на email."
          />
          <ul className="mt-10 space-y-4 text-muted">
            <li className="flex gap-3">
              <span className="font-mono text-accent-soft">01</span>
              Оберіть послугу — решту уточнимо під час спілкування
            </li>
            <li className="flex gap-3">
              <span className="font-mono text-accent-soft">02</span>
              За бажанням додайте короткий опис, посилання, бюджет і терміни
            </li>
            <li className="flex gap-3">
              <span className="font-mono text-accent-soft">03</span>
              Залиште контакти та надішліть заявку
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
