/**
 * Святкові знижки. Діють автоматично щороку за київським часом: у вікні — ціни зі знижкою,
 * поза вікном ціни самі повертаються до звичайних (ні редагування, ні деплою не потрібно).
 * Щоб змінити дати чи відсоток — правте лише PROMOS нижче.
 */
export type Promo = {
  id: string;
  label: string;
  discountPercent: number;
  /** Початок і кінець ВКЛЮЧНО, формат [місяць, день]. Вікно може переходити через Новий рік. */
  from: readonly [month: number, day: number];
  to: readonly [month: number, day: number];
};

export const PROMOS: readonly Promo[] = [
  { id: "new-year", label: "Новорічна знижка", discountPercent: 40, from: [12, 6], to: [1, 2] },
];

const kyivParts = new Intl.DateTimeFormat("en-CA", {
  timeZone: "Europe/Kyiv",
  month: "numeric",
  day: "numeric",
});

function kyivMonthDay(date: Date): number {
  const parts = kyivParts.formatToParts(date);
  const month = Number(parts.find((p) => p.type === "month")?.value);
  const day = Number(parts.find((p) => p.type === "day")?.value);
  return month * 100 + day;
}

export function getActivePromo(now: Date = new Date(), promos: readonly Promo[] = PROMOS): Promo | null {
  const today = kyivMonthDay(now);
  for (const promo of promos) {
    const start = promo.from[0] * 100 + promo.from[1];
    const end = promo.to[0] * 100 + promo.to[1];
    const active = start <= end ? today >= start && today <= end : today >= start || today <= end;
    if (active) return promo;
  }
  return null;
}

export function discountedAmount(amount: number, percent: number): number {
  return Math.round((amount * (1 - percent / 100)) / 10) * 10;
}

export function formatAmount(amount: number): string {
  return String(amount).replace(/\B(?=(\d{3})+(?!\d))/g, " ");
}

/** Підставляє нову суму в готовий підпис ціни («від 3 000 ₴» → «від 1 800 ₴»). */
export function replaceAmountInLabel(label: string, amount: number): string {
  return label.replace(/\d[\d\s ]*\d|\d/, formatAmount(amount));
}
