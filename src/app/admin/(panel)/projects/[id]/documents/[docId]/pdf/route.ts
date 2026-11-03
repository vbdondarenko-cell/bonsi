import { requireAdmin } from "@/lib/admin/guard";
import { uuidSchema } from "@/lib/admin/orders";
import { DOCUMENT_KIND_LABELS, DOCUMENT_STATUS_LABELS } from "@/lib/client/labels";
import { documentNumber, renderDocumentPdf } from "@/lib/documents/pdf";
import { notFoundResponse, pdfFailure, pdfResponse } from "@/lib/documents/pdf-response";
import { legal } from "@/lib/legal";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** PDF документа для адміністратора (MFA): будь-яка версія; не заморожена (чернетка) позначається водяним написом. */
export async function GET(request: Request, { params }: { params: Promise<{ id: string; docId: string }> }) {
  const { id, docId } = await params;
  if (!uuidSchema.safeParse(id).success || !uuidSchema.safeParse(docId).success) return notFoundResponse();
  const { supabase } = await requireAdmin();
  const doc = await supabase.from("documents").select("id,project_id,kind,title,status,current_version,sent_at,decided_at,created_at").eq("id", docId).eq("project_id", id).maybeSingle();
  if (!doc.data) return notFoundResponse();
  const d = doc.data as { id: string; kind: string; title: string; status: string; current_version: number; sent_at: string | null; decided_at: string | null; created_at: string };
  const requested = Number(new URL(request.url).searchParams.get("v") ?? d.current_version);
  const [version, project, decision] = await Promise.all([
    supabase.from("document_versions").select("version,body,content_hash,frozen_at,created_at").eq("document_id", docId).eq("version", requested).maybeSingle(),
    supabase.from("projects").select("title,order_id").eq("id", id).maybeSingle(),
    supabase.from("document_decisions").select("created_at").eq("document_id", docId).eq("version", requested).order("id", { ascending: false }).limit(1).maybeSingle(),
  ]);
  if (!version.data) return notFoundResponse();
  const v = version.data as { version: number; body: string; content_hash: string; frozen_at: string | null; created_at: string };
  const order = project.data ? await supabase.from("orders").select("name").eq("id", (project.data as { order_id: string }).order_id).maybeSingle() : null;
  try {
    const number = documentNumber(d.id, d.created_at);
    const result = await renderDocumentPdf({
      kindLabel: DOCUMENT_KIND_LABELS[d.kind] ?? d.kind,
      title: d.title,
      number,
      version: v.version,
      statusLabel: v.frozen_at ? (v.version === d.current_version ? (DOCUMENT_STATUS_LABELS[d.status] ?? d.status) : "Попередня версія") : "Чернетка",
      draft: !v.frozen_at,
      createdAt: v.created_at,
      sentAt: v.frozen_at,
      decidedAt: (decision.data as { created_at?: string } | null)?.created_at ?? null,
      projectTitle: (project.data as { title?: string } | null)?.title ?? null,
      clientName: (order?.data as { name?: string } | null)?.name ?? null,
      operatorName: legal.operatorName,
      // Для чернетки хеш у БД відповідає поточному тексту (тригер перераховує його при кожній зміні).
      body: v.body,
      contentHash: v.content_hash,
    });
    return pdfResponse(result, `${number}-v${v.version}.pdf`);
  } catch (error) {
    return pdfFailure(error);
  }
}
