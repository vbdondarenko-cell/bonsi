"use client";

import { useReducedMotion } from "motion/react";
import { useEffect, useRef } from "react";
import { useWinter } from "./use-winter";

const BULB_COLORS = ["#ff4d5e", "#ffd27a", "#7cc4ff", "#ffffff"];
const BULBS = 44;

function Garland() {
  return (
    <div aria-hidden="true" className="pointer-events-none fixed inset-x-0 top-0 z-[60] h-5">
      <span className="winter-wire" />
      <div className="relative flex justify-between px-2">
        {Array.from({ length: BULBS }, (_, i) => {
          const color = BULB_COLORS[i % BULB_COLORS.length]!;
          const sag = Math.abs(Math.sin((i / (BULBS - 1)) * Math.PI * 5)) * 5;
          return (
            <span
              key={i}
              className="winter-bulb"
              style={{ background: color, color, marginTop: sag, animationDelay: `${((i * 37) % 200) / 100}s` }}
            />
          );
        })}
      </div>
    </div>
  );
}

type Flake = { x: number; y: number; z: number; phase: number };

/**
 * Сніг із глибиною: далекі пластівці дрібні й повільні, близькі великі, розмиті й летять швидше.
 * Прокрутка й курсор зсувають шари з різною швидкістю (паралакс) — відчуття, що ти пролітаєш крізь снігопад.
 */
function SnowField() {
  const ref = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = ref.current;
    const ctx = canvas?.getContext("2d");
    if (!canvas || !ctx) return;

    const compact = window.matchMedia("(max-width: 767px)").matches || (navigator.hardwareConcurrency ?? 8) <= 4;
    const count = compact ? 55 : 130;
    const dpr = Math.min(window.devicePixelRatio || 1, compact ? 1.25 : 1.5);
    let width = 0;
    let height = 0;

    const sprite = document.createElement("canvas");
    sprite.width = sprite.height = 64;
    const sctx = sprite.getContext("2d")!;
    const g = sctx.createRadialGradient(32, 32, 0, 32, 32, 32);
    g.addColorStop(0, "rgba(255,255,255,1)");
    g.addColorStop(0.35, "rgba(235,246,255,0.75)");
    g.addColorStop(1, "rgba(220,238,255,0)");
    sctx.fillStyle = g;
    sctx.fillRect(0, 0, 64, 64);

    const resize = () => {
      width = window.innerWidth;
      height = window.innerHeight;
      canvas.width = width * dpr;
      canvas.height = height * dpr;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    };
    resize();

    const flakes: Flake[] = Array.from({ length: count }, () => ({
      x: Math.random() * width,
      y: Math.random() * height,
      z: 0.12 + Math.random() ** 1.6 * 0.88,
      phase: Math.random() * Math.PI * 2,
    }));

    const pointer = { x: 0, y: 0 };
    let scrollY = window.scrollY;
    let last = performance.now();
    let raf = 0;

    const onPointer = (e: PointerEvent) => {
      pointer.x = e.clientX / window.innerWidth - 0.5;
      pointer.y = e.clientY / window.innerHeight - 0.5;
    };
    const tick = (now: number) => {
      raf = requestAnimationFrame(tick);
      if (document.hidden) {
        last = now;
        return;
      }
      const dt = Math.min(0.05, (now - last) / 1000);
      last = now;
      const dScroll = window.scrollY - scrollY;
      scrollY = window.scrollY;

      ctx.clearRect(0, 0, width, height);
      for (const f of flakes) {
        f.phase += dt * (0.6 + f.z);
        f.y += (22 + 85 * f.z * f.z) * dt - dScroll * f.z * 0.55;
        f.x += Math.sin(f.phase) * 14 * f.z * dt;
        const size = 3 + f.z * f.z * 26;
        if (f.y > height + size) {
          f.y = -size;
          f.x = Math.random() * width;
        } else if (f.y < -size * 2) {
          f.y = height + size;
          f.x = Math.random() * width;
        }
        const px = f.x + pointer.x * -70 * f.z;
        const py = f.y + pointer.y * -40 * f.z;
        // Близькі пластівці розмиті й напівпрозорі: ефект малої глибини різкості.
        ctx.globalAlpha = 0.28 + (1 - f.z) * 0.5 - (f.z > 0.8 ? 0.2 : 0);
        ctx.drawImage(sprite, px - size / 2, py - size / 2, size, size);
      }
      ctx.globalAlpha = 1;
    };

    raf = requestAnimationFrame(tick);
    window.addEventListener("resize", resize, { passive: true });
    window.addEventListener("pointermove", onPointer, { passive: true });
    return () => {
      cancelAnimationFrame(raf);
      window.removeEventListener("resize", resize);
      window.removeEventListener("pointermove", onPointer);
    };
  }, []);

  return <canvas ref={ref} aria-hidden="true" className="pointer-events-none fixed inset-0 z-[45] h-full w-full" />;
}

/**
 * Новорічне оформлення (6 грудня – 2 січня за Києвом). Поза цим вікном не рендерить нічого й
 * знімає data-season, тож звичайний дизайн повертається сам. Лише декор: aria-hidden, без pointer-events.
 */
export function WinterTheme() {
  const winter = useWinter();
  const reduce = useReducedMotion() ?? false;

  useEffect(() => {
    if (!winter) return;
    const root = document.documentElement;
    root.dataset.season = "winter";
    return () => {
      delete root.dataset.season;
    };
  }, [winter]);

  if (!winter) return null;
  return (
    <>
      <div aria-hidden="true" className="winter-aurora" />
      <Garland />
      {reduce ? null : <SnowField />}
    </>
  );
}
