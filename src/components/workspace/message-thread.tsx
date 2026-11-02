"use client";

import { useRouter } from "next/navigation";
import { useActionState, useEffect, useRef, useState } from "react";
import { markReadAction, sendClientMessageAction, type FormState } from "@/app/app/actions";
import { adminFieldClass } from "@/components/admin/ui";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/cn";
import { ALLOWED_TYPES, MAX_FILES_PER_REQUEST, MAX_FILE_BYTES } from "@/lib/files/policy";
import { formatBytes } from "@/lib/client/labels";

export type ThreadMessage = { id: number; role: "client" | "admin"; body: string; at: string; readByStudio?: boolean; files?: Array<{ id: string; name: string; size: number }> };
const ACCEPT = Object.keys(ALLOWED_TYPES).map((ext) => `.${ext}`).join(",");

const time = new Intl.DateTimeFormat("uk-UA", { dateStyle: "short", timeStyle: "short", timeZone: "Europe/Kyiv" });

/** Чат проєкту: історія, відправка, позначка «прочитано студією», автооновлення, поки вкладка активна. */
export function MessageThread({ projectId, messages, lastAdminId }: { projectId: string; messages: ThreadMessage[]; lastAdminId: number }) {
  const router = useRouter();
  const [state, action, pending] = useActionState<FormState, FormData>(sendClientMessageAction, null);
  const formRef = useRef<HTMLFormElement>(null);
  const endRef = useRef<HTMLDivElement>(null);
  const picker = useRef<HTMLInputElement>(null);
  const [attached, setAttached] = useState<Array<{ id: string; name: string }>>([]);
  const [uploading, setUploading] = useState(false);
  const [uploadError, setUploadError] = useState<string | null>(null);

  async function onPick() {
    const files = Array.from(picker.current?.files ?? []);
    if (files.length === 0) return;
    if (attached.length + files.length > MAX_FILES_PER_REQUEST) return setUploadError(`Не більше ${MAX_FILES_PER_REQUEST} вкладень.`);
    if (files.some((file) => file.size > MAX_FILE_BYTES)) return setUploadError("Файл завеликий (максимум 10 МБ).");
    const form = new FormData();
    for (const file of files) form.append("files", file);
    form.append("category", "attachment");
    setUploading(true);
    setUploadError(null);
    try {
      const response = await fetch(`/api/projects/${projectId}/files`, { method: "POST", body: form });
      const body = (await response.json().catch(() => null)) as { saved?: Array<{ id: string; name: string }>; failed?: Array<{ name: string; reason: string }> } | null;
      if (body?.saved?.length) setAttached((current) => [...current, ...body.saved!]);
      if (body?.failed?.length) setUploadError(body.failed.map((f) => `${f.name}: ${f.reason}`).join("; "));
      else if (!body?.saved?.length) setUploadError("Не вдалося завантажити файл.");
    } catch {
      setUploadError("Немає зʼєднання з сервером.");
    } finally {
      setUploading(false);
      if (picker.current) picker.current.value = "";
    }
  }

  useEffect(() => {
    if (state?.ok) {
      formRef.current?.reset();
      setAttached([]);
    }
  }, [state]);

  // Позначаємо прочитаним, коли бачимо нові повідомлення студії.
  useEffect(() => {
    if (lastAdminId > 0) void markReadAction(projectId);
  }, [projectId, lastAdminId]);

  useEffect(() => {
    endRef.current?.scrollIntoView({ block: "end" });
  }, [messages.length]);

  useEffect(() => {
    const timer = window.setInterval(() => {
      if (document.visibilityState === "visible") router.refresh();
    }, 8000);
    return () => window.clearInterval(timer);
  }, [router]);

  return (
    <div className="flex flex-col gap-4">
      <div role="log" aria-live="polite" aria-label="Історія повідомлень" className="flex max-h-[60dvh] min-h-64 flex-col gap-3 overflow-y-auto rounded-[var(--radius-card)] border border-line bg-surface/50 p-4 sm:p-6">
        {messages.length === 0 ? (
          <p className="m-auto max-w-sm text-center text-muted">Повідомлень ще немає. Напишіть студії — відповідь зʼявиться тут, а не в месенджері.</p>
        ) : (
          messages.map((message) => (
            <div key={message.id} className={cn("flex max-w-[85%] flex-col gap-1", message.role === "client" ? "self-end items-end" : "self-start items-start")}>
              <div
                className={cn(
                  "whitespace-pre-wrap break-words rounded-2xl px-4 py-3 text-[0.95rem]",
                  message.role === "client" ? "bg-accent text-white" : "border border-line bg-surface-2",
                )}
              >
                {message.body}
                {message.files?.length ? (
                  <ul className="mt-2 flex flex-col gap-1 border-t border-white/20 pt-2 text-sm">
                    {message.files.map((file) => (
                      <li key={file.id}>
                        <a href={`/api/files/${file.id}`} rel="nofollow" className="break-all underline underline-offset-4">
                          📎 {file.name}
                        </a>{" "}
                        <span className="opacity-70">({formatBytes(file.size)})</span>
                      </li>
                    ))}
                  </ul>
                ) : null}
              </div>
              <span className="text-xs text-muted">
                {message.role === "admin" ? "Студія BONSI" : "Ви"} · <time dateTime={message.at}>{time.format(new Date(message.at))}</time>
                {message.role === "client" && message.readByStudio ? " · прочитано студією" : null}
              </span>
            </div>
          ))
        )}
        <div ref={endRef} />
      </div>

      <form ref={formRef} action={action} className="flex flex-col gap-3">
        <input type="hidden" name="projectId" value={projectId} />
        <label htmlFor="message-body" className="text-sm font-medium">
          Нове повідомлення
        </label>
        <textarea
          id="message-body"
          name="body"
          rows={3}
          maxLength={4000}
          aria-invalid={Boolean(state?.error)}
          aria-describedby={state?.error ? "message-error" : undefined}
          onKeyDown={(event) => {
            if ((event.ctrlKey || event.metaKey) && event.key === "Enter") formRef.current?.requestSubmit();
          }}
          className={cn(adminFieldClass, "resize-y")}
        />
        {attached.map((file) => (
          <input key={file.id} type="hidden" name="fileId" value={file.id} />
        ))}
        {attached.length > 0 ? (
          <ul className="flex flex-wrap gap-2" aria-label="Вкладення до повідомлення">
            {attached.map((file) => (
              <li key={file.id} className="flex items-center gap-2 rounded-full border border-line px-3 py-1 text-sm">
                📎 {file.name}
                <button type="button" aria-label={`Прибрати ${file.name}`} onClick={() => setAttached((current) => current.filter((item) => item.id !== file.id))} className="text-muted hover:text-fg">
                  ×
                </button>
              </li>
            ))}
          </ul>
        ) : null}
        {state?.error || uploadError ? (
          <p id="message-error" role="alert" className="text-sm text-danger">
            {state?.error ?? uploadError}
          </p>
        ) : null}
        <div className="flex flex-wrap items-center gap-4">
          <Button type="submit" disabled={pending || uploading}>
            {pending ? "Надсилаємо…" : "Надіслати"}
          </Button>
          <label className="cursor-pointer rounded-full border border-line px-4 py-2 text-sm text-muted hover:text-fg">
            {uploading ? "Завантажуємо…" : "Прикріпити файл"}
            <input ref={picker} type="file" multiple accept={ACCEPT} onChange={onPick} disabled={uploading} className="sr-only" />
          </label>
          <span className="text-xs text-muted">Ctrl/⌘ + Enter</span>
        </div>
      </form>
    </div>
  );
}
