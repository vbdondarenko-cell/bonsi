import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { DocumentBody } from "@/components/workspace/document-body";
import { DocumentDecision } from "@/components/workspace/document-decision";
import { Card, Pill, formatWhen } from "@/components/workspace/ui";
import { requireClient } from "@/lib/client/auth";
import { getDocument, getProject } from "@/lib/client/data";
import { DECISION_LABELS, DOCUMENT_KIND_LABELS, DOCUMENT_STATUS_LABELS } from "@/lib/client/labels";

export const metadata: Metadata = { title: "Документ" };

export default async function DocumentPage({ params }: { params: Promise<{ id: string; docId: string }> }) {
  const { id, docId } = await params;
  const { supabase } = await requireClient();
  const project = await getProject(supabase, id);
  if (!project) notFound();
  const data = await getDocument(supabase, docId);
  // Документ іншого проєкту (IDOR через підміну id у URL) для цього шляху не існує.
  if (!data || data.document.project_id !== id) notFound();
  const { document, versions, decisions } = data;
  const current = versions.find((v) => v.version === document.current_version) ?? versions[0];

  return (
    <div className="flex flex-col gap-6">
      <p>
        <Link prefetch={false} href={`/app/projects/${id}/documents`} className="text-sm text-muted hover:text-fg">
          ← Усі документи
        </Link>
      </p>
      <Card>
        <div className="flex flex-wrap items-center gap-3">
          <span className="text-xs uppercase tracking-wider text-muted">{DOCUMENT_KIND_LABELS[document.kind] ?? document.kind}</span>
          <Pill tone={document.status === "approved" ? "ok" : document.status === "sent" ? "warn" : document.status === "void" ? "danger" : "muted"}>
            {DOCUMENT_STATUS_LABELS[document.status] ?? document.status}
          </Pill>
          <span className="text-xs text-muted">версія {document.current_version}</span>
          <Link prefetch={false} href={`/app/projects/${id}/documents/${docId}/print`} className="ml-auto text-sm text-accent-soft underline underline-offset-4" target="_blank">
            Друк / зберегти як PDF
          </Link>
        </div>
        <h2 className="mt-3 text-2xl font-semibold">{document.title}</h2>
        {current ? (
          <div className="mt-6">
            <DocumentBody body={current.body} />
            <p className="mt-6 break-all font-mono text-xs text-muted">SHA-256 версії {current.version}: {current.content_hash}</p>
          </div>
        ) : null}
      </Card>

      {document.status === "sent" ? (
        <Card title="Ваше рішення">
          <DocumentDecision documentId={document.id} projectId={id} version={document.current_version} />
        </Card>
      ) : null}

      <Card title="Журнал рішень">
        {decisions.length === 0 ? (
          <p className="text-muted">Рішень щодо цього документа ще немає.</p>
        ) : (
          <ol className="flex flex-col gap-3">
            {decisions.map((d) => (
              <li key={d.id} className="border-l-2 border-line pl-4">
                <p>
                  <strong>{DECISION_LABELS[d.decision] ?? d.decision}</strong> · версія {d.version} · {formatWhen(d.created_at)}
                </p>
                {d.comment ? <p className="text-sm text-muted">{d.comment}</p> : null}
                <p className="break-all font-mono text-xs text-muted">SHA-256: {d.content_hash}</p>
              </li>
            ))}
          </ol>
        )}
      </Card>

      {versions.length > 1 ? (
        <Card title="Попередні версії">
          <ul className="flex flex-col gap-2 text-sm">
            {versions
              .filter((v) => v.version !== document.current_version)
              .map((v) => (
                <li key={v.version}>
                  Версія {v.version} · {v.frozen_at ? formatWhen(v.frozen_at) : "чернетка"} · <span className="break-all font-mono text-xs text-muted">{v.content_hash.slice(0, 16)}…</span>
                </li>
              ))}
          </ul>
        </Card>
      ) : null}
    </div>
  );
}
