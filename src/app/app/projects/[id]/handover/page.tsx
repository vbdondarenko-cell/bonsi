import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { HandoverDecisionForm } from "@/components/workspace/support-forms";
import { Card, Pill, formatWhen } from "@/components/workspace/ui";
import { requireClient } from "@/lib/client/auth";
import { getHandover, getProject } from "@/lib/client/data";
import { DECISION_LABELS, HANDOVER_KIND_LABELS, HANDOVER_STATUS_LABELS } from "@/lib/client/labels";

export const metadata: Metadata = { title: "Передача проєкту" };

const Row = ({ label, value }: { label: string; value: string | null | undefined }) =>
  value ? (
    <div className="flex flex-col gap-1 sm:flex-row sm:gap-4">
      <dt className="w-56 shrink-0 text-sm text-muted">{label}</dt>
      <dd className="min-w-0 break-words text-sm">{value}</dd>
    </div>
  ) : null;

export default async function HandoverPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const { supabase } = await requireClient();
  const project = await getProject(supabase, id);
  if (!project) notFound();
  const { record, decisions, warrantyUntil } = await getHandover(supabase, id);
  const visible = record && record.status !== "draft";

  return (
    <div className="flex flex-col gap-6">
      <Card title="Передача проєкту">
        {!visible || !record ? (
          <p className="text-muted">Передачу ще не підготовлено. Коли робота буде завершена, студія надішле тут перелік результатів, доступів і документації для вашого приймання.</p>
        ) : (
          <div className="flex flex-col gap-4">
            <p className="flex flex-wrap items-center gap-2">
              <Pill tone={record.status === "accepted" ? "ok" : record.status === "changes_requested" ? "warn" : "accent"}>{HANDOVER_STATUS_LABELS[record.status] ?? record.status}</Pill>
              <span className="text-sm text-muted">{HANDOVER_KIND_LABELS[record.product_kind] ?? record.product_kind}</span>
              {record.submitted_at ? <span className="text-xs text-muted">надіслано {formatWhen(record.submitted_at)}</span> : null}
            </p>
            <dl className="flex flex-col gap-2">
              <Row label="Production URL" value={record.production_url} />
              <Row label="Домен" value={record.domain} />
              <Row label="Власник домену" value={record.domain_owner} />
              <Row label="Хостинг" value={record.hosting} />
              <Row label="Репозиторій" value={record.repository_url} />
              <Row label="Документація" value={record.docs_url} />
              <Row label="Інструкція" value={record.manual_url} />
              <Row label="Резервні копії" value={record.backup_note} />
              <Row label="Версія застосунку" value={record.app_version} />
              <Row label="Стан у магазинах" value={record.store_state} />
              <Row label="Серверна частина" value={record.backend_note} />
              <Row label="Права й доступи" value={record.rights_note} />
            </dl>
            {record.artifacts.length > 0 ? (
              <ul className="flex flex-col gap-1 text-sm">
                {record.artifacts.map((a, i) => (
                  <li key={i}>
                    <span className="font-mono text-xs text-muted">{a.kind}</span> — {a.label}:{" "}
                    <a href={a.url} target="_blank" rel="noopener noreferrer" className="break-all text-accent-soft underline underline-offset-4">
                      {a.url}
                    </a>
                  </li>
                ))}
              </ul>
            ) : null}
            <p className="text-xs text-muted">Паролі, токени й ключі тут не зберігаються — студія передає їх окремим захищеним каналом.</p>
          </div>
        )}
      </Card>

      {record?.status === "submitted" ? (
        <Card title="Ваше рішення">
          <HandoverDecisionForm projectId={id} />
        </Card>
      ) : null}

      {warrantyUntil ? (
        <Card title="Гарантія">
          <p className="text-sm">
            Гарантійний період діє до <strong>{warrantyUntil}</strong>. Звернення щодо помилок — у розділі «Підтримка».
          </p>
        </Card>
      ) : null}

      {decisions.length > 0 ? (
        <Card title="Історія рішень">
          <ul className="flex flex-col gap-2 text-sm">
            {decisions.map((d) => (
              <li key={d.id}>
                {formatWhen(d.created_at)} — <strong>{DECISION_LABELS[d.decision] ?? d.decision}</strong>
                {d.comment ? `: ${d.comment}` : ""}
              </li>
            ))}
          </ul>
        </Card>
      ) : null}
    </div>
  );
}
