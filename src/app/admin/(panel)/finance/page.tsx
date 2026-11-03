import type { Metadata } from "next";
import Link from "next/link";
import { ExpenseForm, NewEstimateForm } from "@/components/admin/ops-forms";
import { PageHeader, Panel, formatDateTime } from "@/components/admin/ui";
import { Pill } from "@/components/workspace/ui";
import { requireAdmin } from "@/lib/admin/guard";
import { formatMoneyFixed as formatMoney } from "@/lib/client/labels";

export const metadata: Metadata = { title: "Фінанси" };
export const dynamic = "force-dynamic";

type Row = { currency: string; contracts_total: string; invoiced: string; received: string; unpaid: string; overdue: string; refunds: string; expenses: string; margin: string; month_received: string };

export default async function FinancePage() {
  const { supabase } = await requireAdmin();
  const [summary, estimates, projects, expenses] = await Promise.all([
    supabase.rpc("admin_finance_summary"),
    supabase.from("estimates").select("id,title,currency,status,final_price,project_id,created_at").order("created_at", { ascending: false }).limit(50),
    supabase.from("projects").select("id,title").order("created_at", { ascending: false }).limit(200),
    supabase.from("project_expenses").select("id,project_id,category,amount,currency,incurred_on").order("incurred_on", { ascending: false }).limit(15),
  ]);
  if (summary.error) return <p role="alert" className="text-danger">Не вдалося завантажити фінансове зведення.</p>;
  const rows = ((summary.data ?? []) as Row[]).filter((r) => [r.contracts_total, r.invoiced, r.received, r.expenses, r.unpaid].some((v) => Number(v) !== 0));
  const projectOpts = (projects.data ?? []).map((p) => ({ id: p.id as string, label: p.title as string }));
  const titleOf = new Map(projectOpts.map((p) => [p.id, p.label]));
  const metrics: Array<[keyof Row, string, string]> = [
    ["contracts_total", "Погоджені договори (прогноз)", "Сума погоджених пропозицій і змін. Це ще не гроші."],
    ["invoiced", "Виставлено рахунками", "Не скасовані виставлені рахунки."],
    ["received", "Фактично отримано", "Лише підтверджені платежі мінус повернення."],
    ["unpaid", "Неоплачено", "Залишок за виставленими рахунками."],
    ["overdue", "Прострочено", "Неоплачений залишок рахунків зі строком у минулому."],
    ["refunds", "Повернення", "Підтверджені повернення."],
    ["expenses", "Витрати за проєктами", "Записані вручну."],
    ["margin", "Попередня маржа", "Отримано мінус витрати; не чистий прибуток."],
    ["month_received", "Надійшло цього місяця", "Підтверджені платежі мінус повернення за поточний місяць."],
  ];

  return (
    <div className="flex flex-col gap-8">
      <PageHeader eyebrow="Студія" title="Фінанси" />
      {rows.length === 0 ? (
        <Panel><p className="text-muted">Фінансових даних поки немає: з’являться після погоджених пропозицій, рахунків і підтверджених платежів.</p></Panel>
      ) : (
        rows.map((row) => (
          <Panel key={row.currency} title={`Валюта: ${row.currency}`}>
            <dl className="grid gap-x-8 gap-y-5 sm:grid-cols-2 lg:grid-cols-3">
              {metrics.map(([key, label, hint]) => (
                <div key={key} data-metric={`${row.currency}:${key}`}>
                  <dt className="text-xs uppercase tracking-wider text-muted">{label}</dt>
                  <dd className="mt-1 text-2xl font-semibold tabular-nums">{formatMoney(row[key], row.currency)}</dd>
                  <dd className="mt-1 text-xs text-muted">{hint}</dd>
                </div>
              ))}
            </dl>
          </Panel>
        ))
      )}

      <div className="grid gap-6 xl:grid-cols-2">
        <Panel title="Витрати за проєктом">
          <ExpenseForm projects={projectOpts} />
          <ul className="mt-6 flex flex-col gap-2 text-sm">
            {(expenses.data ?? []).map((e) => (
              <li key={e.id as number} className="flex flex-wrap justify-between gap-2">
                <span>{titleOf.get(e.project_id as string) ?? "Проєкт"} · {e.category as string}</span>
                <span className="tabular-nums">{formatMoney(String(e.amount), e.currency as string)} · {e.incurred_on as string}</span>
              </li>
            ))}
          </ul>
        </Panel>
        <Panel title="Кошториси (внутрішні)">
          <NewEstimateForm projects={projectOpts} />
          <ul className="mt-6 flex flex-col gap-2 text-sm">
            {(estimates.data ?? []).length === 0 ? <li className="text-muted">Кошторисів немає.</li> : null}
            {(estimates.data ?? []).map((e) => (
              <li key={e.id as string} className="flex flex-wrap items-center justify-between gap-2">
                <Link prefetch={false} href={`/admin/finance/estimates/${e.id as string}`} className="text-accent-soft underline underline-offset-4">{e.title as string}</Link>
                <span className="flex items-center gap-2 text-muted">
                  {titleOf.get(e.project_id as string) ?? ""} <Pill tone={e.status === "final" ? "ok" : "muted"}>{e.status === "final" ? "зафіксовано" : "чернетка"}</Pill>
                  <time dateTime={e.created_at as string}>{formatDateTime(e.created_at as string)}</time>
                </span>
              </li>
            ))}
          </ul>
        </Panel>
      </div>
    </div>
  );
}
