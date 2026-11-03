import { SMTPServer } from "smtp-server";
import type { AddressInfo } from "node:net";
import { afterEach, describe, expect, it } from "vitest";
import { EmailError, providerFromEnv, SmtpProvider } from "./service";

/** Справжня SMTP-розмова з локальним сервером (без мережі назовні): автентифікація, заголовки, класифікація відмов. */
type Captured = { from: string; to: string[]; raw: string; user: string | null };
let server: SMTPServer | null = null;

async function start(options: { rejectRcpt?: string; failData?: number; password?: string } = {}) {
  const captured: Captured[] = [];
  server = new SMTPServer({
    secure: false,
    disabledCommands: ["STARTTLS"],
    allowInsecureAuth: true,
    authOptional: false,
    onAuth(auth, _session, callback) {
      if (auth.username === "no-reply@bonsi.test" && auth.password === (options.password ?? "correct-password")) callback(null, { user: auth.username });
      else callback(new Error("Invalid credentials"));
    },
    onRcptTo(address, _session, callback) {
      if (options.rejectRcpt && address.address === options.rejectRcpt) {
        const error = Object.assign(new Error("Mailbox unavailable"), { responseCode: 550 });
        return callback(error);
      }
      callback();
    },
    onData(stream, session, callback) {
      const chunks: Buffer[] = [];
      stream.on("data", (c) => chunks.push(c));
      stream.on("end", () => {
        if (options.failData) return callback(Object.assign(new Error("Try later"), { responseCode: options.failData }));
        captured.push({ from: session.envelope.mailFrom ? session.envelope.mailFrom.address : "", to: session.envelope.rcptTo.map((r) => r.address), raw: Buffer.concat(chunks).toString("utf8"), user: session.user as string | null });
        callback();
      });
    },
  });
  await new Promise<void>((resolve) => server!.listen(0, "127.0.0.1", resolve));
  const port = (server.server.address() as AddressInfo).port;
  const provider = new SmtpProvider({ host: "127.0.0.1", port, secure: false, user: "no-reply@bonsi.test", pass: "correct-password", requireTls: false, rejectUnauthorized: false });
  return { captured, provider, port };
}
afterEach(async () => {
  await new Promise<void>((resolve) => (server ? server.close(() => resolve()) : resolve()));
  server = null;
});

const email = { to: "client@example.com", toName: 'Клієнт "Тест"', subject: "Тема\r\nBcc: evil@x", html: "<p>Привіт</p>", text: "Привіт", from: "BONSI <no-reply@bonsi.test>", replyTo: "studio@bonsi.test", idempotencyKey: "order-received:abc-123" };

describe("SmtpProvider", () => {
  it("надсилає лист: автентифікація, From/To/Reply-To, Message-ID з ключа ідемпотентності, текст і HTML", async () => {
    const { captured, provider } = await start();
    const result = await provider.send(email);
    expect(captured).toHaveLength(1);
    expect(captured[0]).toMatchObject({ from: "no-reply@bonsi.test", to: ["client@example.com"], user: "no-reply@bonsi.test" });
    const raw = captured[0]!.raw;
    expect(raw).toMatch(/^From: BONSI <no-reply@bonsi.test>/im);
    expect(raw).toMatch(/^Reply-To: studio@bonsi.test/im);
    expect(raw).toMatch(/^Message-ID: <order-received-abc-123@bonsi.test>/im);
    expect(raw).toMatch(/^X-BONSI-Idempotency-Key: order-received:abc-123/im);
    expect(raw).toContain("text/plain");
    expect(raw).toContain("text/html");
    expect(result.messageId).toBe("<order-received-abc-123@bonsi.test>");
  });

  it("тема не пропускає переведення рядка (ін'єкція заголовків)", async () => {
    const { captured, provider } = await start();
    await provider.send(email);
    const headers = captured[0]!.raw.split(/\r?\n\r?\n/)[0]!;
    expect(headers).not.toMatch(/^Bcc:/im);
  });

  it("неіснуюча скринька отримувача (550) — постійна помилка", async () => {
    const { provider } = await start({ rejectRcpt: "client@example.com" });
    await expect(provider.send(email)).rejects.toMatchObject({ permanent: true, message: "smtp_550" });
  });

  it("тимчасова відмова сервера (451 на DATA) — повтор", async () => {
    const { provider } = await start({ failData: 451 });
    await expect(provider.send(email)).rejects.toMatchObject({ permanent: false, message: "smtp_451" });
  });

  it("невірний пароль — тимчасова помилка конфігурації (лист не втрачається), пароль у повідомленні відсутній", async () => {
    const { port } = await start();
    const provider = new SmtpProvider({ host: "127.0.0.1", port, secure: false, user: "no-reply@bonsi.test", pass: "wrong-secret-xyz", requireTls: false, rejectUnauthorized: false });
    const error = (await provider.send(email).then(() => null, (e: unknown) => e)) as EmailError;
    expect(error).toBeInstanceOf(EmailError);
    expect(error.permanent).toBe(false);
    expect(error.message).not.toContain("wrong-secret-xyz");
  });

  it("сервер недоступний — тимчасова помилка", async () => {
    const provider = new SmtpProvider({ host: "127.0.0.1", port: 1, secure: false, user: "u", pass: "p", requireTls: false });
    await expect(provider.send(email)).rejects.toMatchObject({ permanent: false, message: "smtp_unavailable" });
  });
});

describe("providerFromEnv: smtp", () => {
  it("потрібні хост, користувач і пароль; порт перевіряється", () => {
    const base = { EMAIL_PROVIDER: "smtp", SMTP_HOST: "mail.bonsi.test", SMTP_USER: "u", SMTP_PASS: "p" };
    expect(providerFromEnv(base as never)?.name).toBe("smtp");
    expect(providerFromEnv({ ...base, SMTP_PASS: "" } as never)).toBeNull();
    expect(providerFromEnv({ ...base, SMTP_HOST: "" } as never)).toBeNull();
    expect(providerFromEnv({ ...base, SMTP_PORT: "abc" } as never)).toBeNull();
    expect(providerFromEnv({ ...base, SMTP_PORT: "70000" } as never)).toBeNull();
    expect(providerFromEnv({ EMAIL_PROVIDER: "smtp" } as never)).toBeNull();
  });
});
