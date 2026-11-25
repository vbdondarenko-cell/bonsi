import type { Metadata } from "next";
import Link from "next/link";
import { BarList, Kpi } from "@/components/admin/charts";
import { FinanceForm } from "@/components/admin/finance-form";
import { PageHeader, Panel, formatNumber } from "@/components/admin/ui";
import { loadFinance, type Finance } from "@/lib/admin/finance";
import { requireAdmin } from "@/lib/admin/guard";
import { cn } from "@/lib/cn";
import { formatMoney, formatSigned, monthLabel, resolveMonth, shiftMonth, todayKyiv } from "@/lib/finance/catalog";
import { deleteFinanceAction } from "./actions";

export const metadata: Metadata = { title: "Фінанси" };
export const dynamic = "force-dynamic";

const shortMonth = new Intl.DateTimeFormat("uk-UA", { month: "short", timeZone: "UTC" });
const dayFormat = new Intl.DateTimeFormat("uk-UA", { day: "numeric", month: "short", timeZone: "UTC" });

export default async function AdminFinancePage({ searchParams }: { searchParams: Promise<{ m?: string }> }) {
  const admin = await requireAdmin();
  const month = resolveMonth((await searchParams).m);
  const currentMonth = resolveMonth(undefined);
  const result = await loadFinance(admin.supabase, month);

  return (
    <div className="flex flex-col gap-8">
      <PageHeader eyebrow="Калькулятор" title="Прибуток і витрати">
        <nav aria-label="Місяць" className="flex items-center gap-1 rounded-full border border-line bg-surface/70 p-1">
          <Link
            prefetch={false}
            href={`/admin/finance?m=${shiftMonth(month, -1).slice(0, 7)}`}
            aria-label="Попередній місяць"
            className="rounded-full px-3 py-1.5 text-sm text-muted hover:text-fg"
          >
            ←
          </Link>
          <span className="min-w-36 px-2 text-center text-sm font-medium">{monthLabel(month)}</span>
          <Link
            prefetch={false}
            href={`/admin/finance?m=${shiftMonth(month, 1).slice(0, 7)}`}
            aria-label="Наступний місяць"
            className={cn("rounded-full px-3 py-1.5 text-sm text-muted hover:text-fg", month >= currentMonth && "pointer-events-none opacity-30")}
          >
            →
          </Link>
        </nav>
      </PageHeader>

      <Panel title="Новий запис">
        <FinanceForm today={todayKyiv()} />
      </Panel>

      {!result.ok ? (
        <Panel>
          <p role="alert" className="font-medium">
            {result.reason === "not_ready" ? "Облік ще не підключений до бази." : "Не вдалося завантажити облік."}
          </p>
          <p className="mt-2 text-sm text-muted">
            {result.reason === "not_ready"
              ? "Застосуйте міграцію supabase/migrations/20261125010000_finance_ledger.sql у проєкті Supabase."
              : "Спробуйте оновити сторінку."}
          </p>
        </Panel>
      ) : (
        <Ledger data={result.data} />
      )}
    </div>
  );
}

function Ledger({ data }: { data: Finance }) {
  const income = Number(data.totals.income);
  const expense = Number(data.totals.expense);
  const net = income - expense;
  const margin = income > 0 ? `${((net / income) * 100).toFixed(0)}%` : "—";
  const total = Math.max(income, expense, 1);

  const byKind = (kind: "income" | "expense") =>
    data.by_category
      .filter((row) => row.kind === kind)
      .map((row) => ({ key: row.category, label: row.category, value: Number(row.total), hint: `${formatNumber(row.n)} зап.` }));

  const maxHistory = Math.max(1, ...data.history.flatMap((h) => [Number(h.income), Number(h.expense)]));

  return (
    <>
      <section aria-label="Підсумок місяця" className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        <Kpi label="Доходи" value={formatMoney(income)} />
        <Kpi label="Витрати" value={formatMoney(expense)} />
        <div
          className={cn(
            "col-span-2 rounded-[var(--radius-card)] border p-5 lg:col-span-2",
            net > 0 ? "border-ok/40 bg-ok/10" : net < 0 ? "border-danger/40 bg-danger/10" : "border-line bg-surface/70",
          )}
        >
          <p className="text-sm text-muted">{net > 0 ? "Місяць у плюсі" : net < 0 ? "Місяць у мінусі" : "Місяць у нулі"}</p>
          <p className={cn("mt-2 text-4xl font-semibold tabular-nums tracking-tight", net > 0 && "text-ok", net < 0 && "text-danger")}>
            {formatSigned(net)}
          </p>
          <p className="mt-1 text-xs text-muted">Маржа: {margin}</p>
        </div>
      </section>

      <Panel title="Доходи проти витрат">
        <div className="flex flex-col gap-3" role="img" aria-label={`Доходи ${formatMoney(income)}, витрати ${formatMoney(expense)}`}>
          {(
            [
              ["Доходи", income, "bg-ok/70"],
              ["Витрати", expense, "bg-danger/70"],
            ] as const
          ).map(([label, value, color]) => (
            <div key={label} className="flex items-center gap-3 text-sm">
              <span className="w-16 shrink-0 text-muted">{label}</span>
              <div className="h-3 flex-1 overflow-hidden rounded-full bg-surface-2">
                <div className={cn("h-full rounded-full", color)} style={{ width: `${Math.max(value > 0 ? 2 : 0, (value / total) * 100)}%` }} />
              </div>
              <span className="w-32 shrink-0 text-right tabular-nums">{formatMoney(value)}</span>
            </div>
          ))}
        </div>
      </Panel>

      <div className="grid gap-6 lg:grid-cols-2">
        <Panel title="Звідки дохід">
          <BarList items={byKind("income")} empty="Доходів за цей місяць ще немає." />
        </Panel>
        <Panel title="На що витрати">
          <BarList items={byKind("expense")} empty="Витрат за цей місяць ще немає." />
        </Panel>
      </div>

      <Panel title="Останні 6 місяців">
        <ul className="grid grid-cols-3 gap-4 sm:grid-cols-6">
          {data.history.map((h) => {
            const i = Number(h.income);
            const e = Number(h.expense);
            const n = i - e;
            return (
              <li key={h.month} className="flex flex-col items-center gap-2">
                <div className="flex h-24 items-end gap-1" aria-hidden="true">
                  <div className="w-4 rounded-t bg-ok/70" style={{ height: `${Math.max(i > 0 ? 3 : 0, (i / maxHistory) * 100)}%` }} />
                  <div className="w-4 rounded-t bg-danger/70" style={{ height: `${Math.max(e > 0 ? 3 : 0, (e / maxHistory) * 100)}%` }} />
                </div>
                <p className="text-xs text-muted">{shortMonth.format(new Date(`${h.month}T00:00:00Z`))}</p>
                <p className={cn("text-xs font-medium tabular-nums", n > 0 && "text-ok", n < 0 && "text-danger")}>{formatSigned(n)}</p>
              </li>
            );
          })}
        </ul>
        <p className="mt-4 flex gap-4 text-xs text-muted">
          <span className="inline-flex items-center gap-1.5">
            <span aria-hidden="true" className="size-2.5 rounded-sm bg-ok/70" /> доходи
          </span>
          <span className="inline-flex items-center gap-1.5">
            <span aria-hidden="true" className="size-2.5 rounded-sm bg-danger/70" /> витрати
          </span>
        </p>
      </Panel>

      <Panel title="Записи місяця">
        {data.entries.length === 0 ? (
          <p className="text-sm text-muted">Записів за цей місяць ще немає. Додайте перший вище.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-sm">
              <thead className="text-muted">
                <tr>
                  <th scope="col" className="pb-2 pr-4 font-medium">Дата</th>
                  <th scope="col" className="pb-2 pr-4 font-medium">Запис</th>
                  <th scope="col" className="pb-2 pr-4 font-medium">Категорія</th>
                  <th scope="col" className="pb-2 pr-4 text-right font-medium">Сума</th>
                  <th scope="col" className="pb-2 font-medium">
                    <span className="sr-only">Дії</span>
                  </th>
                </tr>
              </thead>
              <tbody>
                {data.entries.map((entry) => (
                  <tr key={entry.id} className="border-t border-line align-top">
                    <td className="whitespace-nowrap py-2.5 pr-4">{dayFormat.format(new Date(`${entry.entry_date}T00:00:00Z`))}</td>
                    <td className="py-2.5 pr-4">
                      <p className="font-medium">{entry.title}</p>
                      {entry.client || entry.note ? (
                        <p className="text-xs text-muted">{[entry.client, entry.note].filter(Boolean).join(" · ")}</p>
                      ) : null}
                    </td>
                    <td className="py-2.5 pr-4 text-muted">{entry.category}</td>
                    <td
                      className={cn(
                        "whitespace-nowrap py-2.5 pr-4 text-right font-medium tabular-nums",
                        entry.kind === "income" ? "text-ok" : "text-danger",
                      )}
                    >
                      {entry.kind === "income" ? "+" : "−"}
                      {formatMoney(Number(entry.amount))}
                    </td>
                    <td className="py-2.5">
                      <form action={deleteFinanceAction}>
                        <input type="hidden" name="id" value={entry.id} />
                        <button
                          type="submit"
                          aria-label={`Видалити запис: ${entry.title}`}
                          className="text-xs text-muted underline underline-offset-4 hover:text-danger"
                        >
                          Видалити
                        </button>
                      </form>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Panel>
    </>
  );
}
