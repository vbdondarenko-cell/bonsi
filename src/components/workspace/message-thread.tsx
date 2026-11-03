"use client";

import { useCallback, useEffect, useMemo, useRef, useState, useTransition } from "react";
import { loadMessagesAction, markReadAction, sendClientMessageAction } from "@/app/app/actions";
import { adminFieldClass } from "@/components/admin/ui";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/cn";
import { formatBytes } from "@/lib/client/labels";
import type { ThreadMessage } from "@/lib/client/thread";
import { OPERATION_FIELD, OPERATION_RETRY_TEXT } from "@/lib/operations";
import { ALLOWED_TYPES, MAX_FILES_PER_REQUEST, MAX_FILE_BYTES } from "@/lib/files/policy";

export type { ThreadMessage };
const ACCEPT = Object.keys(ALLOWED_TYPES).map((ext) => `.${ext}`).join(",");
const POLL_MS = 8000;

const time = new Intl.DateTimeFormat("uk-UA", { dateStyle: "short", timeStyle: "short", timeZone: "Europe/Kyiv" });

/** Зливає сторінки за id без дублікатів; нові дані перекривають старі (наприклад, оновлену позначку «прочитано»). */
export function mergeMessages(current: ThreadMessage[], incoming: ThreadMessage[]): ThreadMessage[] {
  const byId = new Map(current.map((message) => [message.id, message]));
  for (const message of incoming) byId.set(message.id, message);
  return Array.from(byId.values()).sort((left, right) => left.id - right.id);
}

/**
 * Чат проєкту. Показує останні повідомлення, старіші підвантажуються за курсором, нові приходять опитуванням за id.
 * Чернетка не губиться: поле очищується лише після підтвердженої відправки.
 */
export function MessageThread({ projectId, initialMessages, initialHasMore }: { projectId: string; initialMessages: ThreadMessage[]; initialHasMore: boolean }) {
  const [messages, setMessages] = useState(initialMessages);
  const [hasMore, setHasMore] = useState(initialHasMore);
  const [loadingOlder, setLoadingOlder] = useState(false);
  const [syncError, setSyncError] = useState<string | null>(null);
  const [draft, setDraft] = useState("");
  const [sendError, setSendError] = useState<string | null>(null);
  const [sending, startSending] = useTransition();
  const endRef = useRef<HTMLDivElement>(null);
  const picker = useRef<HTMLInputElement>(null);
  const stickToEnd = useRef(true);
  // Один ідентифікатор на спробу відправки: повтор після збою/таймауту не створить друге повідомлення. Міняється після остаточної відповіді.
  const operationId = useRef<string>("");
  const nextOperation = () => (typeof crypto !== "undefined" && "randomUUID" in crypto ? crypto.randomUUID() : "");
  const [attached, setAttached] = useState<Array<{ id: string; name: string }>>([]);
  const [uploading, setUploading] = useState(false);
  const [uploadError, setUploadError] = useState<string | null>(null);

  const lastId = messages.at(-1)?.id ?? 0;
  const firstId = messages[0]?.id ?? 0;
  const lastAdminId = useMemo(() => messages.filter((m) => m.role === "admin").at(-1)?.id ?? 0, [messages]);

  const pollNewer = useCallback(async () => {
    try {
      const page = await loadMessagesAction(projectId, { after: lastId });
      if (!page.ok) return setSyncError(page.error);
      setSyncError(null);
      if (page.messages.length > 0) setMessages((current) => mergeMessages(current, page.messages));
    } catch {
      setSyncError("Немає зʼєднання. Нові повідомлення зʼявляться, щойно звʼязок відновиться.");
    }
  }, [projectId, lastId]);

  async function loadOlder() {
    setLoadingOlder(true);
    stickToEnd.current = false;
    try {
      const page = await loadMessagesAction(projectId, { before: firstId });
      if (!page.ok) return setSyncError(page.error);
      setSyncError(null);
      setMessages((current) => mergeMessages(current, page.messages));
      setHasMore(page.hasMore);
    } catch {
      setSyncError("Не вдалося завантажити історію. Перевірте зʼєднання й спробуйте ще раз.");
    } finally {
      setLoadingOlder(false);
    }
  }

  function send(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (sending) return;
    const body = draft.trim();
    if (!body && attached.length === 0) return setSendError("Напишіть повідомлення або додайте файл.");
    if (typeof navigator !== "undefined" && navigator.onLine === false) return setSendError("Немає зʼєднання. Текст збережено в полі — надішліть, коли звʼязок відновиться.");
    if (!operationId.current) operationId.current = nextOperation();
    const form = new FormData();
    form.set(OPERATION_FIELD, operationId.current);
    form.set("projectId", projectId);
    form.set("body", body);
    for (const file of attached) form.append("fileId", file.id);
    setSendError(null);
    startSending(async () => {
      try {
        const result = await sendClientMessageAction(null, form);
        if (result?.error !== OPERATION_RETRY_TEXT) operationId.current = nextOperation(); // остаточна відповідь закриває спробу
        if (result?.ok) {
          setDraft("");
          setAttached([]);
          stickToEnd.current = true;
          await pollNewer();
        } else {
          setSendError(result?.error ?? "Не вдалося надіслати. Текст збережено — спробуйте ще раз.");
        }
      } catch {
        // Мережа/сервер недоступні: чернетку не чіпаємо.
        setSendError("Не вдалося надіслати: немає зʼєднання із сервером. Текст збережено — спробуйте ще раз.");
      }
    });
  }

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

  // Позначаємо прочитаним, коли зʼявилось нове повідомлення студії.
  useEffect(() => {
    if (lastAdminId > 0) void markReadAction(projectId).catch(() => undefined);
  }, [projectId, lastAdminId]);

  useEffect(() => {
    if (stickToEnd.current) endRef.current?.scrollIntoView({ block: "end" });
  }, [lastId]);

  useEffect(() => {
    const timer = window.setInterval(() => {
      if (document.visibilityState === "visible") void pollNewer();
    }, POLL_MS);
    const onOnline = () => void pollNewer();
    window.addEventListener("online", onOnline);
    return () => {
      window.clearInterval(timer);
      window.removeEventListener("online", onOnline);
    };
  }, [pollNewer]);

  return (
    <div className="flex flex-col gap-4">
      <div role="log" aria-live="polite" aria-label="Історія повідомлень" className="flex max-h-[60dvh] min-h-64 flex-col gap-3 overflow-y-auto rounded-[var(--radius-card)] border border-line bg-surface/50 p-4 sm:p-6">
        {hasMore ? (
          <button type="button" onClick={loadOlder} disabled={loadingOlder} className="self-center rounded-full border border-line px-4 py-1.5 text-sm text-muted hover:text-fg disabled:opacity-60">
            {loadingOlder ? "Завантажуємо…" : "Показати старіші повідомлення"}
          </button>
        ) : null}
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

      <form onSubmit={send} className="flex flex-col gap-3">
        <label htmlFor="message-body" className="text-sm font-medium">
          Нове повідомлення
        </label>
        <textarea
          id="message-body"
          name="body"
          rows={3}
          maxLength={4000}
          value={draft}
          onChange={(event) => setDraft(event.target.value)}
          aria-invalid={Boolean(sendError)}
          aria-describedby={sendError ? "message-error" : undefined}
          onKeyDown={(event) => {
            if ((event.ctrlKey || event.metaKey) && event.key === "Enter") event.currentTarget.form?.requestSubmit();
          }}
          className={cn(adminFieldClass, "resize-y")}
        />
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
        {syncError ? (
          <p role="status" className="text-sm text-muted">
            {syncError}
          </p>
        ) : null}
        {sendError || uploadError ? (
          <p id="message-error" role="alert" className="text-sm text-danger">
            {sendError ?? uploadError}
          </p>
        ) : null}
        <div className="flex flex-wrap items-center gap-4">
          <Button type="submit" disabled={sending || uploading}>
            {sending ? "Надсилаємо…" : "Надіслати"}
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
