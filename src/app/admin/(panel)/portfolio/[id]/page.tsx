import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { ConsentForm, PortfolioForm, PortfolioStatusForm, type PortfolioRecord } from "@/components/admin/portfolio-forms";
import { PageHeader, Panel, formatDateTime } from "@/components/admin/ui";
import { Pill } from "@/components/workspace/ui";
import { requireAdmin } from "@/lib/admin/guard";
import { uuidSchema } from "@/lib/admin/orders";

export const metadata: Metadata = { title: "Кейс портфоліо" };
export const dynamic = "force-dynamic";

export default async function PortfolioItemPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!uuidSchema.safeParse(id).success) notFound();
  const { supabase } = await requireAdmin();
  const [item, projects] = await Promise.all([
    supabase.from("portfolio_items").select("*").eq("id", id).maybeSingle(),
    supabase.from("projects").select("id,title").order("created_at", { ascending: false }).limit(200),
  ]);
  if (item.error) return <p role="alert" className="text-danger">Не вдалося завантажити кейс.</p>;
  if (!item.data) notFound();
  const r = item.data as PortfolioRecord & { status: string; consent_confirmed_at: string | null; owner_consent_note: string | null; published_at: string | null };
  return (
    <div className="flex flex-col gap-8">
      <Link prefetch={false} href="/admin/portfolio" className="text-sm text-muted hover:text-fg">← Портфоліо</Link>
      <PageHeader eyebrow="Портфоліо" title={r.title}>
        <Pill tone={r.status === "published" ? "ok" : "muted"}>{r.status === "published" ? "Опубліковано" : r.status === "archived" ? "Архів" : "Чернетка"}</Pill>
        <Pill tone="muted">версія {r.version}</Pill>
      </PageHeader>

      <Panel title="Публікація">
        <p className="mb-4 text-sm">
          {r.consent_confirmed_at ? (
            <>Згоду власника підтверджено {formatDateTime(r.consent_confirmed_at)}: <em>{r.owner_consent_note}</em></>
          ) : (
            "Згоду власника проєкту ще не підтверджено — публікація заблокована."
          )}
        </p>
        {!r.consent_confirmed_at ? <ConsentForm id={r.id} /> : null}
        <div className="mt-4 flex flex-wrap gap-3">
          {r.status !== "published" && r.consent_confirmed_at ? <PortfolioStatusForm id={r.id} version={r.version} status="published" label="Опублікувати на сайті" /> : null}
          {r.status === "published" ? <PortfolioStatusForm id={r.id} version={r.version} status="draft" label="Зняти з публікації" variant="ghost" /> : null}
          {r.status !== "archived" ? <PortfolioStatusForm id={r.id} version={r.version} status="archived" label="В архів" variant="ghost" /> : null}
        </div>
      </Panel>

      <Panel title="Зміст">
        <p className="mb-4 text-sm text-muted">Зміна опублікованого кейсу повертає його в чернетку та знімає підтвердження згоди.</p>
        <PortfolioForm item={r} projects={((projects.data ?? []) as Array<{ id: string; title: string }>).map((p) => ({ id: p.id, label: p.title }))} />
      </Panel>
    </div>
  );
}
