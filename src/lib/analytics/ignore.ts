/**
 * Позначка «свій пристрій»: засновники, команда й тестувальники не повинні потрапляти в статистику.
 * Це не відстеження, а навпаки відмова від нього: cookie лише повідомляє серверу, що події з цього браузера ігнорувати.
 * Ставиться автоматично при відкритті адмінки або посиланням `?notrack=1`; знімається `?notrack=0`.
 */
export const IGNORE_COOKIE = "bonsi_ignore";
const ONE_YEAR = 60 * 60 * 24 * 365;

/** Чи є позначка в заголовку Cookie запиту (сервер) або в document.cookie (браузер). */
export function hasIgnoreCookie(cookieHeader: string | null | undefined): boolean {
  if (!cookieHeader) return false;
  return cookieHeader.split(";").some((part) => part.trim() === `${IGNORE_COOKIE}=1`);
}

/** Рядок для document.cookie: вмикає або вимикає ігнорування цього браузера. */
export function ignoreCookieString(on: boolean): string {
  const secure = typeof location !== "undefined" && location.protocol === "https:" ? "; Secure" : "";
  return `${IGNORE_COOKIE}=${on ? "1" : ""}; Path=/; Max-Age=${on ? ONE_YEAR : 0}; SameSite=Lax${secure}`;
}
