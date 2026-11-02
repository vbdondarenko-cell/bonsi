import { createHash } from "node:crypto";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { getProvider, liqpay, monobank } from "./providers";

const KEY = "test-private-key";
function body(payload: Record<string, unknown>, key = KEY, tamper = false) {
  const data = Buffer.from(JSON.stringify(payload)).toString("base64");
  const signature = createHash("sha1").update(key + data + key).digest("base64");
  return new URLSearchParams({ data, signature: tamper ? signature.replace(/.$/, "A") : signature }).toString();
}
const ok = { status: "success", order_id: "INV-2026-00007", payment_id: 123456, amount: 30000.01, currency: "UAH" };

describe("LiqPay: перевірка підпису й нормалізація", () => {
  beforeEach(() => { process.env.LIQPAY_PRIVATE_KEY = KEY; });
  afterEach(() => { delete process.env.LIQPAY_PRIVATE_KEY; });

  it("приймає коректну подію й нормалізує її", () => {
    const r = liqpay.verifyAndParse(body(ok));
    expect(r).toMatchObject({ ok: true, event: { eventId: "123456:success", invoiceNumber: "INV-2026-00007", amount: 30000.01, currency: "UAH", status: "success", providerPaymentId: "123456" } });
  });
  it("відхиляє підроблений підпис, чужий ключ і підмінений зміст", () => {
    expect(liqpay.verifyAndParse(body(ok, KEY, true))).toEqual({ ok: false, reason: "bad_signature" });
    expect(liqpay.verifyAndParse(body(ok, "інший-ключ"))).toEqual({ ok: false, reason: "bad_signature" });
    const good = new URLSearchParams(body(ok));
    const forged = Buffer.from(JSON.stringify({ ...ok, amount: 1 })).toString("base64");
    good.set("data", forged);
    expect(liqpay.verifyAndParse(good.toString())).toEqual({ ok: false, reason: "bad_signature" });
  });
  it("відхиляє неповні й некоректні дані", () => {
    expect(liqpay.verifyAndParse("")).toEqual({ ok: false, reason: "bad_payload" });
    expect(liqpay.verifyAndParse(body({ ...ok, order_id: "abc" }))).toEqual({ ok: false, reason: "bad_payload" });
    expect(liqpay.verifyAndParse(body({ ...ok, amount: -5 }))).toEqual({ ok: false, reason: "bad_payload" });
    expect(liqpay.verifyAndParse(body({ ...ok, currency: "uah" }))).toEqual({ ok: false, reason: "bad_payload" });
  });
  it("sandbox і помилки — не оплата; проміжні статуси ігноруються", () => {
    expect(liqpay.verifyAndParse(body({ ...ok, status: "sandbox" }))).toMatchObject({ ok: true, event: { status: "failure" } });
    expect(liqpay.verifyAndParse(body({ ...ok, status: "failure" }))).toMatchObject({ ok: true, event: { status: "failure" } });
    expect(liqpay.verifyAndParse(body({ ...ok, status: "processing" }))).toMatchObject({ ok: true, event: null, ignored: "processing" });
  });
  it("без ключа в середовищі провайдер не налаштований і нічого не приймає", () => {
    delete process.env.LIQPAY_PRIVATE_KEY;
    expect(liqpay.configured()).toBe(false);
    expect(liqpay.verifyAndParse(body(ok))).toEqual({ ok: false, reason: "unsupported" });
  });
});

describe("реєстр провайдерів", () => {
  it("monobank не активний: ніколи не підтверджує події без перевірки підпису", () => {
    expect(monobank.configured()).toBe(false);
    expect(monobank.verifyAndParse("{}")).toEqual({ ok: false, reason: "unsupported" });
  });
  it("невідомий провайдер не знаходиться", () => {
    expect(getProvider("paypal")).toBeNull();
    expect(getProvider("__proto__")).toBeNull();
    expect(getProvider("liqpay")).toBe(liqpay);
  });
});
