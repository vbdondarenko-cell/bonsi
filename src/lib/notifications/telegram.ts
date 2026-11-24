import type { ServiceId } from "@/lib/orders/options";
import { buildSummary } from "@/lib/orders/summary";
import { services } from "@/lib/services";
import { site } from "@/lib/site";

/** Куди надсилати: чат і, для форум-груп, конкретна гілка (topic). */
export type TelegramTarget = { chatId: string; threadId?: number };

/** Усе, що потрібно для Telegram, лежить лише в серверних змінних середовища. */
export type TelegramConfig = { token: string; targets: TelegramTarget[] };

/**
 * `TELEGRAM_CHAT_IDS` — лише від'ємні ID адмінських груп, через кому. Для гілки форум-групи пишеться
 * `chatId:threadId`, напр. `-1001234567890:45`. Для гілки General thread id
 * не вказується. Некоректні записи ігноруються.
 */
export function parseTelegramTargets(raw: string): TelegramTarget[] {
  const targets: TelegramTarget[] = [];
  for (const entry of raw.split(",")) {
    const match = entry.trim().match(/^(-\d{1,20})(?::(\d{1,20}))?$/);
    if (!match) continue;
    const threadId = match[2] === undefined ? undefined : Number(match[2]);
    if (threadId !== undefined && (!Number.isSafeInteger(threadId) || threadId <= 0)) continue;
    targets.push(threadId === undefined ? { chatId: match[1]! } : { chatId: match[1]!, threadId });
  }
  return targets;
}

export function getTelegramConfig(env: NodeJS.ProcessEnv = process.env): TelegramConfig | null {
  const token = env.TELEGRAM_BOT_TOKEN?.trim();
  // Основна змінна — TELEGRAM_CHAT_IDS. Підтримуємо й пару TELEGRAM_CHAT_ID + TELEGRAM_MESSAGE_THREAD_ID (одна група).
  let rawTargets = env.TELEGRAM_CHAT_IDS ?? "";
  if (!rawTargets.trim() && env.TELEGRAM_CHAT_ID?.trim()) {
    const thread = env.TELEGRAM_MESSAGE_THREAD_ID?.trim();
    rawTargets = thread && /^\d{1,20}$/.test(thread) ? `${env.TELEGRAM_CHAT_ID.trim()}:${thread}` : env.TELEGRAM_CHAT_ID.trim();
  }
  const targets = parseTelegramTargets(rawTargets);
  if (!token || targets.length === 0) return null;
  return { token, targets };
}

/** Інтеграція вимкнена, доки не задано токен і хоча б один chat id: сайт при цьому працює як завжди. */
export function isTelegramEnabled(env: NodeJS.ProcessEnv = process.env): boolean {
  return getTelegramConfig(env) !== null;
}

export function escapeHtml(value: string): string {
  return value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

/** Повна заявка для внутрішньої групи студії: контакти й відповіді клієнта. */
export type OrderBrief = {
  email?: string | null;
  phone?: string | null;
  idea?: string | null;
  deadline?: string | null;
  details?: Record<string, string> | null;
  links?: string[] | null;
};

export type OrderNotice = {
  orderId: string;
  ticket: string;
  service: string;
  name: string;
  createdAt: string;
  /** Якщо передано, повідомлення містить повну заявку; інакше лише номер і посилання. */
  brief?: OrderBrief;
};

const IDEA_LIMIT_IN_MESSAGE = 1500;

const timeFormat = new Intl.DateTimeFormat("uk-UA", {
  dateStyle: "short",
  timeStyle: "short",
  timeZone: "Europe/Kyiv",
});

/**
 * Без `brief` — лише мінімум: номер, послуга, імʼя, час і посилання. З `brief` (внутрішня група студії)
 * додається вся заявка: контакти клієнта, відповіді на уточнення, терміни, опис і посилання.
 */
export function formatOrderMessage(notice: OrderNotice, baseUrl: string = site.url): string {
  const serviceTitle = services.find((item) => item.id === notice.service)?.title ?? notice.service;
  void baseUrl; // Адмінки на сайті немає: повідомлення самодостатнє, без посилання.
  const lines = [
    `<b>Нова заявка ${escapeHtml(notice.ticket)}</b>`,
    `Послуга: ${escapeHtml(serviceTitle)}`,
    `Клієнт: ${escapeHtml(notice.name)}`,
  ];

  const brief = notice.brief;
  if (brief) {
    if (brief.phone) lines.push(`Telegram / телефон: ${escapeHtml(brief.phone)}`);
    if (brief.email) lines.push(`Email: ${escapeHtml(brief.email)}`);
    const answers = buildSummary({
      service: services.some((item) => item.id === notice.service) ? (notice.service as ServiceId) : "landing",
      details: brief.details ?? undefined,
      deadline: brief.deadline ?? undefined,
      links: brief.links ?? undefined,
    }).filter((line) => line.label !== "Послуга");
    if (answers.length) lines.push("", ...answers.map((line) => `${escapeHtml(line.label)}: ${escapeHtml(line.value)}`));
    if (brief.idea?.trim()) {
      const idea = brief.idea.trim();
      const shown = idea.length > IDEA_LIMIT_IN_MESSAGE ? `${idea.slice(0, IDEA_LIMIT_IN_MESSAGE)}…` : idea;
      lines.push("", `Задача: ${escapeHtml(shown)}`);
    }
    lines.push("");
  }

  lines.push(`Час: ${escapeHtml(timeFormat.format(new Date(notice.createdAt)))}`);
  return lines.join("\n");
}

export class TelegramError extends Error {}

/** TELEGRAM_API_BASE задається лише в тестах (заглушка Telegram); у production лишається офіційний API. */
function apiBase(): string {
  const override = process.env.TELEGRAM_API_BASE;
  if (override && /^https?:\/\//.test(override)) return override.replace(/\/$/, "");
  return "https://api.telegram.org";
}

/** Надсилає повідомлення; у тексті помилки ніколи немає токена чи URL запиту. */
export async function sendTelegramMessage(
  config: TelegramConfig,
  target: TelegramTarget,
  text: string,
  fetchImpl: typeof fetch = fetch,
): Promise<void> {
  let response: Response;
  try {
    response = await fetchImpl(`${apiBase()}/bot${config.token}/sendMessage`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        chat_id: target.chatId,
        ...(target.threadId === undefined ? {} : { message_thread_id: target.threadId }),
        text,
        parse_mode: "HTML",
        disable_web_page_preview: true,
      }),
      signal: AbortSignal.timeout(8000),
    });
  } catch {
    throw new TelegramError("telegram: network error");
  }
  if (!response.ok) {
    throw new TelegramError(`telegram: HTTP ${response.status}`);
  }
}
