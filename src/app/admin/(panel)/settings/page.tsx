import type { Metadata } from "next";
import { PaymentSettingsForm } from "@/components/admin/stage2-forms";
import { RetryFailedEmails } from "@/components/admin/email-queue-panel";
import { PageHeader, Panel, formatDateTime } from "@/components/admin/ui";
import { providerFromEnv } from "@/lib/email/service";
import { requireAdmin } from "@/lib/admin/guard";
import { isTelegramEnabled } from "@/lib/notifications/telegram";

export const metadata: Metadata = { title: "Налаштування" };

export default async function SettingsPage() {
  const admin = await requireAdmin();
  const [factors, outbox, admins, bank, mail] = await Promise.all([
    admin.supabase.auth.mfa.listFactors(),
    admin.supabase.from("notification_outbox").select("status"),
    admin.supabase.from("admin_users").select("display_name, email, active").order("created_at"),
    admin.supabase.from("payment_settings").select("recipient, iban, bank_name, tax_id, purpose_hint, online_provider").maybeSingle(),
    admin.supabase.from("email_outbox").select("id, template, to_email, status, attempts, last_error, created_at, sent_at").order("id", { ascending: false }).limit(200),
  ]);
  const mailRows = (mail.data ?? []) as Array<{ id: number; template: string; to_email: string; status: string; attempts: number; last_error: string | null; created_at: string; sent_at: string | null }>;
  const mailCounts = { pending: 0, sending: 0, sent: 0, failed: 0 } as Record<string, number>;
  for (const row of mailRows) mailCounts[row.status] = (mailCounts[row.status] ?? 0) + 1;
  const mask = (email: string) => email.replace(/^(.).*(@.+)$/, "$1***$2");
  const providerName = providerFromEnv()?.name ?? null;

  const verified = factors.data?.totp.filter((f) => f.status === "verified").length ?? 0;
  const telegram = isTelegramEnabled();
  const counts = { pending: 0, sending: 0, sent: 0, dead: 0 } as Record<string, number>;
  for (const row of outbox.data ?? []) counts[row.status as string] = (counts[row.status as string] ?? 0) + 1;

  return (
    <div className="flex flex-col gap-8">
      <PageHeader eyebrow="Налаштування" title="Обліковий запис і сповіщення" />
      <div className="grid gap-6 lg:grid-cols-2">
        <Panel title="Обліковий запис">
          <p className="font-medium">{admin.displayName}</p>
          <p className="break-all text-sm text-muted">{admin.email}</p>
          <p className="mt-4 text-sm">
            MFA (TOTP): <span className="text-ok">{verified > 0 ? "увімкнено" : "не налаштовано"}</span>
          </p>
        </Panel>

        <Panel title="Реквізити для оплати">
          <p className="mb-4 text-sm text-muted">
            Показуються клієнту лише коли йому виставлено рахунок. Онлайн-еквайринг:{" "}
            <span className="text-muted">{bank.data?.online_provider ? `налаштовано (${bank.data.online_provider})` : "не активний (немає мерчант-акаунта); оплата за реквізитами з ручною перевіркою"}</span>
          </p>
          <PaymentSettingsForm
            recipient={(bank.data?.recipient as string | undefined) ?? ""}
            iban={(bank.data?.iban as string | undefined) ?? ""}
            bank={(bank.data?.bank_name as string | undefined) ?? ""}
            taxId={(bank.data?.tax_id as string | undefined) ?? ""}
            hint={(bank.data?.purpose_hint as string | undefined) ?? "Оплата за розробку, рахунок {number}"}
          />
        </Panel>

        <Panel title="Сповіщення в Telegram">
          <p className="text-sm">
            Статус:{" "}
            <span className={telegram ? "text-ok" : "text-muted"}>
              {telegram ? "увімкнено" : "вимкнено (не задано токен бота й chat id на сервері)"}
            </span>
          </p>
          <dl className="mt-4 grid grid-cols-2 gap-3 text-sm">
            <div><dt className="text-muted">У черзі</dt><dd className="tabular-nums">{counts.pending + counts.sending}</dd></div>
            <div><dt className="text-muted">Надіслано</dt><dd className="tabular-nums">{counts.sent}</dd></div>
            <div><dt className="text-muted">Не доставлено (стоп)</dt><dd className="tabular-nums">{counts.dead}</dd></div>
          </dl>
        </Panel>

        <Panel title="Пошта BONSI (черга листів)" className="lg:col-span-2">
          {mail.error ? (
            <p className="text-sm text-muted">Черга листів ще не розгорнута в базі (міграція не застосована) — листи не ставляться в чергу.</p>
          ) : (
            <>
              <p className="text-sm">
                Провайдер:{" "}
                <span className={providerName ? "text-ok" : "text-muted"}>
                  {providerName ? `підключено (${providerName})` : "не налаштований: листи накопичуються в черзі й не відправляються"}
                </span>
              </p>
              <dl className="mt-4 grid grid-cols-2 gap-3 text-sm sm:grid-cols-4">
                <div><dt className="text-muted">У черзі</dt><dd className="tabular-nums">{mailCounts.pending + mailCounts.sending}</dd></div>
                <div><dt className="text-muted">Відправлено</dt><dd className="tabular-nums">{mailCounts.sent}</dd></div>
                <div><dt className="text-muted">Не вдалося</dt><dd className="tabular-nums">{mailCounts.failed}</dd></div>
                <div><dt className="text-muted">Останні 200 записів</dt><dd className="tabular-nums">{mailRows.length}</dd></div>
              </dl>
              <div className="mt-4"><RetryFailedEmails failed={mailCounts.failed} /></div>
              <div className="mt-4 overflow-x-auto">
                <table className="w-full text-left text-sm">
                  <caption className="sr-only">Останні листи в черзі</caption>
                  <thead className="text-xs uppercase tracking-wider text-muted">
                    <tr><th scope="col" className="py-2 pr-4">Шаблон</th><th scope="col" className="py-2 pr-4">Кому</th><th scope="col" className="py-2 pr-4">Статус</th><th scope="col" className="py-2 pr-4">Спроби</th><th scope="col" className="py-2 pr-4">Помилка</th><th scope="col" className="py-2">Створено</th></tr>
                  </thead>
                  <tbody className="divide-y divide-line">
                    {mailRows.slice(0, 15).map((row) => (
                      <tr key={row.id}>
                        <td className="py-2 pr-4 font-mono text-xs">{row.template}</td>
                        <td className="py-2 pr-4">{mask(row.to_email)}</td>
                        <td className="py-2 pr-4">{row.status}</td>
                        <td className="py-2 pr-4 tabular-nums">{row.attempts}</td>
                        <td className="py-2 pr-4 font-mono text-xs">{row.last_error ?? "—"}</td>
                        <td className="py-2">{formatDateTime(row.created_at)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <p className="mt-3 text-xs text-muted">Адреси маскуються, зміст листів і коди входу тут не зберігаються. Статус «доставлено» означає лише прийняття провайдером; реальну доставку підтверджено, коли пройшов тест із живою скринькою.</p>
            </>
          )}
        </Panel>

        <Panel title="Адміністратори" className="lg:col-span-2">
          <ul className="divide-y divide-line">
            {(admins.data ?? []).map((a) => (
              <li key={a.email as string} className="flex items-center justify-between gap-4 py-3 text-sm">
                <span>{a.display_name as string}</span>
                <span className="break-all text-muted">{a.email as string}</span>
              </li>
            ))}
          </ul>
          <p className="mt-4 text-xs text-muted">
            Список редагується лише на боці бази (SQL), відкритої реєстрації немає.
          </p>
        </Panel>
      </div>
    </div>
  );
}
