import type { Metadata } from "next";
import Link from "next/link";
import { PageHeader } from "@/components/admin/ui";
import { ButtonLink } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";
import { ProjectCard } from "@/components/workspace/project-card";
import { Card } from "@/components/workspace/ui";
import { requireClient } from "@/lib/client/auth";
import { getRequests, listProjects, read, unreadByProject } from "@/lib/client/data";
import { formatMoney } from "@/lib/client/labels";

export const metadata: Metadata = { title: "Дашборд" };

type DueRow = { project_id: string; invoice_id: string; number: string; amount: string; currency: string; due_date: string | null; state: string };

export default async function DashboardPage() {
  const { supabase, displayName } = await requireClient();
  const [projects, requests] = await Promise.all([listProjects(supabase), getRequests(supabase)]);
  const active = projects.filter((p) => p.activated_at && p.status === "active");
  const unread = await unreadByProject(supabase, projects.map((p) => p.id));
  const openRequests = requests.filter((r) => !r.activated && r.order_status !== "rejected");

  // Документи на погодження та рахунки до оплати: лише реальні записи з бази, без демонстраційних значень.
  const pendingDocs = (await read("pending_documents", () => supabase.from("documents").select("id,project_id,title").eq("status", "sent"))) ?? [];
  const invoices = (await read("issued_invoices", () => supabase.from("invoices").select("id,project_id,number,amount,currency,due_date").eq("status", "issued"))) ?? [];
  const states = await Promise.all(
    projects.map(async (p) => ((await read("invoice_states", () => supabase.rpc("project_invoice_states", { p_project: p.id }))) ?? []) as Array<{ invoice_id: string; state: string }>),
  );
  const stateById = new Map(states.flat().map((s) => [s.invoice_id, s.state]));
  const toPay: DueRow[] = (invoices as Array<Omit<DueRow, "invoice_id" | "state"> & { id: string }>)
    .map((i) => ({ project_id: i.project_id, invoice_id: i.id, number: i.number, amount: i.amount, currency: i.currency, due_date: i.due_date, state: stateById.get(i.id) ?? "unknown" }))
    .filter((i) => i.state === "unpaid" || i.state === "partial");
  const deadlines = toPay.filter((i) => i.due_date).sort((x, y) => String(x.due_date).localeCompare(String(y.due_date)));
  const actions = projects.filter((p) => p.status === "active" && p.next_action_owner === "client");
  const totalUnread = Object.values(unread).reduce((a, b) => a + b, 0);
  const nothing = projects.length === 0 && requests.length === 0;

  return (
    <div className="flex flex-col gap-8">
      <PageHeader eyebrow="Кабінет" title={displayName ? `Вітаємо, ${displayName}` : "Вітаємо в кабінеті"} />

      {nothing ? (
        <EmptyState
          title="Заявок і проєктів поки немає"
          description="Заявка зʼявляється тут, коли студія отримує її з цією поштою. Якщо ви вже надсилали заявку з іншої адреси — увійдіть саме з нею."
          action={<ButtonLink href="/contact">Надіслати заявку</ButtonLink>}
        />
      ) : (
        <>
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            <Card title="Активні заявки">
              <p className="text-4xl font-semibold">{openRequests.length}</p>
              <Link prefetch={false} href="/app/requests" className="mt-2 inline-block text-sm text-accent-soft underline underline-offset-4">Мої заявки</Link>
            </Card>
            <Card title="Активні проєкти">
              <p className="text-4xl font-semibold">{active.length}</p>
              <Link prefetch={false} href="/app/projects" className="mt-2 inline-block text-sm text-accent-soft underline underline-offset-4">Мої проєкти</Link>
            </Card>
            <Card title="Нові повідомлення">
              <p className="text-4xl font-semibold">{totalUnread}</p>
            </Card>
            <Card title="Рахунки до оплати">
              <p className="text-4xl font-semibold">{toPay.length}</p>
            </Card>
          </div>

          {pendingDocs.length > 0 || actions.length > 0 ? (
            <Card title="Що зробити зараз">
              <ul className="flex flex-col gap-3">
                {(pendingDocs as Array<{ id: string; project_id: string; title: string }>).map((doc) => (
                  <li key={doc.id} className="flex flex-col gap-1 rounded-xl border border-accent-soft/50 bg-accent/10 p-4 sm:flex-row sm:items-center sm:justify-between">
                    <span>
                      <span className="block text-xs uppercase tracking-wider text-muted">Документ на погодження</span>
                      {doc.title}
                    </span>
                    <Link prefetch={false} href={`/app/projects/${doc.project_id}/documents/${doc.id}`} className="text-sm text-accent-soft underline underline-offset-4">
                      Переглянути й вирішити
                    </Link>
                  </li>
                ))}
                {actions.map((project) => (
                  <li key={project.id} className="flex flex-col gap-1 rounded-xl border border-accent-soft/50 bg-accent/10 p-4 sm:flex-row sm:items-center sm:justify-between">
                    <span>
                      <span className="font-mono text-xs text-muted">{project.title}</span>
                      <span className="block">{project.next_action}</span>
                    </span>
                    <Link prefetch={false} href={`/app/projects/${project.id}`} className="text-sm text-accent-soft underline underline-offset-4">
                      Відкрити
                    </Link>
                  </li>
                ))}
              </ul>
            </Card>
          ) : null}

          {deadlines.length > 0 ? (
            <Card title="Найближчі строки оплати">
              <ul className="flex flex-col gap-2 text-sm">
                {deadlines.slice(0, 5).map((row) => (
                  <li key={row.invoice_id} className="flex flex-wrap justify-between gap-2">
                    <Link prefetch={false} href={`/app/projects/${row.project_id}/payments`} className="text-accent-soft underline underline-offset-4">
                      {row.number}
                    </Link>
                    <span>
                      {formatMoney(row.amount, row.currency)} · до {row.due_date}
                    </span>
                  </li>
                ))}
              </ul>
            </Card>
          ) : null}

          {active.length > 0 ? (
            <section aria-labelledby="my-projects">
              <h2 id="my-projects" className="mb-4 text-sm font-medium uppercase tracking-wider text-muted">
                Активні проєкти й поточні етапи
              </h2>
              <ul className="grid gap-4 md:grid-cols-2">
                {active.map((project) => (
                  <ProjectCard key={project.id} project={project} unread={unread[project.id] ?? 0} />
                ))}
              </ul>
            </section>
          ) : null}
        </>
      )}
    </div>
  );
}
