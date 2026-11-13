import { services } from "@/lib/services";
import { site } from "@/lib/site";

/** Куди надсилати: чат і, для форум-груп, конкретна гілка (topic). */
export type TelegramTarget = { chatId: string; threadId?: number };

/** Усе, що потрібно для Telegram, лежить лише в серверних змінних середовища. */
export type TelegramConfig = { token: string; targets: TelegramTarget[] };

/**
 * `TELEGRAM_CHAT_IDS` — chat id через кому. Для гілки форум-групи пишеться
 * `chatId:threadId`, напр. `-1001234567890:45`. Для гілки General thread id
 * не вказується. Некоректні записи ігноруються.
 */
export function parseTelegramTargets(raw: string): TelegramTarget[] {
  const targets: TelegramTarget[] = [];
  for (const entry of raw.split(",")) {
    const match = entry.trim().match(/^(-?\d{1,20})(?::(\d{1,20}))?$/);
    if (!match) continue;
    const threadId = match[2] === undefined ? undefined : Number(match[2]);
    if (threadId !== undefined && (!Number.isSafeInteger(threadId) || threadId <= 0)) continue;
    targets.push(threadId === undefined ? { chatId: match[1]! } : { chatId: match[1]!, threadId });
  }
  return targets;
}

export function getTelegramConfig(env: NodeJS.ProcessEnv = process.env): TelegramConfig | null {
  const token = env.TELEGRAM_BOT_TOKEN?.trim();
  const targets = parseTelegramTargets(env.TELEGRAM_CHAT_IDS ?? "");
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

export type OrderNotice = {
  orderId: string;
  ticket: string;
  service: string;
  name: string;
  createdAt: string;
};

const timeFormat = new Intl.DateTimeFormat("uk-UA", {
  dateStyle: "short",
  timeStyle: "short",
  timeZone: "Europe/Kyiv",
});

/**
 * Лише мінімум: номер, послуга, імʼя, час і посилання. Email, телефон, бюджет та опис ідеї
 * у Telegram не надсилаються — їх видно тільки в захищеній адмін-панелі.
 */
export function formatOrderMessage(notice: OrderNotice, baseUrl: string = site.url): string {
  const serviceTitle = services.find((item) => item.id === notice.service)?.title ?? notice.service;
  const link = `${baseUrl.replace(/\/$/, "")}/admin/orders/${encodeURIComponent(notice.orderId)}`;
  return [
    `<b>Нова заявка ${escapeHtml(notice.ticket)}</b>`,
    `Послуга: ${escapeHtml(serviceTitle)}`,
    `Клієнт: ${escapeHtml(notice.name)}`,
    `Час: ${escapeHtml(timeFormat.format(new Date(notice.createdAt)))}`,
    `<a href="${escapeHtml(link)}">Відкрити в адмінпанелі</a>`,
  ].join("\n");
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
