import { createHmac, timingSafeEqual } from "node:crypto";

/**
 * Перевірка підпису Supabase Auth «Send Email Hook» (стандарт Standard Webhooks).
 * Підписується рядок `${webhook-id}.${webhook-timestamp}.${тіло}` ключем HMAC-SHA256; ключ — base64 після префікса `v1,whsec_`.
 */
export function verifyHookSignature(input: { secret: string; id: string | null; timestamp: string | null; signature: string | null; body: string; now?: number; toleranceSeconds?: number }): boolean {
  const { secret, id, timestamp, signature, body } = input;
  if (!secret || !id || !timestamp || !signature) return false;
  const seconds = Number(timestamp);
  const now = (input.now ?? Date.now()) / 1000;
  if (!Number.isFinite(seconds) || Math.abs(now - seconds) > (input.toleranceSeconds ?? 300)) return false;

  const key = Buffer.from(secret.replace(/^v1,/, "").replace(/^whsec_/, ""), "base64");
  if (key.length === 0) return false;
  const expected = createHmac("sha256", key).update(`${id}.${timestamp}.${body}`).digest();
  // Заголовок може містити кілька підписів через пробіл: "v1,<b64> v1,<b64>".
  return signature.split(" ").some((part) => {
    const [version, value] = part.split(",");
    if (version !== "v1" || !value) return false;
    const given = Buffer.from(value, "base64");
    return given.length === expected.length && timingSafeEqual(given, expected);
  });
}

export type AuthHookPayload = {
  user: { email?: string };
  email_data: { token?: string; token_hash?: string; email_action_type?: string; site_url?: string; redirect_to?: string };
};

/** Типи, які кабінет клієнта справді використовує для входу кодом. Інші (recovery, invite, email_change…) цим хуком не обслуговуються. */
export const SUPPORTED_ACTIONS = new Set(["magiclink", "signup", "email"]);
