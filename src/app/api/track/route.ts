import { z } from "zod";
import { PayloadTooLargeError, readBodyLimited } from "@/lib/http/read-body";
import { isSameOrigin } from "@/lib/http/same-origin";
import { getClientIp, ipBucket, parseTrustedProxy } from "@/lib/orders/client-ip";
import {
  cleanLinkCode,
  cleanPath,
  cleanToken,
  hostOf,
  isBot,
} from "@/lib/analytics/attribution";
import { recordEvent, requestMeta, visitorHash } from "@/lib/analytics/events";
import { hasIgnoreCookie } from "@/lib/analytics/ignore";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const MAX_BODY_BYTES = 2_000;

const bodySchema = z.object({
  kind: z.enum(["pageview", "lead"]),
  path: z.string().max(300),
  landing: z.boolean().optional(),
  referrer: z.string().max(500).optional(),
  source: z.string().max(100).nullish(),
  medium: z.string().max(100).nullish(),
  campaign: z.string().max(120).nullish(),
  content: z.string().max(120).nullish(),
  linkCode: z.string().max(60).nullish(),
});

/** Відповідь без тіла: трекеру не потрібні подробиці, а помилки не повинні бачити відвідувачі. */
function empty(status = 204) {
  return new Response(null, { status, headers: { "Cache-Control": "no-store" } });
}

// Груба межа від накрутки в межах одного екземпляра функції; точної гарантії без спільного сховища немає.
const WINDOW_MS = 60_000;
const MAX_PER_WINDOW = 90;
const hits = new Map<string, { count: number; resetAt: number }>();

function overLimit(key: string): boolean {
  const now = Date.now();
  if (hits.size > 5_000) {
    for (const [k, v] of hits) if (v.resetAt <= now) hits.delete(k);
  }
  const entry = hits.get(key);
  if (!entry || entry.resetAt <= now) {
    hits.set(key, { count: 1, resetAt: now + WINDOW_MS });
    return false;
  }
  entry.count += 1;
  return entry.count > MAX_PER_WINDOW;
}

export async function POST(request: Request) {
  if (!isSameOrigin(request)) return empty(403);

  const contentType = request.headers.get("content-type") ?? "";
  if (!contentType.toLowerCase().startsWith("application/json")) return empty(415);

  // Користувач вимкнув відстеження в браузері (DNT / Global Privacy Control): нічого не записуємо.
  if (request.headers.get("dnt") === "1" || request.headers.get("sec-gpc") === "1") return empty();

  // Свої пристрої (засновники, команда, тести) не рахуємо: інакше статистика неточна.
  if (hasIgnoreCookie(request.headers.get("cookie"))) return empty();

  const userAgent = request.headers.get("user-agent");
  if (isBot(userAgent)) return empty();

  let raw: unknown;
  try {
    raw = JSON.parse(await readBodyLimited(request, MAX_BODY_BYTES));
  } catch (error) {
    return empty(error instanceof PayloadTooLargeError ? 413 : 400);
  }
  const parsed = bodySchema.safeParse(raw);
  if (!parsed.success) return empty(400);

  const path = cleanPath(parsed.data.path);
  if (!path) return empty(400);

  let bucket: string | null = null;
  try {
    bucket = ipBucket(getClientIp(request.headers, parseTrustedProxy(process.env.TRUSTED_PROXY)));
  } catch {
    bucket = null;
  }
  if (overLimit(bucket ?? "noip")) return empty(429);

  const visitor = visitorHash(request.headers);
  if (!visitor) {
    console.error("[analytics] ORDER_HASH_SALT не заданий або занадто короткий");
    return empty();
  }

  const { country, device } = requestMeta(request.headers);
  const landing = parsed.data.landing === true;
  await recordEvent({
    kind: parsed.data.kind,
    visitor,
    path,
    attribution: {
      source: cleanToken(parsed.data.source, 60),
      medium: cleanToken(parsed.data.medium, 60),
      campaign: cleanToken(parsed.data.campaign, 80),
      content: cleanToken(parsed.data.content, 80),
      linkCode: cleanLinkCode(parsed.data.linkCode),
    },
    // Реферер важливий лише для першого заходу: далі це внутрішня навігація.
    referrerHost: landing ? hostOf(parsed.data.referrer) : null,
    country,
    device,
    landing,
  });
  return empty();
}
