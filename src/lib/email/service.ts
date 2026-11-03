import type { SupabaseClient } from "@supabase/supabase-js";
import nodemailer from "nodemailer";
import { renderEmail, type EmailTemplate } from "./templates";

export type OutgoingEmail = { to: string; toName?: string | null; subject: string; html: string; text: string; from: string; replyTo?: string; idempotencyKey: string };
export interface EmailProvider {
  readonly name: string;
  send(email: OutgoingEmail): Promise<{ messageId: string }>;
}

/** Постійна помилка (невалідна адреса, відмова провайдера 4xx): повтор не допоможе, але черга все одно рахує спроби. */
export class EmailError extends Error {
  constructor(message: string, readonly permanent = false) {
    super(message);
  }
}

/** Провайдер Resend через HTTP API (без нових залежностей). Ключ лише з env, у журнал не потрапляє. */
export class ResendProvider implements EmailProvider {
  readonly name = "resend";
  constructor(private readonly apiKey: string, private readonly fetchImpl: typeof fetch = fetch) {}
  async send(email: OutgoingEmail) {
    const response = await this.fetchImpl("https://api.resend.com/emails", {
      method: "POST",
      headers: { Authorization: `Bearer ${this.apiKey}`, "Content-Type": "application/json", "Idempotency-Key": email.idempotencyKey },
      body: JSON.stringify({ from: email.from, to: [email.to], subject: email.subject, html: email.html, text: email.text, reply_to: email.replyTo }),
      signal: AbortSignal.timeout(10_000),
    });
    if (!response.ok) throw new EmailError(`resend_${response.status}`, response.status >= 400 && response.status < 500 && response.status !== 429);
    const body = (await response.json().catch(() => ({}))) as { id?: string };
    return { messageId: body.id ?? "unknown" };
  }
}

export type SmtpConfig = { host: string; port: number; secure: boolean; user: string; pass: string; requireTls?: boolean; rejectUnauthorized?: boolean };

/**
 * Провайдер SMTP — пошта хостингу (скринька на домені BONSI). Без сторонніх сервісів і платних тарифів.
 * Пароль лише з env, у журнал і в базу не потрапляє. Помилки класифікуються за кодом SMTP:
 *   5xx на отримувача/зміст (550, 551, 552, 553, 554) — постійні; 4xx, таймаути, обрив зʼєднання — тимчасові (повтор);
 *   535 (невірний логін/пароль) — тимчасова помилка конфігурації: лист не втрачається, поки адміністратор не виправить пароль.
 * УВАГА: SMTP не має серверної ідемпотентності (на відміну від Resend). Лист може піти двічі, якщо сервер прийняв його, а процес
 * впав до відмітки «надіслано»; дублі зменшує детермінований Message-ID (за ключем ідемпотентності).
 */
export class SmtpProvider implements EmailProvider {
  readonly name = "smtp";
  private readonly transport: nodemailer.Transporter;
  constructor(config: SmtpConfig) {
    this.transport = nodemailer.createTransport({
      host: config.host,
      port: config.port,
      secure: config.secure,
      requireTLS: config.requireTls ?? !config.secure,
      auth: { user: config.user, pass: config.pass },
      tls: { rejectUnauthorized: config.rejectUnauthorized ?? true },
      connectionTimeout: 10_000,
      greetingTimeout: 10_000,
      socketTimeout: 20_000,
    });
  }
  async send(email: OutgoingEmail) {
    const domain = email.from.match(/@([^>\s]+)>?\s*$/)?.[1] ?? "bonsi.invalid";
    try {
      const info = await this.transport.sendMail({
        from: email.from,
        to: email.toName ? { name: email.toName.replace(/[\r\n"]/g, " "), address: email.to } : email.to,
        replyTo: email.replyTo,
        subject: email.subject.replace(/[\r\n]+/g, " "),
        html: email.html,
        text: email.text,
        messageId: `<${email.idempotencyKey.replace(/[^A-Za-z0-9._-]/g, "-")}@${domain}>`,
        headers: { "X-BONSI-Idempotency-Key": email.idempotencyKey.replace(/[\r\n]/g, "") },
      });
      return { messageId: info.messageId ?? "unknown" };
    } catch (cause) {
      const code = (cause as { responseCode?: number }).responseCode;
      if (typeof code === "number" && [550, 551, 552, 553, 554].includes(code)) throw new EmailError(`smtp_${code}`, true);
      throw new EmailError(typeof code === "number" ? `smtp_${code}` : "smtp_unavailable", false);
    }
  }
}

/** Провайдер для тестів: зберігає листи в памʼяті, може імітувати збій. */
export class MockProvider implements EmailProvider {
  readonly name = "mock";
  readonly sent: OutgoingEmail[] = [];
  failWith: EmailError | null = null;
  async send(email: OutgoingEmail) {
    if (this.failWith) throw this.failWith;
    this.sent.push(email);
    return { messageId: `mock-${this.sent.length}` };
  }
}

/**
 * EMAIL_PROVIDER=smtp|resend|mock; без повної конфігурації повертає null — листи лишаються в черзі, нічого не вдаючи «відправленим».
 * smtp: SMTP_HOST, SMTP_PORT (за замовчуванням 465), SMTP_SECURE (true для 465; false → STARTTLS), SMTP_USER, SMTP_PASS.
 */
export function providerFromEnv(env: NodeJS.ProcessEnv = process.env): EmailProvider | null {
  if (env.EMAIL_PROVIDER === "smtp" && env.SMTP_HOST && env.SMTP_USER && env.SMTP_PASS) {
    const port = Number(env.SMTP_PORT ?? 465);
    if (!Number.isInteger(port) || port < 1 || port > 65535) return null;
    return new SmtpProvider({ host: env.SMTP_HOST, port, secure: env.SMTP_SECURE ? env.SMTP_SECURE === "true" : port === 465, user: env.SMTP_USER, pass: env.SMTP_PASS });
  }
  if (env.EMAIL_PROVIDER === "resend" && env.RESEND_API_KEY) return new ResendProvider(env.RESEND_API_KEY);
  if (env.EMAIL_PROVIDER === "mock" && env.NODE_ENV !== "production") return new MockProvider();
  return null;
}

export async function enqueueEmail(
  db: SupabaseClient,
  input: { key: string; template: EmailTemplate; to: string; name?: string | null; locale?: "uk" | "en"; payload?: Record<string, unknown>; projectId?: string | null; orderId?: string | null },
): Promise<number> {
  const { data, error } = await db.rpc("email_enqueue", {
    p_key: input.key, p_template: input.template, p_to: input.to, p_name: input.name ?? null, p_locale: input.locale ?? "uk",
    p_payload: input.payload ?? {}, p_project: input.projectId ?? null, p_order: input.orderId ?? null,
  });
  if (error) throw new Error(`email_enqueue: ${error.message}`);
  return Number(data);
}

type Claimed = { id: number; attempts: number; template: EmailTemplate; to_email: string; to_name: string | null; locale: "uk" | "en"; payload: Record<string, unknown>; idempotency_key: string };

export async function dispatchEmails(
  db: SupabaseClient,
  provider: EmailProvider | null,
  options: { limit?: number; from: string; replyTo?: string; siteUrl: string },
): Promise<{ claimed: number; sent: number; retried: number; failed: number; skipped: boolean }> {
  if (!provider) return { claimed: 0, sent: 0, retried: 0, failed: 0, skipped: true };
  const claim = await db.rpc("email_claim", { p_limit: options.limit ?? 10 });
  if (claim.error) throw new Error(`email_claim: ${claim.error.message}`);
  const result = { claimed: 0, sent: 0, retried: 0, failed: 0, skipped: false };
  for (const row of (claim.data ?? []) as Claimed[]) {
    result.claimed++;
    let error: string | null = null;
    let permanent = false;
    let messageId: string | null = null;
    try {
      const rendered = renderEmail(row.template, row.locale, row.payload, options.siteUrl);
      messageId = (await provider.send({ to: row.to_email, toName: row.to_name, ...rendered, from: options.from, replyTo: options.replyTo, idempotencyKey: row.idempotency_key })).messageId;
    } catch (cause) {
      // Лише код помилки: тексту провайдера (може містити адресу) в базу не пишемо.
      error = cause instanceof EmailError ? cause.message : "send_failed";
      permanent = cause instanceof EmailError && cause.permanent;
    }
    // Постійна помилка (невалідна адреса, 4xx крім 429) не повторюється: межа спроб = поточна. 429 і 5xx/мережа повторюються за графіком черги.
    const done = await db.rpc("email_complete", { p_id: row.id, p_error: error, p_message_id: messageId, p_max: permanent ? row.attempts : 6 });
    if (done.error) throw new Error(`email_complete: ${done.error.message}`);
    if (!error) result.sent++;
    else if (done.data === "failed") result.failed++;
    else result.retried++;
  }
  return result;
}
