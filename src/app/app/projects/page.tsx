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
  const projects = await listProjects(supabase);
  const unread = await unreadByProject(supabase, projects.map((p) => p.id));

  return (
    <div className="flex flex-col gap-8">
      <PageHeader eyebrow="Кабінет" title="Мої проєкти" />
      {projects.length === 0 ? (
        <EmptyState
          title="Проєктів поки немає"
          description="Надішліть заявку на сайті — проєкт зʼявиться тут автоматично."
          action={<ButtonLink href="/contact">Надіслати заявку</ButtonLink>}
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
