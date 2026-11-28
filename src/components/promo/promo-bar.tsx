import Link from "next/link";
import { PROMO_DISCOUNT } from "@/lib/promo";

const items = [
  "День святого Миколая · 6 грудня",
  `−${PROMO_DISCOUNT}% на всі сайти`,
  "Різдво · 25 грудня",
  `−${PROMO_DISCOUNT}% на розробку й дизайн`,
  "Новий рік · 1 січня",
  "Акція до 2 січня",
];

/** Тонка святкова стрічка над шапкою. Видима лише при html[data-promo="on"]. */
export function PromoBar() {
  return (
    <div className="promo-only promo-bar relative z-[60] overflow-hidden border-b border-white/10 text-[0.72rem]">
      <Link href="/#order" aria-label={`Зимова акція −${PROMO_DISCOUNT}% до 2 січня. Обговорити проєкт`} className="marquee block py-2">
        <div className="marquee-track font-mono uppercase tracking-[0.2em] text-white">
          {[...items, ...items, ...items, ...items].map((text, i) => (
            <span key={i} aria-hidden={i >= items.length ? true : undefined} className="flex shrink-0 items-center gap-6 pr-6">
              {text}
              <span aria-hidden="true" className="text-[#ffd98a]">✦</span>
            </span>
          ))}
        </div>
      </Link>
    </div>
  );
}
