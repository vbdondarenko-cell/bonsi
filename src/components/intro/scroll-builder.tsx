"use client";

import { usePathname } from "next/navigation";
import { motion } from "motion/react";
import { useEffect, useRef, useState } from "react";

/**
 * «Збирання сайту курсорами» під час прокрутки — на кожній сторінці.
 * Кожен елемент з data-cb прихований (CSS), доки не потрапить у в'юпорт; тоді до нього
 * прилітають кілька курсорів, виділяють його пунктирною рамкою, і він з'являється (data-built).
 *
 * Вмикається лише при html[data-cursors="on"] (inline-скрипт у layout): не при Reduce Motion
 * і не під автотестами. Якщо компонент не змонтувався, скрипт сам знімає атрибут, і сайт видимий.
 */

const COLORS = ["#a591ff", "#34d399", "#f59e0b", "#38bdf8", "#f472b6", "#fb7185"];
const LABELS = ["design", "frontend", "3d", "backend", "seo", "qa", "ux", "api", "motion", "copy", "tests", "devops"];

type Point = { x: number; y: number };
type CursorSpec = { id: number; color: string; label: string; from: Point; to: Point; delay: number; duration: number };
type Job = { id: number; box: { x: number; y: number; w: number; h: number }; color: string; cursors: CursorSpec[]; built: boolean };

const MAX_PARALLEL = 2;
const FLIGHT_MS = 1150;
const AFTER_BUILT_MS = 900;

export function ScrollBuilder() {
  const pathname = usePathname();
  const [jobs, setJobs] = useState<Job[]>([]);
  const counter = useRef(0);

  useEffect(() => {
    const root = document.documentElement;
    (window as unknown as { __cb?: boolean }).__cb = true;
    if (root.dataset.cursors !== "on") return;

    const timers: number[] = [];
    const queue: HTMLElement[] = [];
    let running = 0;
    let observer: IntersectionObserver | null = null;
    let cancelled = false;

    const markBuilt = (el: HTMLElement) => {
      el.setAttribute("data-built", "");
      el.querySelectorAll("[data-cb]").forEach((child) => child.setAttribute("data-built", ""));
    };

    const pump = () => {
      while (!cancelled && running < MAX_PARALLEL && queue.length > 0) {
        const el = queue.shift()!;
        if (el.hasAttribute("data-built")) continue;
        const r = el.getBoundingClientRect();
        const vw = window.innerWidth;
        const vh = window.innerHeight;
        // 66px — висота липкої шапки: рамка й курсори не мають заходити під неї.
        const top = Math.max(r.top, 66);
        const bottom = Math.min(r.bottom, vh);
        // Уже не в кадрі (швидка прокрутка) — збираємо без ефекту.
        if (bottom - top < 48) {
          markBuilt(el);
          continue;
        }
        running += 1;
        const compact = vw < 768;
        const box = { x: Math.max(r.left, 0) + 6, y: top + 6, w: Math.min(r.width, vw) - 12, h: Math.min(bottom - top, 560) - 12 };
        const targets: Point[] = [
          { x: box.x + box.w * 0.1, y: box.y + box.h * 0.18 },
          { x: box.x + box.w * 0.52, y: box.y + box.h * 0.5 },
          { x: box.x + box.w * 0.9, y: box.y + box.h * 0.86 },
        ].slice(0, compact ? 2 : 3);
        const base = counter.current;
        counter.current += targets.length;
        const cursors: CursorSpec[] = targets.map((to, i) => {
          const side = (base + i) % 4;
          const from =
            side === 0 ? { x: -40, y: Math.random() * vh }
            : side === 1 ? { x: vw + 40, y: Math.random() * vh }
            : side === 2 ? { x: Math.random() * vw, y: -40 }
            : { x: Math.random() * vw, y: vh + 40 };
          return {
            id: base + i,
            color: COLORS[(base + i) % COLORS.length],
            label: LABELS[(base + i) % LABELS.length],
            from,
            to,
            delay: i * 0.14,
            duration: 0.85 + Math.random() * 0.3,
          };
        });
        const job: Job = { id: base, box, color: cursors[0].color, cursors, built: false };
        setJobs((previous) => [...previous, job]);
        timers.push(
          window.setTimeout(() => {
            markBuilt(el);
            setJobs((previous) => previous.map((item) => (item.id === job.id ? { ...item, built: true } : item)));
          }, FLIGHT_MS),
        );
        timers.push(
          window.setTimeout(() => {
            setJobs((previous) => previous.filter((item) => item.id !== job.id));
            running -= 1;
            pump();
          }, FLIGHT_MS + AFTER_BUILT_MS),
        );
      }
    };

    const start = () => {
      if (cancelled) return;
      // Вкладені цілі (data-cb усередині data-cb) збираються разом із батьком.
      const targets = Array.from(document.querySelectorAll<HTMLElement>("main [data-cb]")).filter(
        (el) => !el.hasAttribute("data-built") && !el.parentElement?.closest("[data-cb]"),
      );
      observer = new IntersectionObserver(
        (entries) => {
          for (const entry of entries) {
            if (!entry.isIntersecting) continue;
            observer?.unobserve(entry.target);
            queue.push(entry.target as HTMLElement);
          }
          pump();
        },
        { rootMargin: "0px 0px -10% 0px", threshold: 0.08 },
      );
      targets.forEach((el) => observer!.observe(el));
    };

    // На головній чекаємо, поки відіграє вступний друк коду.
    let intro: MutationObserver | null = null;
    if (root.dataset.intro === "play") {
      intro = new MutationObserver(() => {
        if (root.dataset.intro !== "play") {
          intro?.disconnect();
          start();
        }
      });
      intro.observe(root, { attributes: true, attributeFilter: ["data-intro"] });
    } else {
      start();
    }

    return () => {
      cancelled = true;
      observer?.disconnect();
      intro?.disconnect();
      timers.forEach((id) => window.clearTimeout(id));
      setJobs([]);
    };
  }, [pathname]);

  return (
    <div aria-hidden="true" className="pointer-events-none fixed inset-0 z-[90] overflow-hidden">
      {jobs.map((job) => (
        <motion.div
          key={`box-${job.id}`}
          className="absolute rounded-lg border border-dashed"
          style={{ left: job.box.x, top: job.box.y, width: job.box.w, height: job.box.h, borderColor: job.color }}
          initial={{ opacity: 0, scale: 0.94 }}
          animate={job.built ? { opacity: 0, scale: 1.01 } : { opacity: 1, scale: 1 }}
          transition={{ duration: job.built ? 0.8 : 0.5, ease: "easeOut" }}
        />
      ))}
      {jobs.flatMap((job) =>
        job.cursors.map((cursor) => (
          <motion.div
            key={cursor.id}
            className="absolute left-0 top-0"
            initial={{ x: cursor.from.x, y: cursor.from.y, opacity: 0 }}
            animate={job.built ? { opacity: 0, x: cursor.to.x + 60, y: cursor.to.y + 40 } : { x: cursor.to.x, y: cursor.to.y, opacity: 1 }}
            transition={{ duration: job.built ? 0.6 : cursor.duration, delay: job.built ? 0 : cursor.delay, ease: [0.22, 1, 0.36, 1] }}
          >
            <svg width="22" height="22" viewBox="0 0 22 22" fill="none" className="drop-shadow-[0_2px_6px_rgb(0_0_0/0.5)]">
              <path d="M3 2l15 7.2-6.3 1.9L9.2 18 3 2z" fill={cursor.color} stroke="#07080c" strokeWidth="1.2" strokeLinejoin="round" />
            </svg>
            <span
              className="ml-4 -mt-1 inline-block rounded-md px-2 py-0.5 font-mono text-[10px] font-semibold text-[#07080c]"
              style={{ background: cursor.color }}
            >
              {cursor.label}
            </span>
          </motion.div>
        )),
      )}
    </div>
  );
}
