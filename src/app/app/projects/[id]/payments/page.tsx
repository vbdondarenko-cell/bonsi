import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { EmptyState } from "@/components/ui/empty-state";
import { ReportPaymentForm } from "@/components/workspace/report-payment";
import { Card, Pill, formatWhen } from "@/components/workspace/ui";
import { requireClient } from "@/lib/client/auth";
import { getBankDetails, getInvoicesWithPayments, getProject } from "@/lib/client/data";
import { PAYMENT_STATE_LABELS, formatMoney } from "@/lib/client/labels";

export const metadata: Metadata = { title: "Оплата" };

const dateOnly = new Intl.DateTimeFormat("uk-UA", { dateStyle: "medium", timeZone: "Europe/Kyiv" });

export default async function PaymentsPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const { supabase } = await requireClient();
  const project = await getProject(supabase, id);
  if (!project) notFound();
  const [{ invoices, payments }, bank] = await Promise.all([getInvoicesWithPayments(supabase, id), getBankDetails(supabase)]);

  if (invoices.length === 0) {
    return (
      <EmptyState
        title="Рахунків поки немає"
        description="Після погодження комерційної пропозиції студія виставить рахунки за графіком платежів. Оплата за реквізитами; онлайн-оплата карткою поки не підключена."
      />
    );
  }

  return (
    <div className="flex flex-col gap-6">
      <p className="rounded-xl border border-line bg-surface-2/50 p-4 text-sm text-muted">
        Статус «Сплачено» ставиться лише після того, як студія підтвердила надходження коштів. Кнопка «Я сплатив(ла)» лише повідомляє студії про переказ.
      </p>
      {invoices.map((invoice) => {
        const history = payments.filter((payment) => payment.invoice_id === invoice.id);
        const canReport = invoice.status === "issued" && (invoice.state === "unpaid" || invoice.state === "partial");
        return (
          <Card key={invoice.id} title={`${invoice.number} · ${invoice.label}`}>
            <div className="flex flex-col gap-5">
              <div className="flex flex-wrap items-center gap-3">
                <span className="text-2xl font-semibold">{formatMoney(invoice.amount, invoice.currency)}</span>
                <Pill tone={invoice.state === "paid" ? "ok" : invoice.state === "void" ? "muted" : invoice.state === "unpaid" ? "warn" : "accent"}>{PAYMENT_STATE_LABELS[invoice.state] ?? invoice.state}</Pill>
                {invoice.due_date ? <span className="text-sm text-muted">Сплатити до {dateOnly.format(new Date(invoice.due_date))}</span> : null}
                {invoice.status === "issued" ? (
                  <a href={`/app/projects/${id}/payments/${invoice.id}/pdf`} download className="ml-auto text-sm text-accent-soft underline underline-offset-4">
                    Рахунок у PDF
                  </a>
                ) : null}
              </div>
              {history.length > 0 ? (
                <ul className="flex flex-col gap-2 text-sm">
                  {history.map((payment) => (
                    <li key={payment.id} className="flex flex-wrap justify-between gap-2 border-l-2 border-line pl-4">
                      <span>
                        {payment.kind === "refund" ? "Повернення" : "Платіж"} {formatMoney(payment.amount, payment.currency)} ·{" "}
                        {payment.status === "confirmed" ? "підтверджено" : payment.status === "pending" ? "очікує перевірки студією" : "не підтверджено"}
                        {payment.reference ? ` · ${payment.reference}` : ""}
                      </span>
                      <time dateTime={payment.created_at} className="text-muted">
                        {formatWhen(payment.created_at)}
                      </time>
                    </li>
                  ))}
                </ul>
              ) : null}
              {canReport ? <ReportPaymentForm invoiceId={invoice.id} projectId={id} /> : null}
            </div>
          </Card>
        );
      })}

      {bank && bank.iban ? (
        <Card title="Реквізити для оплати">
          <dl className="grid gap-3 text-sm sm:grid-cols-2">
            <div>
              <dt className="text-muted">Отримувач</dt>
              <dd className="mt-1">{bank.recipient}</dd>
            </div>
            <div>
              <dt className="text-muted">IBAN</dt>
              <dd className="mt-1 break-all font-mono">{bank.iban}</dd>
            </div>
            {bank.bank_name ? (
              <div>
                <dt className="text-muted">Банк</dt>
                <dd className="mt-1">{bank.bank_name}</dd>
              </div>
            ) : null}
            {bank.tax_id ? (
              <div>
                <dt className="text-muted">ІПН / ЄДРПОУ</dt>
                <dd className="mt-1">{bank.tax_id}</dd>
              </div>
            ) : null}
            <div className="sm:col-span-2">
              <dt className="text-muted">Призначення платежу</dt>
              <dd className="mt-1">{bank.purpose_hint.replace("{number}", invoices.find((i) => i.state === "unpaid" || i.state === "partial")?.number ?? "INV-…")}</dd>
            </div>
          </dl>
        </Card>
      ) : (
        <p className="text-sm text-muted">Реквізити для оплати студія надішле окремо в чаті проєкту.</p>
      )}
    </div>
  );
}
