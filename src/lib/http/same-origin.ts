import { site } from "@/lib/site";

/**
 * Міжсайтовий захист для запитів, що змінюють стан: якщо браузер надіслав Origin, він має збігатися з хостом запиту
 * або з публічною адресою сайту. Запити без Origin (сервер-сервер) не є CSRF: браузер завжди додає Origin до міжсайтових POST.
 */
export function isSameOrigin(request: Request): boolean {
  const origin = request.headers.get("origin");
  if (!origin) return true;
  let originHost: string;
  try {
    originHost = new URL(origin).host;
  } catch {
    return false;
  }
  const allowed = new Set<string>();
  const host = request.headers.get("host");
  if (host) allowed.add(host);
  try {
    allowed.add(new URL(site.url).host);
  } catch {
    // site.url некоректний — лишається перевірка за Host
  }
  return allowed.has(originHost);
}
