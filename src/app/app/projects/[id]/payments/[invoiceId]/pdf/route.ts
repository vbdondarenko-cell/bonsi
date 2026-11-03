import { requireClient } from "@/lib/client/auth";
import { getBankDetails, getInvoicesWithPayments, getProject } from "@/lib/client/data";
import { notFoundResponse, pdfFailure, pdfResponse } from "@/lib/documents/pdf-response";
import { renderInvoicePdf } from "@/lib/documents/pdf";
import { legal } from "@/lib/legal";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const STATE_LABELS: Record<string, string> = { unpaid: "Очікує оплати", awaiting_confirmation: "Очікує підтвердження студією", partial: "Сплачено частково", paid: "Сплачено", void: "Анульовано" };

/** PDF рахунку для клієнта: лише виставлені рахунки його проєкту; статус «Сплачено» береться з журналу підтверджених платежів. */
export async function GET(_request: Request, { params }: { params: Promise<{ id: string; invoiceId: string }> }) {
  const { id, invoiceId } = await params;
  const { supabase } = await requireClient();
  const project = await getProject(supabase, id);
  if (!project) return notFoundResponse();
  const { invoices } = await getInvoicesWithPayments(supabase, id);
  const invoice = invoices.find((i) => i.id === invoiceId && i.status === "issued");
  if (!invoice) return notFoundResponse();

  const [bank, profile] = await Promise.all([getBankDetails(supabase), supabase.from("client_profiles").select("name").maybeSingle()]);
  try {
    const result = await renderInvoicePdf({
      number: invoice.number,
      label: invoice.label,
      amount: String(invoice.amount),
      currency: invoice.currency,
      statusLabel: STATE_LABELS[invoice.state] ?? invoice.state,
      issuedAt: invoice.issued_at,
      dueDate: invoice.due_date,
      projectTitle: project.title,
      clientName: (profile.data as { name?: string } | null)?.name || null,
      operatorName: legal.operatorName,
      recipient: bank?.recipient ?? null,
      iban: bank?.iban ?? null,
      bank: bank?.bank_name ?? null,
      taxId: bank?.tax_id ?? null,
      purposeHint: bank?.purpose_hint ?? null,
    });
    return pdfResponse(result, `${invoice.number}.pdf`);
  } catch (error) {
    return pdfFailure(error);
  }
}
