import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { EmptyState } from "@/components/ui/empty-state";
import { FileList } from "@/components/workspace/file-list";
import { Card } from "@/components/workspace/ui";
import { requireClient } from "@/lib/client/auth";
import { getFiles, getProject, getProposals } from "@/lib/client/data";
import { FILE_CATEGORY_LABELS, formatMoney } from "@/lib/client/labels";

export const metadata: Metadata = { title: "Документи" };

export default async function DocumentsPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const { supabase } = await requireClient();
  const project = await getProject(supabase, id);
  if (!project) notFound();
  const [files, proposals] = await Promise.all([getFiles(supabase, id), getProposals(supabase, id)]);
  const approved = proposals.find((proposal) => proposal.status === "approved");
  const groups = (["document", "final", "handover"] as const).map((category) => ({ category, files: files.filter((file) => file.category === category) }));
  const empty = !approved && groups.every((group) => group.files.length === 0);

  if (empty) {
    return <EmptyState title="Документів поки немає" description="Тут зʼявляться погоджена комерційна пропозиція, договірні й фінальні документи, а також файли передачі проєкту та документація." />;
  }
  return (
    <div className="flex flex-col gap-6">
      {approved ? (
        <Card title="Погоджена пропозиція">
          <p>
            Версія {approved.version}: {approved.title}
            {approved.price_amount ? ` · ${formatMoney(approved.price_amount, approved.currency)}` : ""}.{" "}
            <Link prefetch={false} href={`/app/projects/${id}/proposal`} className="text-accent-soft underline underline-offset-4">
              Відкрити
            </Link>
          </p>
        </Card>
      ) : null}
      {groups.map((group) =>
        group.files.length > 0 ? (
          <Card key={group.category} title={FILE_CATEGORY_LABELS[group.category]}>
            <FileList files={group.files} projectId={id} canDeleteOwn={false} />
          </Card>
        ) : null,
      )}
    </div>
  );
}
