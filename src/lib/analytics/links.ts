import { z } from "zod";

/** Сторінки, на які можна вести трафік зі стікера чи реклами. Шлях має існувати на сайті. */
export const DESTINATIONS = [
  { path: "/", label: "Головна" },
  { path: "/services", label: "Послуги" },
  { path: "/pricing", label: "Ціни" },
  { path: "/portfolio", label: "Портфоліо" },
  { path: "/cooperation", label: "Співпраця" },
  { path: "/about", label: "Про нас" },
  { path: "/contact", label: "Контакти" },
] as const;

/** Готові набори «джерело / канал» для найтиповіших випадків; значення можна змінити вручну. */
export const PRESETS = [
  { id: "sticker", label: "QR-стікер", source: "sticker", medium: "qr" },
  { id: "flyer", label: "Флаєр / візитка", source: "flyer", medium: "print" },
  { id: "instagram-ads", label: "Instagram реклама", source: "instagram", medium: "cpc" },
  { id: "facebook-ads", label: "Facebook реклама", source: "facebook", medium: "cpc" },
  { id: "google-ads", label: "Google Ads", source: "google", medium: "cpc" },
  { id: "tiktok-ads", label: "TikTok реклама", source: "tiktok", medium: "cpc" },
  { id: "telegram", label: "Telegram", source: "telegram", medium: "social" },
  { id: "influencer", label: "Блогер / інтеграція", source: "influencer", medium: "referral" },
] as const;

/** Перетворює довільну назву на код для адреси: латиниця, цифри, дефіси. Кирилицю транслітеруємо. */
const TRANSLIT: Record<string, string> = {
  а: "a", б: "b", в: "v", г: "h", ґ: "g", д: "d", е: "e", є: "ye", ж: "zh", з: "z", и: "y", і: "i", ї: "i",
  й: "y", к: "k", л: "l", м: "m", н: "n", о: "o", п: "p", р: "r", с: "s", т: "t", у: "u", ф: "f", х: "kh",
  ц: "ts", ч: "ch", ш: "sh", щ: "shch", ь: "", ю: "yu", я: "ya", ы: "y", э: "e", ё: "yo", ъ: "",
};

export function slugify(value: string, max = 40): string {
  const transliterated = [...value.toLowerCase()].map((char) => TRANSLIT[char] ?? char).join("");
  return transliterated
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, max)
    .replace(/-+$/g, "");
}

const token = (max: number) =>
  z
    .string()
    .trim()
    .toLowerCase()
    .regex(/^[a-z0-9][a-z0-9_.-]*$/, "Лише латиниця, цифри, «_», «.» і «-».")
    .max(max);

const optionalToken = (max: number) =>
  z
    .string()
    .trim()
    .toLowerCase()
    .max(max)
    .refine((value) => value === "" || /^[a-z0-9][a-z0-9_.-]*$/.test(value), "Лише латиниця, цифри, «_», «.» і «-».");

export const linkInput = z.object({
  name: z.string().trim().min(1, "Вкажіть назву.").max(120),
  code: z
    .string()
    .trim()
    .toLowerCase()
    .regex(/^[a-z0-9][a-z0-9-]{1,38}[a-z0-9]$/, "Код: 3–40 символів, латиниця, цифри й дефіс, без дефіса на краях."),
  destination: z.enum(DESTINATIONS.map((item) => item.path) as [string, ...string[]]),
  source: token(60),
  medium: token(60),
  campaign: optionalToken(80),
  content: optionalToken(80),
  note: z.string().trim().max(500),
});

export type LinkInput = z.infer<typeof linkInput>;

/** Коротке посилання для QR: рахує скани на сервері й веде на сторінку з мітками. */
export function shortUrl(baseUrl: string, code: string): string {
  return `${baseUrl.replace(/\/$/, "")}/go/${code}`;
}

/** Пряме UTM-посилання для рекламних кабінетів: платформа рахує кліки сама, а сайт бачить мітки. */
export function utmUrl(
  baseUrl: string,
  link: { destination: string; source: string; medium: string; campaign?: string | null; content?: string | null; code: string },
): string {
  const url = new URL(link.destination, `${baseUrl.replace(/\/$/, "")}/`);
  url.searchParams.set("utm_source", link.source);
  url.searchParams.set("utm_medium", link.medium);
  if (link.campaign) url.searchParams.set("utm_campaign", link.campaign);
  if (link.content) url.searchParams.set("utm_content", link.content);
  url.searchParams.set("lc", link.code);
  return url.toString();
}
