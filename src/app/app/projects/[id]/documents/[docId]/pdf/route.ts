import { requireClient } from "@/lib/client/auth";
import { getDocument, getProject } from "@/lib/client/data";
import { DOCUMENT_KIND_LABELS, DOCUMENT_STATUS_LABELS } from "@/lib/client/labels";
import { documentNumber, renderDocumentPdf } from "@/lib/documents/pdf";
import { notFoundResponse, pdfFailure, pdfResponse } from "@/lib/documents/pdf-response";
import { legal } from "@/lib/legal";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** PDF документа для клієнта: лише його проєкт (RLS) і лише ЗАМОРОЖЕНА версія, яку студія надіслала; ?v=N — конкретна версія. */
export async function GET(request: Request, { params }: { params: Promise<{ id: string; docId: string }> }) {
  const { id, docId } = await params;
  const { supabase } = await requireClient();
  const project = await getProject(supabase, id);
  if (!project) return notFoundResponse();
  const data = await getDocument(supabase, docId);
  if (!data || data.document.project_id !== id) return notFoundResponse();

  const requested = Number(new URL(request.url).searchParams.get("v") ?? data.document.current_version);
  const version = data.versions.find((v) => v.version === requested);
  if (!version || !version.frozen_at) return notFoundResponse();

  const profile = await supabase.from("client_profiles").select("name").maybeSingle();
  try {
    const decision = data.decisions.find((d) => d.version === version.version);
    const result = await renderDocumentPdf({
      kindLabel: DOCUMENT_KIND_LABELS[data.document.kind] ?? data.document.kind,
      title: data.document.title,
      number: documentNumber(data.document.id, data.document.created_at),
      version: version.version,
      statusLabel: version.version === data.document.current_version ? (DOCUMENT_STATUS_LABELS[data.document.status] ?? data.document.status) : "Попередня версія",
      draft: false,
      createdAt: version.created_at,
      sentAt: version.frozen_at,
      decidedAt: decision?.created_at ?? null,
      projectTitle: project.title,
      clientName: (profile.data as { name?: string } | null)?.name || null,
      operatorName: legal.operatorName,
      body: version.body,
      contentHash: version.content_hash,
    });
    return pdfResponse(result, `${documentNumber(data.document.id, data.document.created_at)}-v${version.version}.pdf`);
  } catch (error) {
    return pdfFailure(error);
  }
}
