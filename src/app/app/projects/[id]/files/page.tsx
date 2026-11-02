import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { FileList } from "@/components/workspace/file-list";
import { FileUploader } from "@/components/workspace/file-uploader";
import { Card } from "@/components/workspace/ui";
import { requireClient } from "@/lib/client/auth";
import { getFiles, getProject } from "@/lib/client/data";
import { FILE_CATEGORY_LABELS } from "@/lib/client/labels";
import { CLIENT_CATEGORIES } from "@/lib/files/policy";

export const metadata: Metadata = { title: "Файли" };

export default async function FilesPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const { supabase } = await requireClient();
  const project = await getProject(supabase, id);
  if (!project) notFound();
  const files = (await getFiles(supabase, id)).filter((file) => file.category !== "attachment" && file.category !== "final" && file.category !== "handover");

  return (
    <div className="flex flex-col gap-6">
      <Card title="Передати студії матеріали">
        <FileUploader projectId={id} categories={CLIENT_CATEGORIES.filter((c) => c !== "attachment")} />
        <p className="mt-4 text-xs text-muted">
          Файли зберігаються в приватному сховищі: їх бачите лише ви та студія. Паролі й ключі доступу сюди не завантажуйте — домовтеся зі студією про безпечну передачу.
        </p>
      </Card>
      <Card title="Файли проєкту">
        <FileList files={files} projectId={id} canDeleteOwn />
      </Card>
      <p className="text-xs text-muted">Категорії: {Object.entries(FILE_CATEGORY_LABELS).filter(([k]) => k !== "attachment").map(([, v]) => v).join(", ")}.</p>
    </div>
  );
}
