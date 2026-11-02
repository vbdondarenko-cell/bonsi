import { PayloadTooLargeError, readBodyLimited } from "@/lib/http/read-body";
import { getProvider } from "@/lib/payments/providers";
import { createSupabaseServiceClient } from "@/lib/supabase/service";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const MAX_BODY_BYTES = 32_000;

function json(body: unknown, status: number) {
  return Response.json(body, { status, headers: { "Cache-Control": "no-store" } });
}

/**
 * Callback платіжного провайдера. Порядок: провайдер відомий і налаштований → підпис → нормалізація → одна транзакція в БД
 * (ідемпотентність за подією, перевірка рахунку, суми й валюти). Без підпису нічого не записується.
 * 200 — подію прийнято (у т.ч. дубль або відхилену за сумою: результат лежить у payment_events); 5xx — провайдер повторить.
 */
export async function POST(request: Request, { params }: { params: Promise<{ provider: string }> }) {
  const { provider: providerId } = await params;
  const provider = getProvider(providerId);
  if (!provider) return json({ error: "not_found" }, 404);
  if (!provider.configured()) return json({ error: "provider_not_configured" }, 503);

  let raw: string;
  try {
    raw = await readBodyLimited(request, MAX_BODY_BYTES);
  } catch (error) {
    return error instanceof PayloadTooLargeError ? json({ error: "payload_too_large" }, 413) : json({ error: "invalid_body" }, 400);
  }

  const parsed = provider.verifyAndParse(raw);
  if (!parsed.ok) {
    return json({ error: parsed.reason }, parsed.reason === "bad_signature" ? 401 : parsed.reason === "unsupported" ? 501 : 400);
  }
  if (parsed.event === null) return json({ ok: true, ignored: parsed.ignored }, 200);

  const { event } = parsed;
  try {
    const db = createSupabaseServiceClient();
    const { data, error } = await db.rpc("payments_apply_provider_event", {
      p_provider: provider.id,
      p_event_id: event.eventId,
      p_invoice_number: event.invoiceNumber,
      p_amount: event.amount,
      p_currency: event.currency,
      p_status: event.status,
      p_provider_payment_id: event.providerPaymentId,
      p_payload: event.payload,
    });
    if (error) {
      console.error("[payments] webhook storage error:", error.message);
      return json({ error: "storage_error" }, 500);
    }
    return json({ ok: true, outcome: data }, 200);
  } catch (error) {
    console.error("[payments] webhook failed:", error instanceof Error ? error.message : "unknown");
    return json({ error: "unavailable" }, 503);
  }
}

export function GET() {
  return json({ error: "method_not_allowed" }, 405);
}
