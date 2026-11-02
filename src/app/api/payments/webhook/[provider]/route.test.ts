import { createHash } from "node:crypto";
import { beforeEach, describe, expect, it, vi } from "vitest";

const rpc = vi.fn();
vi.mock("@/lib/supabase/service", () => ({ createSupabaseServiceClient: () => ({ rpc }) }));

import { GET, POST } from "./route";

const KEY = "route-test-key";
function req(payload: Record<string, unknown>, signatureKey = KEY) {
  const data = Buffer.from(JSON.stringify(payload)).toString("base64");
  const signature = createHash("sha1").update(signatureKey + data + signatureKey).digest("base64");
  return new Request("http://localhost/api/payments/webhook/liqpay", {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ data, signature }).toString(),
  });
}
const ctx = (provider: string) => ({ params: Promise.resolve({ provider }) });
const ok = { status: "success", order_id: "INV-2026-00007", payment_id: 99, amount: 500, currency: "UAH" };

describe("POST /api/payments/webhook/[provider]", () => {
  beforeEach(() => {
    rpc.mockReset();
    process.env.LIQPAY_PRIVATE_KEY = KEY;
  });

  it("невідомий провайдер — 404", async () => {
    expect((await POST(req(ok), ctx("paypal"))).status).toBe(404);
  });
  it("без налаштованих ключів — 503 і жодного запису", async () => {
    delete process.env.LIQPAY_PRIVATE_KEY;
    expect((await POST(req(ok), ctx("liqpay"))).status).toBe(503);
    expect(rpc).not.toHaveBeenCalled();
  });
  it("monobank не активний — 503", async () => {
    expect((await POST(req(ok), ctx("monobank"))).status).toBe(503);
  });
  it("підроблений підпис — 401 і жодного запису", async () => {
    expect((await POST(req(ok, "чужий"), ctx("liqpay"))).status).toBe(401);
    expect(rpc).not.toHaveBeenCalled();
  });
  it("валідна подія передається в БД з нормалізованими полями", async () => {
    rpc.mockResolvedValue({ data: "confirmed", error: null });
    const res = await POST(req(ok), ctx("liqpay"));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true, outcome: "confirmed" });
    expect(rpc).toHaveBeenCalledWith("payments_apply_provider_event", expect.objectContaining({ p_provider: "liqpay", p_event_id: "99:success", p_invoice_number: "INV-2026-00007", p_amount: 500, p_currency: "UAH", p_status: "success" }));
  });
  it("повтор: БД повертає duplicate, відповідь 200", async () => {
    rpc.mockResolvedValue({ data: "duplicate", error: null });
    const res = await POST(req(ok), ctx("liqpay"));
    expect(res.status).toBe(200);
    expect((await res.json()).outcome).toBe("duplicate");
  });
  it("проміжні статуси ігноруються без звернення до БД", async () => {
    const res = await POST(req({ ...ok, status: "processing" }), ctx("liqpay"));
    expect(res.status).toBe(200);
    expect(rpc).not.toHaveBeenCalled();
  });
  it("помилка бази — 500, щоб провайдер повторив запит", async () => {
    rpc.mockResolvedValue({ data: null, error: { message: "db down" } });
    expect((await POST(req(ok), ctx("liqpay"))).status).toBe(500);
  });
  it("GET заборонений", async () => {
    expect(GET().status).toBe(405);
  });
});
