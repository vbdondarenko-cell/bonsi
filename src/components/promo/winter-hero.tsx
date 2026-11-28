"use client";

import { motion, useMotionValue, useReducedMotion, useScroll, useSpring, useTransform } from "motion/react";
import { useRef, type PointerEvent } from "react";
import { ButtonLink } from "@/components/ui/button";
import { Container } from "@/components/ui/container";
import { PROMO_DISCOUNT } from "@/lib/promo";
import { Countdown } from "./countdown";

const baubles = [
  { x: "8%", y: "14%", size: 74, z: 140, hue: "red", delay: 0 },
  { x: "88%", y: "10%", size: 54, z: 90, hue: "gold", delay: 0.8 },
  { x: "94%", y: "62%", size: 96, z: 200, hue: "red", delay: 0.3 },
  { x: "2%", y: "70%", size: 62, z: 60, hue: "gold", delay: 1.4 },
  { x: "70%", y: "88%", size: 42, z: 170, hue: "red", delay: 1.1 },
  { x: "22%", y: "92%", size: 34, z: 40, hue: "gold", delay: 0.5 },
] as const;

/** Акційний hero: «−40%» у глибині з шарами, що по-різному реагують на курсор і скрол. Лише при html[data-promo="on"]. */
export function WinterHero() {
  const reduce = useReducedMotion();
  const ref = useRef<HTMLElement>(null);
  const px = useMotionValue(0);
  const py = useMotionValue(0);
  const sx = useSpring(px, { stiffness: 90, damping: 20 });
  const sy = useSpring(py, { stiffness: 90, damping: 20 });
  const rotY = useTransform(sx, [-0.5, 0.5], [-14, 14]);
  const rotX = useTransform(sy, [-0.5, 0.5], [10, -10]);

  const { scrollYProgress } = useScroll({ target: ref, offset: ["start start", "end start"] });
  // «Занурення»: під час скролу сцена відлітає назад і розфокусується.
  const dive = useTransform(scrollYProgress, [0, 1], [1, 0.82]);
  const diveY = useTransform(scrollYProgress, [0, 1], [0, 90]);
  const fade = useTransform(scrollYProgress, [0, 0.85], [1, 0.15]);

  function onMove(event: PointerEvent<HTMLElement>) {
    if (reduce || event.pointerType !== "mouse") return;
    const r = event.currentTarget.getBoundingClientRect();
    px.set((event.clientX - r.left) / r.width - 0.5);
    py.set((event.clientY - r.top) / r.height - 0.5);
  }
  function onLeave() {
    px.set(0);
    py.set(0);
  }

  return (
    <section
      ref={ref}
      aria-labelledby="winter-title"
      onPointerMove={onMove}
      onPointerLeave={onLeave}
      className="promo-only theme-void hero-section winter-hero relative isolate overflow-hidden"
    >
      <div aria-hidden="true" className="winter-aurora absolute inset-0 -z-10" />
      <div aria-hidden="true" className="bg-grid absolute inset-0 -z-10 opacity-60" />

      <Container className="relative grid items-center gap-10 pb-16 pt-14 sm:pb-24 sm:pt-20 lg:min-h-[44rem] lg:grid-cols-[1.05fr_1fr] lg:gap-6">
        <motion.div style={{ y: diveY, opacity: fade }} className="relative z-10">
          <p className="mb-6 inline-flex items-center gap-3 rounded-full border border-white/15 bg-white/5 px-4 py-2 font-mono text-[0.7rem] uppercase tracking-[0.2em] text-[#ffd98a] backdrop-blur">
            <span aria-hidden="true" className="winter-pulse size-2 rounded-full bg-[#ffd98a]" />
            Зимова акція · 6 грудня — 2 січня
          </p>
          <h1
            id="winter-title"
            style={{ "--rise": "30px", "--dur": "0.9s" } as React.CSSProperties}
            className="hero-rise text-[clamp(2.4rem,6.6vw,4.9rem)] font-semibold leading-[1.02] tracking-[-0.04em]"
          >
            Святкові знижки на <span className="winter-gradient-text">сайти та додатки</span>
          </h1>
          <p
            style={{ "--delay": "0.15s" } as React.CSSProperties}
            className="hero-rise mt-7 max-w-xl text-lg leading-relaxed text-muted sm:text-xl"
          >
            Від Дня святого Миколая до першого тижня нового року — мінус {PROMO_DISCOUNT}% на всі послуги BONSI.
            Запустіть проєкт зараз, а святкуйте з готовим продуктом.
          </p>

          <div style={{ "--delay": "0.28s" } as React.CSSProperties} className="hero-rise mt-9">
            <p className="mb-3 font-mono text-[0.7rem] uppercase tracking-[0.2em] text-muted">До кінця акції</p>
            <Countdown />
          </div>

          <div style={{ "--delay": "0.4s" } as React.CSSProperties} className="hero-rise mt-9 flex flex-col gap-3 sm:flex-row">
            <ButtonLink href="#order" className="winter-cta">
              Забрати −{PROMO_DISCOUNT}%
            </ButtonLink>
            <ButtonLink href="#offer" variant="ghost">
              Ціни зі знижкою
            </ButtonLink>
          </div>
        </motion.div>

        {/* 3D-сцена: шари на різній глибині нахиляються за курсором. */}
        <motion.div style={{ scale: dive, opacity: fade }} className="winter-stage relative mx-auto aspect-square w-full max-w-[34rem]">
          <motion.div
            aria-hidden="true"
            style={{ rotateX: rotX, rotateY: rotY, transformPerspective: 1100, transformStyle: "preserve-3d" }}
            className="absolute inset-0"
          >
            <div className="winter-ring" style={{ transform: "translateZ(-80px)" }} />
            <div className="winter-ring winter-ring-2" style={{ transform: "translateZ(-30px) rotateX(68deg)" }} />
            <div className="winter-big" style={{ transform: "translateZ(0)" }}>
              <span className="winter-big-back">−{PROMO_DISCOUNT}%</span>
              <span className="winter-big-mid">−{PROMO_DISCOUNT}%</span>
              <span className="winter-big-front">−{PROMO_DISCOUNT}%</span>
            </div>
            {baubles.map((b, i) => (
              <span
                key={i}
                className={`winter-bauble winter-bauble-${b.hue}`}
                style={{
                  left: b.x,
                  top: b.y,
                  width: b.size,
                  height: b.size,
                  transform: `translateZ(${b.z}px)`,
                  animationDelay: `${b.delay}s`,
                }}
              />
            ))}
          </motion.div>
        </motion.div>
      </Container>
    </section>
  );
}
