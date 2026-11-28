import Link from "next/link";
import { Price } from "@/components/promo/price";
import { ButtonLink } from "@/components/ui/button";
import { Section } from "@/components/ui/container";
import { Reveal } from "@/components/ui/reveal";
import { SectionHeading } from "@/components/ui/section-heading";
import { cn } from "@/lib/cn";
import { services } from "@/lib/services";

/** Три «віконні» пакети сайтів із наявного прайсу, як блок «Прозора вартість» у 2brolab. */
const tierIds = ["landing", "visiting", "corporate"] as const;
const featuredId = "visiting";

export function Pricing({ withHeading = true }: { withHeading?: boolean }) {
  const tiers = tierIds
    .map((id) => services.find((service) => service.id === id))
    .filter((service): service is (typeof services)[number] => Boolean(service));

  return (
    <Section id="pricing">
      {withHeading ? (
        <Reveal>
          <SectionHeading
            eyebrow="Вартість"
            title="Прозора вартість без сюрпризів"
            description="Стартова ціна залежить від типу сайту. Точну вартість і терміни узгоджуємо після брифу, до початку роботи."
          />
        </Reveal>
      ) : null}
      <ul className={cn("grid gap-4 lg:grid-cols-3", withHeading && "mt-12")}>
        {tiers.map((tier, index) => {
          const featured = tier.id === featuredId;
          return (
            <li key={tier.id} className={cn(featured && "theme-void rounded-[var(--radius-card)]")}>
              <Reveal delay={index * 0.08} className="h-full">
                <article
                  className={cn(
                    "card-shadow flex h-full flex-col rounded-[var(--radius-card)] border p-6 sm:p-8",
                    featured ? "border-accent-soft bg-bg" : "border-line bg-surface",
                  )}
                >
                  <p className="font-mono text-xs uppercase tracking-[0.18em] text-accent-soft">{tier.title}</p>
                  <p className="mt-6 text-[clamp(2rem,5vw,2.75rem)] font-semibold leading-none tracking-[-0.04em]">
                    <Price label={tier.priceLabel} from={tier.priceFrom} stacked />
                  </p>
                  <p className="mt-4 leading-relaxed text-muted">{tier.summary}</p>
                  <ul className="mt-6 flex-1 space-y-3 border-t border-line pt-6 text-sm">
                    {tier.points.map((point) => (
                      <li key={point} className="flex gap-3">
                        <span aria-hidden="true" className="mt-0.5 text-accent-soft">✓</span>
                        <span>{point}</span>
                      </li>
                    ))}
                  </ul>
                  <ButtonLink
                    href="#order"
                    variant={featured ? "primary" : "ghost"}
                    className="mt-8 w-full"
                  >
                    Обговорити проєкт
                  </ButtonLink>
                </article>
              </Reveal>
            </li>
          );
        })}
      </ul>
      <p className="mt-8 text-muted">
        Інтернет-магазини, вебзастосунки, мобільні додатки та підтримка — в{" "}
        <Link href="/services" className="font-medium text-fg underline underline-offset-4 hover:text-accent-soft">
          повному переліку послуг
        </Link>
        .
      </p>
    </Section>
  );
}
