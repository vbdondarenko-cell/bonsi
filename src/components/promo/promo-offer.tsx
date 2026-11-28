import { ButtonLink } from "@/components/ui/button";
import { Section } from "@/components/ui/container";
import { Reveal } from "@/components/ui/reveal";
import { SectionHeading } from "@/components/ui/section-heading";
import { TiltCard } from "@/components/ui/tilt-card";
import { PROMO_DISCOUNT, discounted, formatUah } from "@/lib/promo";
import { services } from "@/lib/services";

const ids = ["landing", "visiting", "corporate"] as const;

/** Ціни зі знижкою на головні пакети: стара ціна закреслена, нова — у золотому акценті. */
export function PromoOffer() {
  const tiers = ids
    .map((id) => services.find((s) => s.id === id))
    .filter((s): s is (typeof services)[number] => Boolean(s && s.priceFrom));

  return (
    <div className="promo-only">
      <Section id="offer" tone="void">
        <Reveal>
          <SectionHeading
            eyebrow="Святкова пропозиція"
            title={
              <>
                Мінус {PROMO_DISCOUNT}% на старт <span className="winter-gradient-text">вашого проєкту</span>
              </>
            }
            description="Знижка діє на всі пакети та рахується автоматично після брифу. Умови фіксуємо до початку роботи."
          />
        </Reveal>
        <ul className="mt-14 grid gap-5 [perspective:1400px] lg:grid-cols-3">
          {tiers.map((tier, index) => {
            const now = discounted(tier.priceFrom as number);
            const featured = index === 1;
            return (
              <li key={tier.id}>
                <Reveal delay={index * 0.09} className="h-full">
                  <TiltCard className="h-full" max={9}>
                    <article
                      className={`card-shadow winter-card relative flex h-full flex-col overflow-hidden rounded-[var(--radius-card)] border p-7 sm:p-8 ${
                        featured ? "winter-card-featured border-[#ffd98a]/50" : "border-line"
                      }`}
                    >
                      <span className="absolute right-5 top-5 rounded-full bg-accent px-3 py-1 font-mono text-xs font-semibold text-white shadow-[0_0_24px_rgb(225_29_46/0.6)]">
                        −{PROMO_DISCOUNT}%
                      </span>
                      <p className="font-mono text-xs uppercase tracking-[0.18em] text-accent-soft">{tier.title}</p>
                      <p className="mt-8 text-sm text-muted line-through decoration-accent decoration-2">
                        від {formatUah(tier.priceFrom as number)}
                      </p>
                      <p className="mt-1 text-[clamp(2.2rem,5vw,3.1rem)] font-semibold leading-none tracking-[-0.04em] text-[#ffd98a]">
                        від {formatUah(now)}
                      </p>
                      <p className="mt-5 leading-relaxed text-muted">{tier.summary}</p>
                      <ul className="mt-6 flex-1 space-y-3 border-t border-line pt-6 text-sm">
                        {tier.points.map((point) => (
                          <li key={point} className="flex gap-3">
                            <span aria-hidden="true" className="mt-0.5 text-[#ffd98a]">✦</span>
                            <span>{point}</span>
                          </li>
                        ))}
                      </ul>
                      <ButtonLink href="#order" variant={featured ? "primary" : "ghost"} className="mt-8 w-full">
                        Замовити зі знижкою
                      </ButtonLink>
                    </article>
                  </TiltCard>
                </Reveal>
              </li>
            );
          })}
        </ul>
        <p className="mt-8 text-sm text-muted">
          Знижка діє на замовлення, оформлені з 6 грудня по 2 січня включно. Для магазинів, застосунків і підтримки
          розрахуємо окремо — із тією ж знижкою.
        </p>
      </Section>
    </div>
  );
}
