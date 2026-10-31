"use client";

import { motion, useScroll, useTransform } from "motion/react";
import { useRef } from "react";
import { ButtonLink } from "@/components/ui/button";
import { Container } from "@/components/ui/container";

export function Hero() {
  const ref = useRef<HTMLElement>(null);
  const { scrollYProgress } = useScroll({ target: ref, offset: ["start start", "end start"] });
  const glowY = useTransform(scrollYProgress, [0, 1], [0, 160]);
  const contentY = useTransform(scrollYProgress, [0, 1], [0, 60]);
  const contentOpacity = useTransform(scrollYProgress, [0, 0.8], [1, 0.25]);

  return (
    <section ref={ref} className="relative isolate overflow-hidden">
      <div aria-hidden="true" className="bg-grid absolute inset-0 -z-10" />
      <motion.div
        aria-hidden="true"
        style={{ y: glowY }}
        className="absolute left-1/2 top-[-12rem] -z-10 size-[44rem] -translate-x-1/2 rounded-full bg-accent/25 blur-[140px]"
      />

      <Container className="pb-20 pt-20 sm:pb-28 sm:pt-32">
        <motion.div style={{ y: contentY, opacity: contentOpacity }}>
          <p className="mb-8 font-mono text-xs uppercase tracking-[0.2em] text-accent-soft">
            BONSI Studios · Digital product studio
          </p>
          <motion.h1
            initial={{ opacity: 0, y: 28 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.8, ease: [0.22, 1, 0.36, 1] }}
            className="max-w-5xl text-[clamp(2.6rem,8.5vw,6.75rem)] font-semibold leading-[0.98] tracking-[-0.045em]"
          >
            Створюємо цифрові продукти, які <span className="text-accent-soft">працюють</span>
          </motion.h1>
          <motion.p
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.7, delay: 0.15, ease: [0.22, 1, 0.36, 1] }}
            className="mt-8 max-w-2xl text-lg leading-relaxed text-muted sm:text-xl"
          >
            Сайти, вебплатформи та мобільні додатки на замовлення. Двоє розробників, які ведуть
            проєкт від ідеї й дизайну до запуску.
          </motion.p>
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.7, delay: 0.3, ease: [0.22, 1, 0.36, 1] }}
            className="mt-10 flex flex-col gap-3 sm:flex-row"
          >
            <ButtonLink href="#order">Обговорити проєкт</ButtonLink>
            <ButtonLink href="/services" variant="ghost">
              Наші послуги
            </ButtonLink>
          </motion.div>
        </motion.div>
      </Container>
    </section>
  );
}
