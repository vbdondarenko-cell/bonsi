import type { Metadata } from "next";
import { PageHeader, Panel } from "@/components/admin/ui";
import { requireAdmin } from "@/lib/admin/guard";
import { isTelegramEnabled } from "@/lib/notifications/telegram";

export const metadata: Metadata = { title: "Налаштування" };

export default async function SettingsPage() {
  const admin = await requireAdmin();
  const [factors, outbox, admins] = await Promise.all([
    admin.supabase.auth.mfa.listFactors(),
    admin.supabase.from("notification_outbox").select("status"),
    admin.supabase.from("admin_users").select("display_name, email, active").order("created_at"),
  ]);

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
