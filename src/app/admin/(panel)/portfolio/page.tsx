import type { Metadata } from "next";
import Link from "next/link";
import { PortfolioForm } from "@/components/admin/portfolio-forms";
import { PageHeader, Panel } from "@/components/admin/ui";
import { Pill } from "@/components/workspace/ui";
import { requireAdmin } from "@/lib/admin/guard";

export const metadata: Metadata = { title: "Портфоліо" };
export const dynamic = "force-dynamic";

const STATUS: Record<string, string> = { draft: "Чернетка", published: "Опубліковано", archived: "Архів" };

export default async function AdminPortfolioPage() {
  const { supabase } = await requireAdmin();
  const [items, projects] = await Promise.all([
    supabase.from("portfolio_items").select("id,title,slug,status,consent_confirmed_at,updated_at").order("updated_at", { ascending: false }).limit(200),
    supabase.from("projects").select("id,title").order("created_at", { ascending: false }).limit(200),
  ]);
  if (items.error) return <p role="alert" className="text-danger">Не вдалося завантажити портфоліо.</p>;
  const rows = (items.data ?? []) as Array<{ id: string; title: string; slug: string; status: string; consent_confirmed_at: string | null }>;
  return (
    <div className="flex flex-col gap-8">
      <PageHeader eyebrow="Публічний сайт" title="Портфоліо" />
      <p className="max-w-3xl text-sm text-muted">Кейс потрапляє на сайт лише після двох дій: підтвердження згоди власника проєкту й ручної публікації. Вигаданих клієнтів і результатів тут не буває — вносьте тільки перевірені факти.</p>
      <Panel title="Кейси">
        {rows.length === 0 ? (
          <p className="text-muted">Кейсів ще немає.</p>
        ) : (
          <ul className="flex flex-col divide-y divide-line">
            {rows.map((r) => (
              <li key={r.id} className="flex flex-wrap items-center gap-3 py-3">
                <Link prefetch={false} href={`/admin/portfolio/${r.id}`} className="font-semibold underline-offset-4 hover:underline">{r.title}</Link>
                <Pill tone={r.status === "published" ? "ok" : "muted"}>{STATUS[r.status] ?? r.status}</Pill>
                <Pill tone={r.consent_confirmed_at ? "ok" : "warn"}>{r.consent_confirmed_at ? "Згоду підтверджено" : "Немає згоди"}</Pill>
              </li>
            ))}
          </ul>
        )}
      </Panel>
      <Panel title="Новий кейс">
        <PortfolioForm item={null} projects={((projects.data ?? []) as Array<{ id: string; title: string }>).map((p) => ({ id: p.id, label: p.title }))} />
      </Panel>
    </div>
  );
}
