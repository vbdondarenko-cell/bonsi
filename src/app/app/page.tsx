import type { Metadata } from "next";
import Link from "next/link";
import { PageHeader } from "@/components/admin/ui";
import { EmptyState } from "@/components/ui/empty-state";
import { ButtonLink } from "@/components/ui/button";
import { ProjectCard } from "@/components/workspace/project-card";
import { Card } from "@/components/workspace/ui";
import { requireClient } from "@/lib/client/auth";
import { listProjects, unreadByProject } from "@/lib/client/data";

export const metadata: Metadata = { title: "Дашборд" };

export default async function DashboardPage() {
  const { supabase, displayName } = await requireClient();
  const projects = await listProjects(supabase);
  const unread = await unreadByProject(supabase, projects.map((p) => p.id));
  const actions = projects.filter((p) => p.status === "active" && p.next_action_owner === "client");
  const totalUnread = Object.values(unread).reduce((a, b) => a + b, 0);

  return (
    <div className="flex flex-col gap-8">
      <PageHeader eyebrow="Кабінет" title={displayName ? `Вітаємо, ${displayName}` : "Вітаємо в кабінеті"} />

      {projects.length === 0 ? (
        <EmptyState
          title="Проєктів поки немає"
          description="Проєкт зʼявляється автоматично, коли студія отримує вашу заявку з цією поштою. Якщо ви вже надсилали заявку з іншої адреси — увійдіть саме з нею."
          action={<ButtonLink href="/contact">Надіслати заявку</ButtonLink>}
        />
      ) : (
        <>
          <div className="grid gap-4 sm:grid-cols-3">
            <Card title="Активні проєкти">
              <p className="text-4xl font-semibold">{projects.filter((p) => p.status === "active").length}</p>
            </Card>
            <Card title="Потребують вашої дії">
              <p className="text-4xl font-semibold">{actions.length}</p>
            </Card>
            <Card title="Нові повідомлення">
              <p className="text-4xl font-semibold">{totalUnread}</p>
            </Card>
          </div>

          {actions.length > 0 ? (
            <Card title="Що зробити зараз">
              <ul className="flex flex-col gap-3">
                {actions.map((project) => (
                  <li key={project.id} className="flex flex-col gap-1 rounded-xl border border-accent-soft/50 bg-accent/10 p-4 sm:flex-row sm:items-center sm:justify-between">
                    <span>
                      <span className="font-mono text-xs text-muted">{project.title}</span>
                      <span className="block">{project.next_action}</span>
                    </span>
                    <Link prefetch={false} href={`/app/projects/${project.id}`} className="text-sm text-accent-soft underline underline-offset-4">
                      Відкрити проєкт
                    </Link>
                  </li>
                ))}
              </ul>
            </Card>
          ) : null}

          <section aria-labelledby="my-projects">
            <h2 id="my-projects" className="mb-4 text-sm font-medium uppercase tracking-wider text-muted">
              Мої проєкти
            </h2>
            <ul className="grid gap-4 md:grid-cols-2">
              {projects.map((project) => (
                <ProjectCard key={project.id} project={project} unread={unread[project.id] ?? 0} />
              ))}
            </ul>
          </section>
        </>
      )}
    </div>
  );
}
