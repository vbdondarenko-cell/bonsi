import { notFound } from "next/navigation";
import { PageHeader } from "@/components/admin/ui";
import { ProjectTabs } from "@/components/workspace/nav";
import { ProjectStatusPill } from "@/components/workspace/ui";
import { requireClient } from "@/lib/client/auth";
import { getProject, unreadByProject } from "@/lib/client/data";
import { SERVICE_IDS } from "@/lib/orders/options";
import { services } from "@/lib/services";

export default async function ProjectLayout({ children, params }: { children: React.ReactNode; params: Promise<{ id: string }> }) {
  const { id } = await params;
  const { supabase } = await requireClient();
  // Чужий або неіснуючий проєкт: RLS не поверне рядка, тож відповідь однакова — 404.
  const project = await getProject(supabase, id);
  if (!project) notFound();
  const unread = (await unreadByProject(supabase, [project.id]))[project.id] ?? 0;
  const serviceTitle = SERVICE_IDS.includes(project.service as never) ? services.find((s) => s.id === project.service)?.title : undefined;

  return (
    <div className="flex flex-col gap-6">
      <PageHeader eyebrow={project.title} title={serviceTitle ?? "Проєкт"}>
        <ProjectStatusPill status={project.status} />
      </PageHeader>
      <ProjectTabs projectId={project.id} unread={unread} />
      {children}
    </div>
  );
}
