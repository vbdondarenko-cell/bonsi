import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { EstimateEditor } from "@/components/admin/ops-forms";
import { PageHeader, Panel } from "@/components/admin/ui";
import { requireAdmin } from "@/lib/admin/guard";
import { uuidSchema } from "@/lib/admin/orders";
import { formatMoneyFixed as formatMoney } from "@/lib/client/labels";

export const metadata: Metadata = { title: "Кошторис" };
export const dynamic = "force-dynamic";

export default async function EstimatePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!uuidSchema.safeParse(id).success) notFound();
  const { supabase } = await requireAdmin();
  const [estimate, lines, totals] = await Promise.all([
    supabase.from("estimates").select("id,title,currency,status,reserve_percent,margin_percent,other_costs,final_price,note").eq("id", id).maybeSingle(),
    supabase.from("estimate_lines").select("category,hours,rate").eq("estimate_id", id),
    supabase.rpc("estimate_totals", { p_estimate: id }),
  ]);
  if (estimate.error) return <p role="alert" className="text-danger">Не вдалося завантажити кошторис.</p>;
  if (!estimate.data) notFound();
  const e = estimate.data as { title: string; currency: string; status: string; reserve_percent: string; margin_percent: string; other_costs: string; final_price: string | null; note: string | null };
  const t = (totals.data as Array<{ base_cost: string; reserve: string; other_costs: string; total_cost: string; recommended_price: string; final_price: string | null; hours: string }> | null)?.[0];

  return (
    <div className="flex flex-col gap-8">
      <Link prefetch={false} href="/admin/finance" className="text-sm text-muted hover:text-fg">← Фінанси</Link>
      <PageHeader eyebrow="Кошторис" title={e.title} />
      <p className="rounded-xl border border-line bg-surface/60 p-4 text-sm text-muted">Внутрішній калькулятор. Результат не є автоматичною обіцянкою ціни клієнту: адміністратор сам вирішує, яку ціну вказати в пропозиції.</p>
      <div className="grid gap-6 xl:grid-cols-[1.4fr_1fr]">
        <Panel title="Рядки й параметри">
          <EstimateEditor id={id} lines={(lines.data ?? []) as Array<{ category: string; hours: string; rate: string }>} locked={e.status === "final"} params={{ reserve: e.reserve_percent, margin: e.margin_percent, other: e.other_costs, finalPrice: e.final_price, note: e.note }} />
        </Panel>
        <Panel title="Розрахунок">
          {t ? (
            <dl className="flex flex-col gap-3 text-sm" aria-label="Підсумок кошторису">
              <div><dt className="text-muted">Години</dt><dd className="tabular-nums">{t.hours}</dd></div>
              <div><dt className="text-muted">Базова собівартість</dt><dd className="tabular-nums">{formatMoney(t.base_cost, e.currency)}</dd></div>
              <div><dt className="text-muted">Резерв</dt><dd className="tabular-nums">{formatMoney(t.reserve, e.currency)}</dd></div>
              <div><dt className="text-muted">Інші витрати</dt><dd className="tabular-nums">{formatMoney(t.other_costs, e.currency)}</dd></div>
              <div><dt className="text-muted">Повна собівартість</dt><dd className="tabular-nums">{formatMoney(t.total_cost, e.currency)}</dd></div>
              <div><dt className="text-muted">Рекомендована ціна</dt><dd className="text-xl font-semibold tabular-nums" data-testid="recommended">{formatMoney(t.recommended_price, e.currency)}</dd></div>
              {t.final_price ? <div><dt className="text-muted">Ціна, обрана адміністратором</dt><dd className="tabular-nums">{formatMoney(t.final_price, e.currency)}</dd></div> : null}
            </dl>
          ) : (
            <p className="text-muted">Розрахунок недоступний.</p>
          )}
        </Panel>
      </div>
    </div>
  );
}
