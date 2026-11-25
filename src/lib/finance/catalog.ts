import { z } from "zod";
import { services, supportPlans } from "@/lib/services";

/** Усе, що пропонує студія, як швидкий вибір доходу. Ціна «від» підставляється, але її можна змінити. */
export type IncomeItem = { id: string; label: string; group: "Послуги" | "Підтримка"; price: number | null };

export const INCOME_ITEMS: IncomeItem[] = [
  ...services
    .filter((service) => service.id !== "support")
    .map((service) => ({ id: service.id, label: service.title, group: "Послуги" as const, price: service.priceFrom })),
  ...supportPlans.map((plan) => ({
    id: `support-${plan.id}`,
    label: `Підтримка ${plan.title} (за місяць)`,
    group: "Підтримка" as const,
    price: plan.price,
  })),
];

/** Власна позиція, якщо послуги немає в прайсі (разова робота, правки тощо). */
export const CUSTOM_INCOME = "custom";

export const EXPENSE_CATEGORIES = [
  "Реклама",
  "Стікери та друк",
  "Хостинг і домен",
  "Сервіси та підписки",
  "Підрядники",
  "Податки та збори",
  "Обладнання",
  "Інше",
] as const;

export const INCOME_CATEGORIES = ["Послуги", "Підтримка", "Інше"] as const;

/** Сума з коми чи крапки, пробіли й нерозривні пробіли ігноруються. */
export function parseAmount(value: string): number | null {
  const normalized = value.replace(/[\s ]/g, "").replace(",", ".");
  if (!/^\d+(\.\d{1,2})?$/.test(normalized)) return null;
  const amount = Number(normalized);
  return amount > 0 && amount <= 100_000_000 ? amount : null;
}

const isoDate = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, "Вкажіть дату.")
  .refine((value) => {
    const date = new Date(`${value}T00:00:00Z`);
    return !Number.isNaN(date.getTime()) && date.toISOString().slice(0, 10) === value;
  }, "Некоректна дата.");

export const financeInput = z.object({
  kind: z.enum(["income", "expense"]),
  date: isoDate,
  category: z.string().trim().min(1, "Оберіть категорію.").max(60),
  title: z.string().trim().min(1, "Вкажіть назву.").max(160),
  amount: z
    .string()
    .transform((value, ctx) => {
      const amount = parseAmount(value);
      if (amount === null) {
        ctx.addIssue({ code: "custom", message: "Сума: число більше 0, до двох знаків після коми." });
        return z.NEVER;
      }
      return amount;
    }),
  client: z.string().trim().max(120),
  note: z.string().trim().max(500),
});

export type FinanceInput = z.infer<typeof financeInput>;

const money = new Intl.NumberFormat("uk-UA", { style: "currency", currency: "UAH", maximumFractionDigits: 2 });

export function formatMoney(value: number): string {
  return money.format(value);
}

/** «+12 000 ₴» / «−3 000 ₴»: знак видно одразу, мінус — справжній мінус. */
export function formatSigned(value: number): string {
  if (value === 0) return formatMoney(0);
  return `${value > 0 ? "+" : "−"}${formatMoney(Math.abs(value))}`;
}

/** Перший день місяця (YYYY-MM-01) із параметра `m`; некоректне значення — поточний місяць за Києвом. */
export function resolveMonth(value: string | undefined, now = new Date()): string {
  if (value && /^\d{4}-(0[1-9]|1[0-2])$/.test(value)) return `${value}-01`;
  const kyiv = new Intl.DateTimeFormat("sv-SE", { timeZone: "Europe/Kyiv" }).format(now);
  return `${kyiv.slice(0, 7)}-01`;
}

export function shiftMonth(month: string, delta: number): string {
  const [year, mon] = month.split("-").map(Number) as [number, number];
  const date = new Date(Date.UTC(year, mon - 1 + delta, 1));
  return date.toISOString().slice(0, 10);
}

const monthFormat = new Intl.DateTimeFormat("uk-UA", { month: "long", year: "numeric", timeZone: "UTC" });

export function monthLabel(month: string): string {
  const label = monthFormat.format(new Date(`${month}T00:00:00Z`));
  return label.charAt(0).toUpperCase() + label.slice(1);
}

/** Сьогоднішня дата за Києвом у форматі YYYY-MM-DD (для значення за замовчуванням). */
export function todayKyiv(now = new Date()): string {
  return new Intl.DateTimeFormat("sv-SE", { timeZone: "Europe/Kyiv" }).format(now);
}
