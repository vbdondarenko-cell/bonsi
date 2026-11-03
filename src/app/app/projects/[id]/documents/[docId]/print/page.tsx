import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { DocumentBody } from "@/components/workspace/document-body";
import { requireClient } from "@/lib/client/auth";
import { getDocument, getProject } from "@/lib/client/data";
import { DOCUMENT_KIND_LABELS, DOCUMENT_STATUS_LABELS } from "@/lib/client/labels";

export const metadata: Metadata = { title: "Друк документа" };

/** Версія для друку/збереження в PDF засобами браузера. Автоматичного генерування файлу PDF на сервері поки немає. */
export default async function DocumentPrintPage({ params }: { params: Promise<{ id: string; docId: string }> }) {
  const { id, docId } = await params;
  const { supabase } = await requireClient();
  const project = await getProject(supabase, id);
  if (!project) notFound();
  const data = await getDocument(supabase, docId);
  if (!data || data.document.project_id !== id) notFound();
  const { document, versions } = data;
  const current = versions.find((v) => v.version === document.current_version) ?? versions[0];

  return (
    <article className="mx-auto max-w-3xl bg-white p-10 text-black print:p-0">
      <p className="text-xs uppercase tracking-wider text-gray-600">
        {DOCUMENT_KIND_LABELS[document.kind] ?? document.kind} · версія {document.current_version} · {DOCUMENT_STATUS_LABELS[document.status]}
      </p>
      <h1 className="mt-2 text-2xl font-semibold">{document.title}</h1>
      <div className="mt-6 text-black [&_*]:!text-black">{current ? <DocumentBody body={current.body} /> : null}</div>
      {current ? <p className="mt-8 break-all font-mono text-xs text-gray-600">SHA-256: {current.content_hash}</p> : null}
      <p className="mt-2 text-xs text-gray-600">Шаблон не є юридично перевіреним документом; погодження в кабінеті не є кваліфікованим електронним підписом.</p>
    </article>
  );
}
