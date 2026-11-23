"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";

/**
 * Вступ головної: на чорному екрані «друкується» код проєкту (редактор із підсвіткою синтаксису),
 * потім завіса знімається, і елементи hero по черзі з'являються (data-build → data-built).
 * Курсори, що збирають решту сайту, працюють окремо під час прокрутки (див. ScrollBuilder).
 *
 * Показується лише коли inline-скрипт у page.tsx виставив html[data-intro="play"].
 * Без JS або при помилці сайт видимий: CSS-запобіжник у globals.css знімає завісу через 16 с.
 */

const CODE = `// bonsi.studio — build.ts
import { Project } from "@bonsi/studio";

const site = new Project({
  name: "your-business",
  stack: ["Next.js", "TypeScript", "Three.js"],
  responsive: true,
});

await site.design();   // макети й дизайн-система
await site.develop();  // код та інтеграції
await site.launch();   // запуск і підтримка

export default site;`;

const KEYWORDS = new Set(["import", "from", "const", "new", "await", "export", "default", "true", "false"]);

type Token = { text: string; cls: string };

/** Мінімальний підсвічувач синтаксису: коментарі, рядки, ключові слова, виклики. */
function tokenize(source: string): Token[] {
  const tokens: Token[] = [];
  const pattern = /(\/\/[^\n]*)|("[^"\n]*")|(\b[A-Za-z_]\w*\b)|(\s+)|(.)/g;
  let match: RegExpExecArray | null;
  while ((match = pattern.exec(source)) !== null) {
    const [text, comment, string, word] = match;
    if (comment) tokens.push({ text, cls: "text-[#6b7686] italic" });
    else if (string) tokens.push({ text, cls: "text-[#9be3b0]" });
    else if (word) {
      if (KEYWORDS.has(text)) tokens.push({ text, cls: "text-[#c6a8ff]" });
      else if (/^[A-Z]/.test(text)) tokens.push({ text, cls: "text-[#7fd0ff]" });
      else tokens.push({ text, cls: "text-[#e6e9ef]" });
    } else tokens.push({ text, cls: "text-[#aab1ba]" });
  }
  return tokens;
}

type Phase = "idle" | "typing" | "reveal" | "done";

export function HomeIntro() {
  const tokens = useMemo(() => tokenize(CODE), []);
  const total = CODE.length;
  const [phase, setPhase] = useState<Phase>("idle");
  const [typed, setTyped] = useState(0);
  const timers = useRef<number[]>([]);
  const doneRef = useRef(false);

  const finish = useCallback(() => {
    if (doneRef.current) return;
    doneRef.current = true;
    timers.current.forEach((id) => window.clearTimeout(id));
    document.querySelectorAll<HTMLElement>("[data-build]").forEach((el) => el.setAttribute("data-built", ""));
    document.documentElement.dataset.intro = "done";
    document.body.style.overflow = "";
    try {
      sessionStorage.setItem("bonsi-intro", "1");
    } catch {
      /* сховище недоступне — не критично */
    }
    setPhase("done");
  }, []);

  /** Завіса зникає, елементи hero проявляються по черзі. */
  const reveal = useCallback(() => {
    setPhase("reveal");
    const items = Array.from(document.querySelectorAll<HTMLElement>("[data-build]"));
    items.forEach((el, index) => {
      timers.current.push(window.setTimeout(() => el.setAttribute("data-built", ""), 250 + index * 130));
    });
    timers.current.push(window.setTimeout(finish, 250 + items.length * 130 + 900));
  }, [finish]);

  // Запуск: лише якщо inline-скрипт дозволив показ.
  useEffect(() => {
    const root = document.documentElement;
    if (root.dataset.intro !== "play") {
      setPhase("done");
      return;
    }
    setPhase("typing");
    document.body.style.overflow = "hidden";
    window.scrollTo(0, 0);
    const pending = timers.current;
    return () => {
      document.body.style.overflow = "";
      pending.forEach((id) => window.clearTimeout(id));
    };
  }, []);

  // Друк коду: за реальним часом (≈125 символів/с), а не за кількістю тиків, щоб не гальмувати при навантаженні.
  useEffect(() => {
    if (phase !== "typing") return;
    const start = performance.now();
    let frame = 0;
    const tick = (now: number) => {
      const count = Math.min(total, Math.floor((now - start) * 0.125));
      setTyped(count);
      if (count < total) frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, [phase, total]);

  useEffect(() => {
    if (phase === "typing" && typed >= total) {
      const id = window.setTimeout(reveal, 600);
      return () => window.clearTimeout(id);
    }
  }, [phase, typed, total, reveal]);

  // Пропуск: Escape.
  useEffect(() => {
    if (phase === "idle" || phase === "done") return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") finish();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [phase, finish]);

  if (phase === "done") return null;

  // Скільки символів показати, з підсвіткою.
  let remaining = typed;
  const visible: Token[] = [];
  for (const token of tokens) {
    if (remaining <= 0) break;
    visible.push(remaining >= token.text.length ? token : { ...token, text: token.text.slice(0, remaining) });
    remaining -= token.text.length;
  }

  const revealing = phase === "reveal";

  return (
    <div className="intro-overlay fixed inset-0 z-[100] items-center justify-center" role="presentation">
      {/* Завіса */}
      <div
        aria-hidden="true"
        className="absolute inset-0 bg-[#07080c] transition-opacity duration-[1200ms] ease-out"
        style={{ opacity: revealing ? 0 : 1 }}
      />

      {/* Редактор коду */}
      <div
        aria-hidden="true"
        className="relative w-[min(46rem,92vw)] overflow-hidden rounded-xl border border-white/10 bg-[#0d1017] shadow-[0_40px_120px_-30px_rgb(108_76_245/0.45)] transition-[opacity,transform] duration-700"
        style={{ opacity: revealing ? 0 : 1, transform: revealing ? "scale(0.94)" : "none" }}
      >
        <div className="flex items-center gap-2 border-b border-white/10 px-4 py-3">
          <span className="size-2.5 rounded-full bg-[#ff5f57]" />
          <span className="size-2.5 rounded-full bg-[#febc2e]" />
          <span className="size-2.5 rounded-full bg-[#28c840]" />
          <span className="ml-3 font-mono text-xs text-[#8b94a1]">build.ts</span>
        </div>
        <pre className="min-h-[19.5rem] overflow-hidden whitespace-pre-wrap p-4 font-mono text-[11.5px] leading-[1.7] sm:min-h-[23rem] sm:p-6 sm:text-[14px]">
          <code>
            {visible.map((token, index) => (
              <span key={index} className={token.cls}>
                {token.text}
              </span>
            ))}
            <span className="ml-px inline-block h-[1.1em] w-[0.55ch] translate-y-[0.18em] bg-[#a591ff] [animation:caret-blink_1s_steps(1)_infinite]" />
          </code>
        </pre>
      </div>

      <button
        type="button"
        onClick={finish}
        className="absolute bottom-6 right-6 min-h-11 rounded-lg border border-white/15 bg-white/5 px-4 font-mono text-xs uppercase tracking-[0.14em] text-[#cfd4dc] transition-colors hover:bg-white/10"
      >
        Пропустити
      </button>
    </div>
  );
}
