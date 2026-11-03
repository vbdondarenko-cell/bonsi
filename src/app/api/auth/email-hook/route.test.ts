import { createHmac } from "node:crypto";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { MockProvider, EmailError } from "@/lib/email/service";

const provider = new MockProvider();
let configured = true;
vi.mock("@/lib/email/service", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/email/service")>();
  return { ...actual, providerFromEnv: () => (configured ? provider : null) };
});

import { POST } from "./route";

const KEY = Buffer.from("super-secret-hook-key-0123456789");
const SECRET = `v1,whsec_${KEY.toString("base64")}`;

function signed(body: object, overrides: { secret?: Buffer; timestamp?: number; id?: string } = {}) {
  const raw = JSON.stringify(body);
  const id = overrides.id ?? "msg_1";
  const timestamp = String(overrides.timestamp ?? Math.floor(Date.now() / 1000));
  const signature = "v1," + createHmac("sha256", overrides.secret ?? KEY).update(`${id}.${timestamp}.${raw}`).digest("base64");
  return new Request("http://localhost/api/auth/email-hook", {
    method: "POST",
    body: raw,
    headers: { "webhook-id": id, "webhook-timestamp": timestamp, "webhook-signature": signature, "content-type": "application/json" },
  });
}
const payload = (over: Record<string, unknown> = {}) => ({
  user: { email: "Client@Example.com" },
  email_data: { token: "123456", token_hash: "hash_abc", email_action_type: "magiclink", site_url: "https://x", redirect_to: "https://x/auth/confirm", ...over },
});

describe("Supabase Send Email Hook", () => {
  beforeEach(() => {
    provider.sent.length = 0;
    provider.failWith = null;
    configured = true;
    process.env.SEND_EMAIL_HOOK_SECRET = SECRET;
    process.env.NEXT_PUBLIC_SITE_URL = "https://bonsi.example";
    process.env.EMAIL_FROM = "BONSI <no-reply@bonsi.example>";
  });

  it("валідний підпис: лист із кодом і посиланням іде через провайдера, відповідь 200", async () => {
    const res = await POST(signed(payload()));
    expect(res.status).toBe(200);
    expect(provider.sent).toHaveLength(1);
    const mail = provider.sent[0]!;
    expect(mail.to).toBe("client@example.com");
    expect(mail.from).toBe("BONSI <no-reply@bonsi.example>");
    expect(mail.text).toContain("123456");
    expect(mail.text).toContain("https://bonsi.example/auth/confirm?token_hash=hash_abc&type=email");
    expect(mail.idempotencyKey).toBe("auth-hash_abc");
  });

  it("чужий підпис, зіпсоване тіло й прострочений timestamp → 401, нічого не відправлено", async () => {
    expect((await POST(signed(payload(), { secret: Buffer.from("wrong-key-wrong-key-wrong-key-123") }))).status).toBe(401);
    expect((await POST(signed(payload(), { timestamp: Math.floor(Date.now() / 1000) - 3600 }))).status).toBe(401);
    const tampered = signed(payload());
    const forged = new Request(tampered.url, { method: "POST", body: JSON.stringify(payload({ token: "999999" })), headers: tampered.headers });
    expect((await POST(forged)).status).toBe(401);
    expect(provider.sent).toHaveLength(0);
  });

  it("без секрету на сервері хук вимкнений (503), а не відкритий", async () => {
    delete process.env.SEND_EMAIL_HOOK_SECRET;
    expect((await POST(signed(payload()))).status).toBe(503);
  });

  it("збій провайдера (SMTP/API недоступний) → 502 у форматі Supabase, лист не вважається відправленим", async () => {
    provider.failWith = new EmailError("resend_503");
    const res = await POST(signed(payload()));
    expect(res.status).toBe(502);
    expect(await res.json()).toEqual({ error: { http_code: 502, message: "email_send_failed" } });
    expect(provider.sent).toHaveLength(0);
  });

  it("провайдер не налаштований → 503 (вхід чесно повідомить про недоступність)", async () => {
    configured = false;
    expect((await POST(signed(payload()))).status).toBe(503);
  });

  it("непідтримувані дії (recovery, invite) і некоректний код відхиляються", async () => {
    expect((await POST(signed(payload({ email_action_type: "recovery" })))).status).toBe(400);
    expect((await POST(signed(payload({ token: "abc" })))).status).toBe(400);
    expect((await POST(signed({ user: {}, email_data: {} }))).status).toBe(400);
    expect(provider.sent).toHaveLength(0);
  });

  it("код і посилання не потрапляють у логи при збої", async () => {
    const spy = vi.spyOn(console, "error").mockImplementation(() => undefined);
    provider.failWith = new EmailError("resend_500");
    await POST(signed(payload()));
    const logged = JSON.stringify(spy.mock.calls);
    expect(logged).not.toContain("123456");
    expect(logged).not.toContain("hash_abc");
    expect(logged).not.toContain("example.com");
    spy.mockRestore();
  });
});
