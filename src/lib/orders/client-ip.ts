import { isIP } from "node:net";

/**
 * Визначення IP клієнта лише з ЯВНО довірених джерел.
 *
 * Заголовок X-Forwarded-For клієнт може підробити, тому його не можна читати «як є».
 * Режими (змінна TRUSTED_PROXY):
 *  - none        — жодному заголовку не довіряємо, IP невідомий (безпечне значення за замовчуванням);
 *  - vercel      — Vercel сам перезаписує заголовки (x-vercel-forwarded-for / x-real-ip);
 *  - cloudflare  — cf-connecting-ip; довіряти лише якщо origin доступний виключно через Cloudflare;
 *  - hops:N      — за N довіреними reverse-proxy, що ДОДАЮТЬ адресу в кінець X-Forwarded-For;
 *                  беремо N-й елемент з кінця, а не перший (перший контролює клієнт).
 *
 * Якщо TRUSTED_PROXY не задано: на Vercel (змінна VERCEL) — vercel, в інших місцях — none.
 */
export type TrustedProxy =
  | { kind: "none" }
  | { kind: "vercel" }
  | { kind: "cloudflare" }
  | { kind: "hops"; count: number };

export function parseTrustedProxy(
  value: string | undefined,
  env: Record<string, string | undefined> = process.env,
): TrustedProxy {
  const normalized = (value ?? "").trim().toLowerCase();
  if (normalized === "") return env.VERCEL ? { kind: "vercel" } : { kind: "none" };
  if (normalized === "none") return { kind: "none" };
  if (normalized === "vercel") return { kind: "vercel" };
  if (normalized === "cloudflare") return { kind: "cloudflare" };
  const hops = /^hops:(\d{1,2})$/.exec(normalized);
  if (hops && Number(hops[1]) >= 1) return { kind: "hops", count: Number(hops[1]) };
  throw new Error(`Некоректне значення TRUSTED_PROXY: "${value}"`);
}

/** Прибирає порт і квадратні дужки, перевіряє, що це справжня IP-адреса. */
function sanitize(raw: string | null | undefined): string | null {
  if (!raw) return null;
  let value = raw.trim();
  if (value === "") return null;

  const bracketed = /^\[([0-9a-fA-F:.]+)\](?::\d+)?$/.exec(value);
  if (bracketed) value = bracketed[1]!;
  else if (/^\d{1,3}(?:\.\d{1,3}){3}:\d+$/.test(value)) value = value.replace(/:\d+$/, "");

  return isIP(value) ? value.toLowerCase() : null;
}

export function getClientIp(headers: Headers, proxy: TrustedProxy): string | null {
  switch (proxy.kind) {
    case "none":
      return null;
    case "vercel":
      return (
        sanitize(headers.get("x-vercel-forwarded-for")?.split(",")[0]) ??
        sanitize(headers.get("x-real-ip")) ??
        sanitize(headers.get("x-forwarded-for")?.split(",")[0])
      );
    case "cloudflare":
      return sanitize(headers.get("cf-connecting-ip"));
    case "hops": {
      const chain = (headers.get("x-forwarded-for") ?? "")
        .split(",")
        .map((part) => part.trim())
        .filter(Boolean);
      return sanitize(chain[chain.length - proxy.count]);
    }
  }
}

function expandIPv6(ip: string): string[] | null {
  const zone = ip.indexOf("%");
  const address = zone === -1 ? ip : ip.slice(0, zone);
  const halves = address.split("::");
  if (halves.length > 2) return null;
  const head = halves[0] ? halves[0].split(":") : [];
  const tail = halves.length === 2 && halves[1] ? halves[1].split(":") : [];
  let groups: string[];
  if (halves.length === 2) {
    const missing = 8 - head.length - tail.length;
    if (missing < 0) return null;
    groups = [...head, ...Array<string>(missing).fill("0"), ...tail];
  } else {
    groups = head;
  }
  if (groups.length !== 8) return null;
  const parsed = groups.map((group) => Number.parseInt(group, 16));
  if (parsed.some((n) => Number.isNaN(n) || n < 0 || n > 0xffff)) return null;
  return parsed.map((n) => n.toString(16));
}

/**
 * Ключ для лімітів: IPv4 — як є, IPv6 — підмережа /64 (одному клієнту
 * зазвичай належить цілий /64, тож ротація адрес усередині нього не обходить ліміт).
 */
export function ipBucket(ip: string | null): string | null {
  if (!ip) return null;
  const mapped = /^::ffff:(\d{1,3}(?:\.\d{1,3}){3})$/i.exec(ip);
  if (mapped) return mapped[1]!;
  if (isIP(ip) === 4) return ip;
  const groups = expandIPv6(ip);
  if (!groups) return ip;
  return `${groups.slice(0, 4).join(":")}::/64`;
}
