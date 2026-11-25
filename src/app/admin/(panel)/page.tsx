import type { Metadata } from "next";
import Link from "next/link";
import { BarList, DailyChart, Kpi } from "@/components/admin/charts";
import { PageHeader, Panel, formatDateTime, formatNumber } from "@/components/admin/ui";
import { PERIODS, loadAnalytics, parseDays, type Analytics } from "@/lib/admin/analytics";
import { requireAdmin } from "@/lib/admin/guard";
import { cn } from "@/lib/cn";

export const metadata: Metadata = { title: "Статистика" };
export const dynamic = "force-dynamic";

const DEVICE_LABELS: Record<string, string> = { mobile: "Телефон", tablet: "Планшет", desktop: "Комп'ютер" };

const regionNames = new Intl.DisplayNames(["uk"], { type: "region" });
function countryName(code: string): string {
  if (code === "??") return "Невідомо";
  try {
    return regionNames.of(code) ?? code;
  } catch {
    return code;
  }
}

function sourceLabel(source: string, medium: string): string {
  if (source === "direct") return "Прямий захід";
  return medium === "none" ? source : `${source} / ${medium}`;
}

export default async function AdminDashboardPage({ searchParams }: { searchParams: Promise<{ days?: string }> }) {
  const admin = await requireAdmin();
  const days = parseDays((await searchParams).days);
  const result = await loadAnalytics(admin.supabase, days);

  return (
    <div className="flex flex-col gap-8">
      <PageHeader eyebrow="Аналітика" title="Звідки приходять люди">
        <nav aria-label="Період" className="flex gap-1 rounded-full border border-line bg-surface/70 p-1">
          {PERIODS.map((period) => (
            <Link
              key={period.days}
              prefetch={false}
              href={`/admin?days=${period.days}`}
              aria-current={period.days === days ? "page" : undefined}
              className={cn(
                "rounded-full px-4 py-1.5 text-sm font-medium transition-colors",
                period.days === days ? "bg-accent/20 text-fg" : "text-muted hover:text-fg",
              )}
            >
              {period.label}
            </Link>
          ))}
        </nav>
      </PageHeader>

      {!result.ok ? (
        <Panel>
          <p role="alert" className="font-medium">
            {result.reason === "not_ready" ? "Аналітика ще не підключена до бази." : "Не вдалося завантажити статистику."}
          </p>
          <p className="mt-2 text-sm text-muted">
            {result.reason === "not_ready"
              ? "Застосуйте міграцію supabase/migrations/20261125000000_site_analytics.sql у проєкті Supabase — після цього дані почнуть збиратися й показуватися тут."
              : "Спробуйте оновити сторінку. Якщо помилка повторюється, перевірте журнал сервера."}
          </p>
        </Panel>
      ) : (
        <Dashboard data={result.data} />
      )}
    </div>
  );
}

function Dashboard({ data }: { data: Analytics }) {
  const { totals } = data;
  const conversion = totals.visitors > 0 ? `${((totals.leads / totals.visitors) * 100).toFixed(1).replace(".", ",")}%` : "—";
  const empty = totals.views === 0 && totals.scans === 0 && totals.leads === 0;

  return (
    <>
      <section aria-label="Підсумок" className="grid grid-cols-2 gap-4 lg:grid-cols-5">
        <Kpi label="Відвідувачі" value={formatNumber(totals.visitors)} hint="унікальні за добу" />
        <Kpi label="Перегляди" value={formatNumber(totals.views)} />
        <Kpi label="Заявки" value={formatNumber(totals.leads)} />
        <Kpi label="Конверсія" value={conversion} hint="заявки / відвідувачі" />
        <Kpi label="Скани QR і кліки" value={formatNumber(totals.scans)} hint="через /go/…" />
      </section>

      {empty ? (
        <Panel>
          <p className="font-medium">За цей період даних ще немає.</p>
          <p className="mt-2 text-sm text-muted">
            Відвідування з&apos;являться тут, щойно хтось зайде на сайт. Боти й попередній перегляд посилань у месенджерах не
            враховуються.
          </p>
        </Panel>
      ) : null}

      <Panel title="Відвідувачі по днях">
        <DailyChart data={data.daily} />
      </Panel>

      <div className="grid gap-6 lg:grid-cols-2">
        <Panel title="Джерела трафіку">
          <BarList
            items={data.sources.map((row) => ({
              key: `${row.source}/${row.medium}`,
              label: sourceLabel(row.source, row.medium),
              value: row.visitors,
              hint: row.leads > 0 ? `${formatNumber(row.leads)} заявок` : undefined,
            }))}
          />
        </Panel>
        <Panel title="Кампанії та стікери">
          <BarList
            empty="Кампаній ще немає. Створіть посилання в розділі «Посилання та QR»."
            items={data.campaigns.map((row) => ({
              key: `${row.campaign}/${row.source}/${row.medium}`,
              label: `${row.campaign} · ${row.source}`,
              value: row.visitors,
              hint: row.leads > 0 ? `${formatNumber(row.leads)} заявок` : undefined,
            }))}
          />
        </Panel>
        <Panel title="Сайти, що привели людей">
          <BarList
            empty="Переходів з інших сайтів поки немає."
            items={data.referrers.map((row) => ({ key: row.host, label: row.host, value: row.visitors }))}
          />
        </Panel>
        <Panel title="Популярні сторінки">
          <BarList items={data.pages.map((row) => ({ key: row.path, label: row.path, value: row.views }))} />
        </Panel>
        <Panel title="Країни">
          <BarList items={data.countries.map((row) => ({ key: row.country, label: countryName(row.country), value: row.visitors }))} />
        </Panel>
        <Panel title="Пристрої">
          <BarList items={data.devices.map((row) => ({ key: row.device, label: DEVICE_LABELS[row.device] ?? row.device, value: row.visitors }))} />
        </Panel>
      </div>

      <Panel title="Останні заявки: звідки прийшли">
        {data.recent_leads.length === 0 ? (
          <p className="text-sm text-muted">За цей період заявок ще не було.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-sm">
              <thead className="text-muted">
                <tr>
                  <th scope="col" className="pb-2 pr-4 font-medium">Коли</th>
                  <th scope="col" className="pb-2 pr-4 font-medium">Джерело</th>
                  <th scope="col" className="pb-2 pr-4 font-medium">Кампанія</th>
                  <th scope="col" className="pb-2 font-medium">Посилання</th>
                </tr>
              </thead>
              <tbody>
                {data.recent_leads.map((lead) => (
                  <tr key={`${lead.created_at}-${lead.link_code ?? ""}`} className="border-t border-line">
                    <td className="whitespace-nowrap py-2.5 pr-4">{formatDateTime(lead.created_at)}</td>
                    <td className="py-2.5 pr-4">{sourceLabel(lead.source, lead.medium)}</td>
                    <td className="py-2.5 pr-4">{lead.campaign ?? "—"}</td>
                    <td className="py-2.5 font-mono text-xs">{lead.link_code ?? "—"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Panel>

      <p className="text-xs text-muted">
        Відвідувач рахується один раз на добу без cookie та без збереження IP. Боти, попередній перегляд посилань і користувачі з
        Do Not Track не враховуються. Час і доба — за Києвом.
      </p>
    </>
  );
}
