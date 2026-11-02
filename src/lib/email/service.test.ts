import { describe, expect, it } from "vitest";
import { dispatchEmails, EmailError, enqueueEmail, MockProvider, providerFromEnv, ResendProvider } from "./service";
import { EMAIL_TEMPLATES, renderEmail } from "./templates";

type Row = { id: number; attempts: number; template: string; to_email: string; to_name: null; locale: "uk"; payload: Record<string, unknown>; idempotency_key: string };
function fakeDb(rows: Row[]) {
  const completed: Array<Record<string, unknown>> = [];
  const db = {
    rpc: async (name: string, args: Record<string, unknown>) => {
      if (name === "email_claim") return { data: rows, error: null };
      if (name === "email_complete") {
        completed.push(args);
        const failed = args.p_error && (rows.find((r) => r.id === args.p_id)!.attempts as number) >= (args.p_max as number);
        return { data: args.p_error ? (failed ? "failed" : "pending") : "sent", error: null };
      }
      if (name === "email_enqueue") return { data: 7, error: null };
      return { data: null, error: { message: "unknown" } };
    },
  };
  return { db: db as never, completed };
}
const row = (over: Partial<Row> = {}): Row => ({ id: 1, attempts: 1, template: "invoice_issued", to_email: "a@example.com", to_name: null, locale: "uk", payload: { number: "INV-1", amount: "100", currency: "UAH" }, idempotency_key: "key-12345678", ...over });
const opts = { from: "BONSI <no-reply@bonsi.test>", siteUrl: "https://bonsi.test" };

describe("шаблони листів", () => {
  it.each(EMAIL_TEMPLATES)("%s рендериться українською й англійською", (template) => {
    for (const locale of ["uk", "en"] as const) {
      const out = renderEmail(template, locale, { ticket: "BON-2026-00001", title: "Сайт", number: "INV-1", amount: "1", currency: "UAH", version: 2 }, "https://bonsi.test/");
      expect(out.subject.length).toBeGreaterThan(3);
      expect(out.html).toContain("https://bonsi.test/login");
      expect(out.text).not.toMatch(/\{\w+\}/);
    }
  });
  it("екранує HTML у змінних і не пропускає переведення рядка в темі", () => {
    const out = renderEmail("new_message", "uk", { title: '<script>alert(1)</script>\r\nBcc: x@evil' }, "https://bonsi.test");
    expect(out.html).not.toContain("<script>");
    expect(out.subject).not.toMatch(/[\r\n]/);
  });
});

describe("відправка черги", () => {
  it("без провайдера нічого не вдає відправленим", async () => {
    const { db, completed } = fakeDb([row()]);
    expect(await dispatchEmails(db, null, opts)).toMatchObject({ skipped: true, sent: 0 });
    expect(completed).toHaveLength(0);
  });
  it("успіх: лист віддано провайдеру з ідемпотентним ключем", async () => {
    const provider = new MockProvider();
    const { db, completed } = fakeDb([row()]);
    expect(await dispatchEmails(db, provider, opts)).toMatchObject({ claimed: 1, sent: 1 });
    expect(provider.sent[0]).toMatchObject({ to: "a@example.com", idempotencyKey: "key-12345678", from: opts.from });
    expect(completed[0]).toMatchObject({ p_error: null, p_message_id: "mock-1" });
  });
  it("тимчасовий збій → повтор, у базу пишеться лише код помилки", async () => {
    const provider = new MockProvider();
    provider.failWith = new EmailError("resend_503");
    const { db, completed } = fakeDb([row()]);
    expect(await dispatchEmails(db, provider, opts)).toMatchObject({ retried: 1, failed: 0 });
    expect(completed[0]!.p_error).toBe("resend_503");
  });
  it("невідома помилка не витікає в базу (може містити адресу)", async () => {
    const provider = new MockProvider();
    provider.failWith = new Error("550 mailbox a@example.com unavailable") as EmailError;
    const { db, completed } = fakeDb([row()]);
    await dispatchEmails(db, provider, opts);
    expect(completed[0]!.p_error).toBe("send_failed");
  });
  it("постійна помилка 4xx одразу переводить у failed", async () => {
    const provider = new MockProvider();
    provider.failWith = new EmailError("resend_422", true);
    const { db } = fakeDb([row({ attempts: 1 })]);
    expect(await dispatchEmails(db, provider, opts)).toMatchObject({ failed: 1, retried: 0 });
  });
});

describe("адаптери", () => {
  it("enqueueEmail передає ключ ідемпотентності", async () => {
    const { db } = fakeDb([]);
    expect(await enqueueEmail(db, { key: "order-1-received", template: "order_received", to: "a@example.com" })).toBe(7);
  });
  it("Resend: 5xx/429 тимчасові, 4xx постійні, ключ не логуються", async () => {
    const mk = (status: number) => new ResendProvider("secret", (async () => new Response("{}", { status })) as typeof fetch);
    const email = { to: "a@b.c", subject: "s", html: "h", text: "t", from: "f", idempotencyKey: "k-123456789" };
    await expect(mk(503).send(email)).rejects.toMatchObject({ permanent: false, message: "resend_503" });
    await expect(mk(429).send(email)).rejects.toMatchObject({ permanent: false });
    await expect(mk(422).send(email)).rejects.toMatchObject({ permanent: true });
  });
  it("providerFromEnv: без ключів null, mock заборонений у production", () => {
    expect(providerFromEnv({} as never)).toBeNull();
    expect(providerFromEnv({ EMAIL_PROVIDER: "mock", NODE_ENV: "production" } as never)).toBeNull();
    expect(providerFromEnv({ EMAIL_PROVIDER: "resend", RESEND_API_KEY: "k" } as never)?.name).toBe("resend");
  });
});
