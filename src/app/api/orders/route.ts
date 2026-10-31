import { orderSchema } from "@/lib/orders/schema";
import {
  ConfigError,
  RateLimitError,
  createOrder,
} from "@/lib/orders/service";

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

function clientIp(request: Request): string {
  const forwarded = request.headers.get("x-forwarded-for");
  if (forwarded) return forwarded.split(",")[0]!.trim();
  return request.headers.get("x-real-ip") ?? "unknown";
}

export async function POST(request: Request) {
  // Захист від міжсайтових запитів: Origin, якщо він є, має збігатися з хостом.
  const origin = request.headers.get("origin");
  if (origin) {
    try {
      if (new URL(origin).host !== request.headers.get("host")) {
        return json({ error: "forbidden" }, 403);
      }
    } catch {
      return json({ error: "forbidden" }, 403);
    }
  }

  const declaredLength = Number(request.headers.get("content-length") ?? 0);
  if (declaredLength > MAX_BODY_BYTES) {
    return json({ error: "payload_too_large" }, 413);
  }

  let raw: unknown;
  try {
    const text = await request.text();
    if (text.length > MAX_BODY_BYTES) {
      return json({ error: "payload_too_large" }, 413);
    }
    raw = JSON.parse(text);
  } catch {
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

  try {
    const { ticket } = await createOrder(data, {
      ip: clientIp(request),
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
    console.error("[orders] failed to store order:", error);
    return json({ error: "server_error" }, 500);
  }
}
