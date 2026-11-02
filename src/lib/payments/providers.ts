import "server-only";
import { createHash, timingSafeEqual } from "node:crypto";

/**
 * Абстракція платіжних провайдерів. Онлайн-еквайринг ВИМКНЕНО, доки в середовищі немає ключів мерчант-акаунта:
 * без них webhook відповідає 503 і нічого не записує. Підтвердження оплати з події можливе лише після перевірки підпису.
 */
export type ProviderId = "monobank" | "liqpay";
export const PROVIDER_IDS: readonly ProviderId[] = ["monobank", "liqpay"];

export type NormalizedEvent = {
  /** Унікальний ідентифікатор події для ідемпотентності. */
  eventId: string;
  invoiceNumber: string;
  amount: number;
  currency: string;
  /** Лише термінальні стани; проміжні (очікування, обробка) відкидаються ще до бази. */
  status: "success" | "failure";
  providerPaymentId: string;
  payload: Record<string, unknown>;
};

export type ParseResult =
  | { ok: true; event: NormalizedEvent }
  | { ok: true; event: null; ignored: string }
  | { ok: false; reason: "bad_signature" | "bad_payload" | "unsupported" };

export type PaymentProvider = {
  id: ProviderId;
  /** Чи є ключі в середовищі. */
  configured(): boolean;
  verifyAndParse(rawBody: string): ParseResult;
};

function safeEqual(a: string, b: string): boolean {
  const left = Buffer.from(a);
  const right = Buffer.from(b);
  return left.length === right.length && timingSafeEqual(left, right);
}

const TERMINAL_FAILURES = new Set(["failure", "error", "reversed"]);

/** LiqPay: `data` (base64 JSON) + `signature` = base64(sha1(private_key + data + private_key)). */
export const liqpay: PaymentProvider = {
  id: "liqpay",
  configured: () => Boolean(process.env.LIQPAY_PRIVATE_KEY),
  verifyAndParse(rawBody) {
    const key = process.env.LIQPAY_PRIVATE_KEY;
    if (!key) return { ok: false, reason: "unsupported" };
    const form = new URLSearchParams(rawBody);
    const data = form.get("data");
    const signature = form.get("signature");
    if (!data || !signature) return { ok: false, reason: "bad_payload" };
    const expected = createHash("sha1").update(key + data + key).digest("base64");
    if (!safeEqual(expected, signature)) return { ok: false, reason: "bad_signature" };

    let json: Record<string, unknown>;
    try {
      json = JSON.parse(Buffer.from(data, "base64").toString("utf8")) as Record<string, unknown>;
    } catch {
      return { ok: false, reason: "bad_payload" };
    }
    const status = String(json.status ?? "");
    const orderId = String(json.order_id ?? "");
    const paymentId = String(json.payment_id ?? "");
    const amount = Number(json.amount);
    const currency = String(json.currency ?? "");
    if (!/^INV-\d{4}-\d{5}$/.test(orderId) || !paymentId || !Number.isFinite(amount) || amount <= 0 || !/^[A-Z]{3}$/.test(currency)) {
      return { ok: false, reason: "bad_payload" };
    }
    // Лише «success» вважається оплатою. «sandbox» (тестові платежі) і проміжні статуси реальної оплати не підтверджують.
    const terminal = status === "success" ? "success" : TERMINAL_FAILURES.has(status) || status === "sandbox" ? "failure" : null;
    if (!terminal) return { ok: true, event: null, ignored: status || "unknown" };
    return {
      ok: true,
      event: {
        eventId: `${paymentId}:${status}`,
        invoiceNumber: orderId,
        amount,
        currency,
        status: terminal,
        providerPaymentId: paymentId,
        payload: { status, order_id: orderId, payment_id: paymentId, amount, currency },
      },
    };
  },
};

/**
 * monobank acquiring підписує webhook ECDSA (X-Sign) відкритим ключем, який видає API за токеном мерчанта.
 * Токена немає, тому перевірка не реалізована: адаптер завжди відмовляє, щоб жодна подія не пройшла без підпису.
 */
export const monobank: PaymentProvider = {
  id: "monobank",
  configured: () => false,
  verifyAndParse: () => ({ ok: false, reason: "unsupported" }),
};

const registry: Record<ProviderId, PaymentProvider> = { liqpay, monobank };

export function getProvider(id: string): PaymentProvider | null {
  return (PROVIDER_IDS as readonly string[]).includes(id) ? registry[id as ProviderId] : null;
}
