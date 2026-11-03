import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { EmptyState } from "@/components/ui/empty-state";
import { FileList } from "@/components/workspace/file-list";
import { Card, Pill, formatWhen } from "@/components/workspace/ui";
import { requireClient } from "@/lib/client/auth";
import { getDocuments, getFiles, getProject, getProposals } from "@/lib/client/data";
import { DOCUMENT_KIND_LABELS, DOCUMENT_STATUS_LABELS, FILE_CATEGORY_LABELS, formatMoney } from "@/lib/client/labels";

export const metadata: Metadata = { title: "Договори й документи" };

export default async function DocumentsPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const { supabase } = await requireClient();
  const project = await getProject(supabase, id);
  if (!project) notFound();
  const [files, proposals, documents] = await Promise.all([getFiles(supabase, id), getProposals(supabase, id), getDocuments(supabase, id)]);
  const approved = proposals.find((proposal) => proposal.status === "approved");
  const groups = (["document", "final", "handover"] as const).map((category) => ({ category, files: files.filter((file) => file.category === category) }));
  const empty = !approved && documents.length === 0 && groups.every((group) => group.files.length === 0);

  if (empty) {
    return <EmptyState title="Документів поки немає" description="Тут зʼявляться технічне завдання, договір, додаткові угоди, акти, погоджена комерційна пропозиція та файли передачі проєкту." />;
  }
  return (
    <div className="flex flex-col gap-6">
      {documents.length > 0 ? (
        <Card title="Документи на погодження та в архіві">
          <ul className="flex flex-col gap-3">
            {documents.map((doc) => (
              <li key={doc.id} className="flex flex-col gap-2 rounded-xl border border-line p-4 sm:flex-row sm:items-center sm:justify-between">
                <span>
                  <span className="block text-xs uppercase tracking-wider text-muted">{DOCUMENT_KIND_LABELS[doc.kind] ?? doc.kind}</span>
                  <Link prefetch={false} href={`/app/projects/${id}/documents/${doc.id}`} className="font-medium text-accent-soft underline underline-offset-4">
                    {doc.title}
                  </Link>
                  <span className="ml-2 text-xs text-muted">
                    версія {doc.current_version}
                    {doc.sent_at ? ` · ${formatWhen(doc.sent_at)}` : ""}
                  </span>
                </span>
                <Pill tone={doc.status === "approved" ? "ok" : doc.status === "sent" ? "warn" : doc.status === "void" ? "danger" : "muted"}>{DOCUMENT_STATUS_LABELS[doc.status] ?? doc.status}</Pill>
              </li>
            ))}
          </ul>
        </Card>
      ) : null}
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
