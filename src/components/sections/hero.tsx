"use client";

import { motion, useScroll, useTransform } from "motion/react";
import { useRef } from "react";
import { ButtonLink } from "@/components/ui/button";
import { Container } from "@/components/ui/container";
import { services } from "@/lib/services";

export function Hero() {
  const ref = useRef<HTMLElement>(null);
  const { scrollYProgress } = useScroll({ target: ref, offset: ["start start", "end start"] });
  const glowY = useTransform(scrollYProgress, [0, 1], [0, 160]);
  const contentY = useTransform(scrollYProgress, [0, 1], [0, 60]);
  const contentOpacity = useTransform(scrollYProgress, [0, 0.8], [1, 0.25]);

  return (
    <section ref={ref} className="hero-section theme-void relative isolate overflow-hidden">
      <div aria-hidden="true" className="bg-grid absolute inset-0 -z-10" />
      <motion.div
        aria-hidden="true"
        style={{ y: glowY }}
        className="absolute left-1/2 top-[-12rem] -z-10 size-[28rem] -translate-x-1/2 rounded-full bg-accent/15 blur-[120px] sm:size-[44rem]"
      />

      <Container className="relative pb-20 pt-20 sm:pb-28 sm:pt-32">
        <motion.div style={{ y: contentY, opacity: contentOpacity }} className="lg:max-w-[56%]">
          <p data-build className="mb-8 font-mono text-xs uppercase tracking-[0.2em] text-accent-soft">
            BONSI Studios · Digital product studio
          </p>
          {/* Поява тексту героя — CSS-анімація, а не JS: заголовок (LCP) не чекає на гідратацію й бібліотеку анімацій. */}
          <h1
            data-build
            style={{ "--rise": "28px", "--dur": "0.8s" } as React.CSSProperties}
            className="hero-rise max-w-5xl text-[clamp(2.5rem,8vw,4.75rem)] font-semibold leading-[1] tracking-[-0.04em]"
          >
            Створюємо цифрові продукти, які <span className="text-accent-soft">працюють</span>
          </h1>
          <p
            data-build
            style={{ "--delay": "0.15s" } as React.CSSProperties}
            className="hero-rise mt-8 max-w-2xl text-lg leading-relaxed text-muted sm:text-xl"
          >
            Сайти, вебплатформи та мобільні додатки на замовлення. Двоє розробників, які ведуть
            проєкт від ідеї й дизайну до запуску.
          </p>
          <div data-build style={{ "--delay": "0.3s" } as React.CSSProperties} className="hero-rise mt-10 flex flex-col gap-3 sm:flex-row">
            <ButtonLink href="#order">Обговорити проєкт</ButtonLink>
            <ButtonLink href="/services" variant="ghost">
              Наші послуги
            </ButtonLink>
          </div>
        </motion.div>
      </Container>

      {/* Стрічка послуг під hero — аналог рядка мініатюр проєктів у 2brolab. Зупиняється при наведенні й за Reduce Motion. */}
      <div data-build className="marquee border-y border-line bg-surface py-4" aria-label="Наші послуги">
        <ul className="marquee-track font-mono text-xs uppercase tracking-[0.16em] text-muted">
          {[...services, ...services].map((service, index) => (
            <li
              key={`${service.id}-${index}`}
              aria-hidden={index >= services.length ? true : undefined}
              className="flex shrink-0 items-center gap-6 pr-6"
            >
              {service.title}
              <span aria-hidden="true" className="text-accent-soft">●</span>
            </li>
          ))}
        </ul>
      </div>
    </section>
  );
}
