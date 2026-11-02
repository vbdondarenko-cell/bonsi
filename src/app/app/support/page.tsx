import type { Metadata } from "next";
import Link from "next/link";
import { PageHeader } from "@/components/admin/ui";
import { Card } from "@/components/workspace/ui";
import { requireClient } from "@/lib/client/auth";
import { listProjects } from "@/lib/client/data";

export const metadata: Metadata = { title: "Підтримка" };

export default async function SupportPage() {
  const { supabase } = await requireClient();
  const projects = await listProjects(supabase);
  return (
    <div className="flex flex-col gap-8">
      <PageHeader eyebrow="Кабінет" title="Підтримка" />
      <Card title="Як звернутися">
        <ul className="flex flex-col gap-3">
          {projects.map((project) => (
            <li key={project.id}>
              З питань проєкту <span className="font-mono text-sm">{project.title}</span> —{" "}
              <Link prefetch={false} href={`/app/projects/${project.id}/messages`} className="text-accent-soft underline underline-offset-4">
                напишіть студії в чаті проєкту
              </Link>
              .
            </li>
          ))}
          <li>
            Питання щодо доступу до кабінету або нова задача —{" "}
            <Link prefetch={false} href="/contact" className="text-accent-soft underline underline-offset-4">
              форма заявки на сайті
            </Link>
            .
          </li>
        </ul>
      </Card>
    </div>
  );
}
