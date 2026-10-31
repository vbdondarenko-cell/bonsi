import { PayloadTooLargeError, readBodyLimited } from "@/lib/http/read-body";
import { getClientIp, ipBucket, parseTrustedProxy } from "@/lib/orders/client-ip";
import { orderSchema } from "@/lib/orders/schema";
import { ConfigError, RateLimitError, createOrder } from "@/lib/orders/service";
import { site } from "@/lib/site";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const MAX_BODY_BYTES = 20_000;
/** Людина не заповнить форму швидше за кілька секунд. */
const MIN_FILL_MS = 3_000;

function json(body: unknown, status: number) {
  return Response.json(body, {
    status,
    headers: { "Cache-Control": "no-store" },
  });
}

/**
 * Захист від міжсайтових запитів: якщо браузер надіслав Origin, він має збігатися
 * з хостом запиту або з публічною адресою сайту. Запити без Origin (curl, сервер-сервер)
 * не є CSRF — браузер завжди додає Origin до міжсайтових POST.
 */
function isAllowedOrigin(request: Request): boolean {
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
    // site.url некоректний — лишається лише перевірка за Host
  }
  return allowed.has(originHost);
}

export async function POST(request: Request) {
  if (!isAllowedOrigin(request)) {
    return json({ error: "forbidden" }, 403);
  }

  // Лише application/json: HTML-форма з іншого сайту не може надіслати такий Content-Type без preflight.
  const contentType = request.headers.get("content-type") ?? "";
  if (!contentType.toLowerCase().startsWith("application/json")) {
    return json({ error: "unsupported_media_type" }, 415);
  }

  let raw: unknown;
  try {
    raw = JSON.parse(await readBodyLimited(request, MAX_BODY_BYTES));
  } catch (error) {
    if (error instanceof PayloadTooLargeError) {
      return json({ error: "payload_too_large" }, 413);
    }
    return json({ error: "invalid_json" }, 400);
  }

  const parsed = orderSchema.safeParse(raw);
  if (!parsed.success) {
    return json(
      { error: "validation", fieldErrors: parsed.error.flatten().fieldErrors },
      400,
    );
  }
  const data = parsed.data;

  // Honeypot заповнюють лише боти: нічого не зберігаємо.
  if (data.website) {
    return json({ ok: true }, 200);
  }

  const elapsed = Date.now() - data.startedAt;
  if (elapsed < MIN_FILL_MS) {
    return json({ error: "too_fast" }, 400);
  }

  let bucket: string | null;
  try {
    const proxy = parseTrustedProxy(process.env.TRUSTED_PROXY);
    bucket = ipBucket(getClientIp(request.headers, proxy));
  } catch (error) {
    // Некоректна конфігурація довіри до проксі — безпечніше відмовити, ніж довіряти підробним заголовкам.
    console.error("[orders] invalid proxy configuration:", error instanceof Error ? error.message : error);
    return json({ error: "unavailable" }, 503);
  }

  try {
    const { ticket } = await createOrder(data, {
      ipBucket: bucket,
      userAgent: request.headers.get("user-agent") ?? "",
    });
    return json({ ticket }, 201);
  } catch (error) {
    if (error instanceof RateLimitError) {
      return json({ error: "rate_limited" }, 429);
    }
    if (error instanceof ConfigError) {
      console.error("[orders] server is not configured:", error.message);
      return json({ error: "unavailable" }, 503);
    }
    // У лог потрапляє лише тип і повідомлення, без персональних даних із заявки.
    console.error("[orders] failed to store order:", error instanceof Error ? error.message : "unknown error");
    return json({ error: "server_error" }, 500);
  }
}
