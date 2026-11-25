"use client";

import dynamic from "next/dynamic";
import { usePathname } from "next/navigation";
import { useReducedMotion } from "motion/react";
import { useEffect, useRef, useState } from "react";
import { createCoreState, prepareCrystalBlast, runCrystalBlast } from "./crystal-blast";

// three.js вантажиться окремим чанком лише в браузері: головний JS і LCP не страждають.
const SiteCanvas = dynamic(() => import("./site-canvas").then((module) => module.SiteCanvas), {
  ssr: false,
});

function hasWebGl() {
  try {
    const canvas = document.createElement("canvas");
    return Boolean(canvas.getContext("webgl2") ?? canvas.getContext("webgl"));
  } catch {
    return false;
  }
}

/**
 * Єдина 3D-сцена на фоні всього публічного сайту. Камера летить за прокруткою сторінки.
 * Без WebGL лишається темний градієнт; Reduce Motion — один статичний кадр.
 * Повністю декоративна: aria-hidden, без pointer-events.
 */
export function SiteScene() {
  const pathname = usePathname();
  const reduce = useReducedMotion() ?? false;
  const pointer = useRef({ x: 0, y: 0 });
  const progress = useRef(0);
  const core = useRef(createCoreState());
  const blasting = useRef(false);
  const cancelBlast = useRef<(() => void) | undefined>(undefined);
  const [ready, setReady] = useState(false);
  const [compact, setCompact] = useState(false);
  const [visible, setVisible] = useState(true);

  useEffect(() => {
    const choose = () => {
      setCompact(window.matchMedia("(max-width: 767px)").matches || (navigator.hardwareConcurrency ?? 8) <= 4);
      setReady(hasWebGl());
    };
    const schedule = () => {
      if (typeof window.requestIdleCallback === "function") {
        const id = window.requestIdleCallback(choose, { timeout: 1200 });
        return () => window.cancelIdleCallback(id);
      }
      const id = window.setTimeout(choose, 200);
      return () => window.clearTimeout(id);
    };
    const root = document.documentElement;
    // Поки грає вступна анімація, 3D не ініціалізуємо: щоб не відбирати процесор у друку коду й курсорів.
    if (root.dataset.intro === "play") {
      let cancel: (() => void) | undefined;
      const observer = new MutationObserver(() => {
        if (root.dataset.intro !== "play") {
          observer.disconnect();
          cancel = schedule();
        }
      });
      observer.observe(root, { attributes: true, attributeFilter: ["data-intro"] });
      return () => {
        observer.disconnect();
        cancel?.();
      };
    }
    return schedule();
  }, []);

  useEffect(() => {
    if (!ready) return;
    const onScroll = () => {
      const max = document.documentElement.scrollHeight - window.innerHeight;
      progress.current = max > 0 ? Math.min(1, Math.max(0, window.scrollY / max)) : 0;
    };
    // Клік саме по кристалу (не по посиланню чи кнопці поверх нього) запускає «схлопування» сайту.
    const interactive = "a,button,input,textarea,select,label,summary,[role='button'],[role='link'],[contenteditable]";
    const hitsCore = (event: MouseEvent | PointerEvent) => {
      const c = core.current;
      if (!c.r || c.scale < 0.9) return false;
      if (event.target instanceof Element && event.target.closest(interactive)) return false;
      return Math.hypot(event.clientX - c.x, event.clientY - c.y) <= c.r * 0.95;
    };
    const onPointer = (event: PointerEvent) => {
      if (event.pointerType !== "mouse") return;
      pointer.current.x = event.clientX / window.innerWidth - 0.5;
      pointer.current.y = event.clientY / window.innerHeight - 0.5;
      if (blasting.current) return;
      const over = hitsCore(event);
      document.body.style.cursor = over ? "pointer" : "";
      if (over) warm();
    };
    // Знімок сайту й шрифти готуємо заздалегідь: на першому ж наведенні на кристал.
    let warmed = false;
    const warm = () => {
      const root = document.querySelector<HTMLElement>("[data-site-content]");
      if (warmed || reduce || !root) return;
      warmed = true;
      prepareCrystalBlast(root);
    };
    const onClick = (event: MouseEvent) => {
      const root = document.querySelector<HTMLElement>("[data-site-content]");
      if (event.button !== 0 || blasting.current || reduce || !root) return;
      if (document.documentElement.dataset.intro === "play" || !hitsCore(event)) return;
      blasting.current = true;
      document.body.style.cursor = "";
      cancelBlast.current = runCrystalBlast({
        root,
        core: core.current,
        onDone: () => {
          blasting.current = false;
          cancelBlast.current = undefined;
        },
      });
    };
    const onVisibility = () => setVisible(!document.hidden);
    onScroll();
    window.addEventListener("scroll", onScroll, { passive: true });
    window.addEventListener("resize", onScroll, { passive: true });
    window.addEventListener("pointermove", onPointer, { passive: true });
    window.addEventListener("click", onClick);
    document.addEventListener("visibilitychange", onVisibility);
    return () => {
      window.removeEventListener("scroll", onScroll);
      window.removeEventListener("resize", onScroll);
      window.removeEventListener("pointermove", onPointer);
      window.removeEventListener("click", onClick);
      document.removeEventListener("visibilitychange", onVisibility);
      cancelBlast.current?.();
      cancelBlast.current = undefined;
      blasting.current = false;
      document.body.style.cursor = "";
    };
  }, [ready, reduce]);

  return (
    <div
      aria-hidden="true"
      data-allow-overflow
      // На внутрішніх сторінках (форми, документи) сцена приглушена, щоб не заважати читанню.
      className={`pointer-events-none fixed inset-0 z-0 transition-opacity duration-700 ${pathname === "/" ? "opacity-100" : "opacity-45"}`}
    >
      {/* Резервний фон без WebGL і до завантаження сцени. */}
      <div className="absolute inset-0 bg-[radial-gradient(ellipse_70%_55%_at_70%_20%,rgb(108_76_245/0.22),transparent_70%),radial-gradient(ellipse_60%_50%_at_10%_90%,rgb(108_76_245/0.12),transparent_70%)]" />
      {ready ? <SiteCanvas input={{ pointer, progress, core }} animate={!reduce && visible} compact={compact} /> : null}
      {/* Віньєтка для читабельності тексту поверх сцени. */}
      <div className="absolute inset-0 bg-[linear-gradient(90deg,rgb(7_8_12/0.62)_0%,rgb(7_8_12/0.28)_45%,transparent_75%),radial-gradient(ellipse_at_center,transparent_35%,rgb(7_8_12/0.5)_100%)]" />
    </div>
  );
}
