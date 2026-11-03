import type { Metadata } from "next";
import { PageHeader } from "@/components/admin/ui";
import { ButtonLink } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";
import { ProjectCard } from "@/components/workspace/project-card";
import { requireClient } from "@/lib/client/auth";
import { listProjects, unreadByProject } from "@/lib/client/data";

export const metadata: Metadata = { title: "Мої проєкти" };

export default async function ProjectsPage() {
  const { supabase } = await requireClient();
  // «Мої проєкти» — лише активні контрактні проєкти; заявки й робочі простори до активації — у розділі «Мої заявки».
  const all = await listProjects(supabase);
  const projects = all.filter((p) => p.activated_at);
  const pending = all.length - projects.length;
  const unread = await unreadByProject(supabase, projects.map((p) => p.id));

  return (
    <div className="flex flex-col gap-8">
      <PageHeader eyebrow="Кабінет" title="Мої проєкти" />
      {projects.length === 0 ? (
        <EmptyState
          title="Активних проєктів поки немає"
          description={pending > 0 ? "Проєкт стає активним після погодження пропозиції, договору та передоплати (якщо вона передбачена). Ваші заявки — у розділі «Мої заявки»." : "Надішліть заявку на сайті — після погодження умов тут зʼявиться активний проєкт."}
          action={<ButtonLink href={pending > 0 ? "/app/requests" : "/contact"}>{pending > 0 ? "Мої заявки" : "Надіслати заявку"}</ButtonLink>}
        />
      ) : (
        <ul className="grid gap-4 md:grid-cols-2">
          {projects.map((project) => (
            <ProjectCard key={project.id} project={project} unread={unread[project.id] ?? 0} />
          ))}
        </ul>
      )}
    </div>
  );
}
