import { SUPPORTED_ACTIONS, verifyHookSignature, type AuthHookPayload } from "@/lib/email/auth-hook";
import { providerFromEnv } from "@/lib/email/service";
import { renderLoginCodeEmail } from "@/lib/email/templates";
import { readBodyLimited, PayloadTooLargeError } from "@/lib/http/read-body";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const json = (body: unknown, status: number) => Response.json(body, { status, headers: { "Cache-Control": "no-store" } });
/** Формат помилки, який очікує Supabase Auth від хука: вхід повернеться клієнту як збій, а не вдаватиме, що лист пішов. */
const hookError = (message: string, status = 500) => json({ error: { http_code: status, message } }, status);

/**
 * Supabase Auth → Send Email Hook: Auth не шле лист сам, а викликає цей маршрут із кодом і token_hash.
 * Підпис перевіряється ДО будь-яких дій; код і посилання не логуються й не зберігаються.
 * Адреси адміністраторів тут не відрізняються від клієнтських: розрізнення (і відмова надсилати код) відбувається раніше, у /login.
 */
export async function POST(request: Request) {
  const secret = process.env.SEND_EMAIL_HOOK_SECRET;
  if (!secret) return hookError("hook_not_configured", 503);

  let raw: string;
  try {
    raw = await readBodyLimited(request, 32 * 1024);
  } catch (error) {
    return error instanceof PayloadTooLargeError ? hookError("payload_too_large", 413) : hookError("bad_request", 400);
  }

  const valid = verifyHookSignature({
    secret,
    id: request.headers.get("webhook-id"),
    timestamp: request.headers.get("webhook-timestamp"),
    signature: request.headers.get("webhook-signature"),
    body: raw,
  });
  if (!valid) return hookError("invalid_signature", 401);

  let payload: AuthHookPayload;
  try {
    payload = JSON.parse(raw) as AuthHookPayload;
  } catch {
    return hookError("bad_request", 400);
  }
  const email = payload.user?.email?.trim().toLowerCase();
  const { token, token_hash: tokenHash, email_action_type: action } = payload.email_data ?? {};
  if (!email || !token || !tokenHash || !action || !SUPPORTED_ACTIONS.has(action) || !/^\d{6,8}$/.test(token)) {
    return hookError("unsupported_email_action", 400);
  }

  const provider = providerFromEnv();
  if (!provider) return hookError("email_provider_not_configured", 503);

  const site = (process.env.NEXT_PUBLIC_SITE_URL ?? "").replace(/\/$/, "");
  if (!site) return hookError("site_url_not_configured", 503);
  const link = `${site}/auth/confirm?token_hash=${encodeURIComponent(tokenHash)}&type=email`;
  const rendered = renderLoginCodeEmail({ code: token, link });

  try {
    await provider.send({
      to: email,
      ...rendered,
      from: process.env.EMAIL_FROM ?? "BONSI <no-reply@localhost>",
      replyTo: process.env.EMAIL_REPLY_TO,
      // Ключ ідемпотентності: повторний виклик хука для того самого токена не створить другого листа.
      idempotencyKey: `auth-${tokenHash}`.slice(0, 200),
    });
  } catch (error) {
    // Лише код помилки провайдера, без адреси, коду й посилання.
    console.error("[auth-hook] send failed:", error instanceof Error ? error.message : "unknown");
    return hookError("email_send_failed", 502);
  }
  return json({}, 200);
}
