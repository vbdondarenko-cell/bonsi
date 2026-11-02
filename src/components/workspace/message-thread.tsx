"use client";

import { useRouter } from "next/navigation";
import { useActionState, useEffect, useRef } from "react";
import { markReadAction, sendClientMessageAction, type FormState } from "@/app/app/actions";
import { adminFieldClass } from "@/components/admin/ui";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/cn";

export type ThreadMessage = { id: number; role: "client" | "admin"; body: string; at: string; readByStudio?: boolean };

const time = new Intl.DateTimeFormat("uk-UA", { dateStyle: "short", timeStyle: "short", timeZone: "Europe/Kyiv" });

/** Чат проєкту: історія, відправка, позначка «прочитано студією», автооновлення, поки вкладка активна. */
export function MessageThread({ projectId, messages, lastAdminId }: { projectId: string; messages: ThreadMessage[]; lastAdminId: number }) {
  const router = useRouter();
  const [state, action, pending] = useActionState<FormState, FormData>(sendClientMessageAction, null);
  const formRef = useRef<HTMLFormElement>(null);
  const endRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (state?.ok) formRef.current?.reset();
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
          required
          aria-invalid={Boolean(state?.error)}
          aria-describedby={state?.error ? "message-error" : undefined}
          onKeyDown={(event) => {
            if ((event.ctrlKey || event.metaKey) && event.key === "Enter") formRef.current?.requestSubmit();
          }}
          className={cn(adminFieldClass, "resize-y")}
        />
        {state?.error ? (
          <p id="message-error" role="alert" className="text-sm text-danger">
            {state.error}
          </p>
        ) : null}
        <div className="flex items-center gap-4">
          <Button type="submit" disabled={pending}>
            {pending ? "Надсилаємо…" : "Надіслати"}
          </Button>
          <span className="text-xs text-muted">Ctrl/⌘ + Enter</span>
        </div>
      </form>
    </div>
  );
}
