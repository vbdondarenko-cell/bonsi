"use client";

import { useActionState } from "react";
import { deleteFileAction, type FormState } from "@/app/app/actions";
import { FILE_CATEGORY_LABELS, formatBytes } from "@/lib/client/labels";
import type { FileRow } from "@/lib/client/data";
import { formatWhen } from "./ui";

function DeleteButton({ fileId, projectId }: { fileId: string; projectId: string }) {
  const [state, action, pending] = useActionState<FormState, FormData>(deleteFileAction, null);
  return (
    <form action={action} className="flex items-center gap-2">
      <input type="hidden" name="fileId" value={fileId} />
      <input type="hidden" name="projectId" value={projectId} />
      <button type="submit" disabled={pending} className="text-sm text-muted underline underline-offset-4 hover:text-danger disabled:opacity-60">
        {pending ? "Видаляємо…" : "Видалити"}
      </button>
      {state?.error ? <span role="alert" className="text-xs text-danger">{state.error}</span> : null}
    </form>
  );
}

/** Список файлів: завантаження лише через захищений маршрут (підписане посилання на 60 с). Видалити можна власні файли без вкладення. */
export function FileList({ files, projectId, canDeleteOwn }: { files: FileRow[]; projectId: string; canDeleteOwn: boolean }) {
  if (files.length === 0) return <p className="text-muted">Файлів поки немає.</p>;
  return (
    <ul className="flex flex-col gap-2">
      {files.map((file) => (
        <li key={file.id} className="flex flex-col gap-2 rounded-xl border border-line px-4 py-3 sm:flex-row sm:items-center sm:justify-between">
          <span className="min-w-0">
            <a href={`/api/files/${file.id}`} className="break-all font-medium text-accent-soft underline-offset-4 hover:underline" rel="nofollow">
              {file.display_name}
            </a>
            <span className="block text-xs text-muted">
              {FILE_CATEGORY_LABELS[file.category] ?? file.category} · {formatBytes(file.size_bytes)} · {file.uploader_role === "admin" ? "Студія" : "Ви"} ·{" "}
              <time dateTime={file.created_at}>{formatWhen(file.created_at)}</time>
            </span>
          </span>
          {canDeleteOwn && file.uploader_role === "client" && !file.message_id && !file.deliverable_id ? <DeleteButton fileId={file.id} projectId={projectId} /> : null}
        </li>
      ))}
    </ul>
  );
}
