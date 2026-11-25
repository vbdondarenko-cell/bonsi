/**
 * Чиста логіка визначення джерела трафіку. Працює і в браузері (трекер), і на сервері (повторна перевірка).
 * Нічого не читає з середовища, тому легко тестується.
 */

export type Attribution = {
  source: string | null;
  medium: string | null;
  campaign: string | null;
  content: string | null;
  /** Код відстежуваного посилання (/go/<code>), якщо людина прийшла зі стікера чи оголошення. */
  linkCode: string | null;
};

export const EMPTY_ATTRIBUTION: Attribution = {
  source: null,
  medium: null,
  campaign: null,
  content: null,
  linkCode: null,
};

/** Приводить значення до безпечного токена (латиниця, цифри, `_`, `.`, `-`), або null, якщо нічого не лишилось. */
export function cleanToken(value: unknown, max = 60): string | null {
  if (typeof value !== "string") return null;
  const token = value
    .trim()
    .toLowerCase()
    .replace(/[\s]+/g, "-")
    .replace(/[^a-z0-9_.-]/g, "")
    .replace(/^[^a-z0-9]+/, "")
    .slice(0, max);
  return token === "" ? null : token;
}

/** Код посилання: ті самі правила, що й у базі (3–40 символів, латиниця/цифри/дефіс, без дефіса на краях). */
export function cleanLinkCode(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const code = value.trim().toLowerCase();
  return /^[a-z0-9][a-z0-9-]{1,38}[a-z0-9]$/.test(code) ? code : null;
}

/** Хост із URL реферера без `www.`; null для порожнього чи некоректного значення. */
export function hostOf(url: string | null | undefined): string | null {
  if (!url) return null;
  try {
    const host = new URL(url).hostname.toLowerCase().replace(/^www\./, "");
    return host === "" ? null : host.slice(0, 120);
  } catch {
    return null;
  }
}

type Known = { test: RegExp; source: string; medium: string };

// Порядок має значення: перший збіг виграє.
const KNOWN_REFERRERS: Known[] = [
  { test: /(^|\.)google\.[a-z.]+$/, source: "google", medium: "organic" },
  { test: /(^|\.)bing\.com$/, source: "bing", medium: "organic" },
  { test: /(^|\.)duckduckgo\.com$/, source: "duckduckgo", medium: "organic" },
  { test: /(^|\.)yahoo\.com$/, source: "yahoo", medium: "organic" },
  { test: /(^|\.)ecosia\.org$/, source: "ecosia", medium: "organic" },
  { test: /(^|\.)instagram\.com$/, source: "instagram", medium: "social" },
  { test: /(^|\.)facebook\.com$|(^|\.)fb\.com$|(^|\.)fb\.me$/, source: "facebook", medium: "social" },
  { test: /(^|\.)threads\.(net|com)$/, source: "threads", medium: "social" },
  { test: /(^|\.)t\.me$|(^|\.)telegram\.(org|me)$/, source: "telegram", medium: "social" },
  { test: /(^|\.)tiktok\.com$/, source: "tiktok", medium: "social" },
  { test: /(^|\.)youtube\.com$|(^|\.)youtu\.be$/, source: "youtube", medium: "social" },
  { test: /(^|\.)linkedin\.com$|(^|\.)lnkd\.in$/, source: "linkedin", medium: "social" },
  { test: /(^|\.)twitter\.com$|(^|\.)x\.com$|(^|\.)t\.co$/, source: "x", medium: "social" },
  { test: /(^|\.)pinterest\.[a-z.]+$/, source: "pinterest", medium: "social" },
  { test: /(^|\.)behance\.net$/, source: "behance", medium: "referral" },
];

/**
 * Джерело за рефереровим хостом. Власний хост (внутрішня навігація) і порожній реферер → null (прямий захід).
 */
export function attributionFromReferrer(
  referrerHost: string | null,
  ownHost: string | null,
): Pick<Attribution, "source" | "medium"> | null {
  if (!referrerHost) return null;
  const normalizedOwn = ownHost?.toLowerCase().replace(/^www\./, "") ?? null;
  if (normalizedOwn && (referrerHost === normalizedOwn || referrerHost.endsWith(`.${normalizedOwn}`))) return null;

  for (const known of KNOWN_REFERRERS) {
    if (known.test.test(referrerHost)) return { source: known.source, medium: known.medium };
  }
  return { source: cleanToken(referrerHost, 60), medium: "referral" };
}

/** Читає параметри атрибуції з адреси: utm_* та `lc` (код відстежуваного посилання). */
export function attributionFromParams(params: URLSearchParams): Attribution | null {
  const source = cleanToken(params.get("utm_source"), 60);
  const linkCode = cleanLinkCode(params.get("lc"));
  if (!source && !linkCode) return null;
  return {
    source: source ?? "link",
    medium: cleanToken(params.get("utm_medium"), 60) ?? (linkCode ? "link" : "unknown"),
    campaign: cleanToken(params.get("utm_campaign"), 80),
    content: cleanToken(params.get("utm_content") ?? params.get("utm_term"), 80),
    linkCode,
  };
}

/** Шлях сторінки без query/hash, обрізаний до безпечної довжини. */
export function cleanPath(value: unknown): string | null {
  if (typeof value !== "string" || !value.startsWith("/") || value.startsWith("//")) return null;
  const path = value.split(/[?#]/)[0]!.slice(0, 200);
  return /^\/[\x21-\x7e]*$/.test(path) ? path : null;
}

export type Device = "mobile" | "tablet" | "desktop";

export function parseDevice(userAgent: string): Device {
  if (/ipad|tablet|(android(?!.*mobile))/i.test(userAgent)) return "tablet";
  if (/mobi|iphone|ipod|android.*mobile|windows phone/i.test(userAgent)) return "mobile";
  return "desktop";
}

const BOT_PATTERN =
  /bot|crawl|spider|slurp|preview|facebookexternalhit|whatsapp|telegram|discord|skype|embedly|quora|pinterest|headless|lighthouse|pagespeed|gtmetrix|uptime|monitor|curl|wget|python-requests|httpclient|axios|node-fetch|go-http|java\//i;

/** Боти, парсери превʼю посилань і порожній User-Agent не рахуються відвідувачами. */
export function isBot(userAgent: string | null | undefined): boolean {
  if (!userAgent || userAgent.trim().length < 8) return true;
  return BOT_PATTERN.test(userAgent);
}

export function cleanCountry(value: string | null | undefined): string | null {
  const code = value?.trim().toUpperCase();
  return code && /^[A-Z]{2}$/.test(code) ? code : null;
}
