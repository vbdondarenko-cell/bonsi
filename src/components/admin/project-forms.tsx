"use client";

import { useRouter } from "next/navigation";
import { useActionState, useEffect, useRef, useState } from "react";
import type { ActionState } from "@/app/admin/actions";
import {
  addInternalNoteAction,
  createProposalAction,
  inviteClientAction,
  markAdminReadAction,
  saveProposalAction,
  sendAdminMessageAction,
  sendProposalAction,
  setStageAction,
  updateProjectAction,
} from "@/app/admin/project-actions";
import { adminFieldClass } from "@/components/admin/ui";
import { Button } from "@/components/ui/button";
import { PROJECT_STATUS_LABELS, STAGES, STAGE_LABELS, scheduleTotal, type ProposalSchedule } from "@/lib/client/labels";
import { cn } from "@/lib/cn";

function Feedback({ state }: { state: ActionState }) {
  if (state?.error || state?.fieldError) {
    return (
      <p role="alert" className="text-sm text-danger">
        {state.error ?? state.fieldError}
      </p>
    );
  }
  if (state?.ok) {
    return (
      <p role="status" className="text-sm text-ok">
        {state.notice ?? "Збережено"}
      </p>
    );
  }
  return null;
}

export function InviteClientForm({ orderId }: { orderId: string }) {
  const [state, action, pending] = useActionState<ActionState, FormData>(inviteClientAction, null);
  return (
    <form action={action} className="flex flex-col gap-3">
      <input type="hidden" name="orderId" value={orderId} />
      <p className="text-sm text-muted">Клієнт ще не заходив у кабінет. Надішліть запрошення на пошту із заявки — дані вводити вдруге не потрібно.</p>
      <Button type="submit" disabled={pending} className="self-start">
        {pending ? "Надсилаємо…" : "Запросити в кабінет"}
      </Button>
      <Feedback state={state} />
    </form>
  );
}

export function ProjectControlForm({
  projectId,
  status,
  assignee,
  nextOwner,
  nextAction,
  admins,
}: {
  projectId: string;
  status: string;
  assignee: string | null;
  nextOwner: string | null;
  nextAction: string | null;
  admins: Array<{ user_id: string; display_name: string }>;
}) {
  const [state, action, pending] = useActionState<ActionState, FormData>(updateProjectAction, null);
  return (
    <form action={action} className="flex flex-col gap-4">
      <input type="hidden" name="projectId" value={projectId} />
      <label className="flex flex-col gap-2 text-sm font-medium">
        Статус проєкту
        <select name="status" defaultValue={status} className={adminFieldClass}>
          {Object.entries(PROJECT_STATUS_LABELS).map(([id, label]) => (
            <option key={id} value={id}>
              {label}
            </option>
          ))}
        </select>
      </label>
      <label className="flex flex-col gap-2 text-sm font-medium">
        Виконавець
        <select name="assignee" defaultValue={assignee ?? ""} className={adminFieldClass}>
          <option value="">Не призначено</option>
          {admins.map((admin) => (
            <option key={admin.user_id} value={admin.user_id}>
              {admin.display_name}
            </option>
          ))}
        </select>
      </label>
      <label className="flex flex-col gap-2 text-sm font-medium">
        Хто діє наступним
        <select name="nextOwner" defaultValue={nextOwner ?? ""} className={adminFieldClass}>
          <option value="">Ніхто</option>
          <option value="client">Клієнт</option>
          <option value="studio">Студія</option>
        </select>
      </label>
      <label className="flex flex-col gap-2 text-sm font-medium">
        Наступна дія (бачить клієнт)
        <input name="nextAction" defaultValue={nextAction ?? ""} maxLength={300} className={adminFieldClass} />
      </label>
      <Button type="submit" disabled={pending} className="self-start">
        {pending ? "Зберігаємо…" : "Зберегти"}
      </Button>
      <Feedback state={state} />
    </form>
  );
}

export function StageForm({ projectId, stage }: { projectId: string; stage: string }) {
  const [state, action, pending] = useActionState<ActionState, FormData>(setStageAction, null);
  return (
    <form action={action} className="flex flex-col gap-3">
      <input type="hidden" name="projectId" value={projectId} />
      <label htmlFor="stage" className="text-sm font-medium">
        Поточний етап
      </label>
      <div className="flex gap-3">
        <select id="stage" name="stage" defaultValue={stage} className={adminFieldClass}>
          {STAGES.map((id) => (
            <option key={id} value={id}>
              {STAGE_LABELS[id]}
            </option>
          ))}
        </select>
        <Button type="submit" disabled={pending} className="min-h-11 shrink-0 px-5">
          {pending ? "…" : "Перейти"}
        </Button>
      </div>
      <p className="text-xs text-muted">Попередні етапи стають завершеними, наступні — очікуваними.</p>
      <Feedback state={state} />
    </form>
  );
}

export type AdminThreadMessage = { id: number; role: "client" | "admin"; body: string; at: string; readByClient?: boolean };
const time = new Intl.DateTimeFormat("uk-UA", { dateStyle: "short", timeStyle: "short", timeZone: "Europe/Kyiv" });

export function AdminChat({ projectId, messages, lastClientId }: { projectId: string; messages: AdminThreadMessage[]; lastClientId: number }) {
  const router = useRouter();
  const [state, action, pending] = useActionState<ActionState, FormData>(sendAdminMessageAction, null);
  const formRef = useRef<HTMLFormElement>(null);

  useEffect(() => {
    if (state?.ok) formRef.current?.reset();
  }, [state]);
  useEffect(() => {
    if (lastClientId > 0) void markAdminReadAction(projectId);
  }, [projectId, lastClientId]);
  useEffect(() => {
    const timer = window.setInterval(() => {
      if (document.visibilityState === "visible") router.refresh();
    }, 8000);
    return () => window.clearInterval(timer);
  }, [router]);

  return (
    <div className="flex flex-col gap-4">
      <div role="log" aria-live="polite" aria-label="Чат із клієнтом" className="flex max-h-[50dvh] min-h-40 flex-col gap-3 overflow-y-auto rounded-2xl border border-line bg-surface-2/40 p-4">
        {messages.length === 0 ? (
          <p className="m-auto text-sm text-muted">Повідомлень ще немає.</p>
        ) : (
          messages.map((message) => (
            <div key={message.id} className={cn("flex max-w-[85%] flex-col gap-1", message.role === "admin" ? "self-end items-end" : "self-start items-start")}>
              <div className={cn("whitespace-pre-wrap break-words rounded-2xl px-4 py-2.5 text-sm", message.role === "admin" ? "bg-accent text-white" : "border border-line bg-surface")}>
                {message.body}
              </div>
              <span className="text-xs text-muted">
                {message.role === "admin" ? "Студія" : "Клієнт"} · {time.format(new Date(message.at))}
                {message.role === "admin" && message.readByClient ? " · прочитано клієнтом" : null}
              </span>
            </div>
          ))
        )}
      </div>
      <form ref={formRef} action={action} className="flex flex-col gap-3">
        <input type="hidden" name="projectId" value={projectId} />
        <label htmlFor="admin-message" className="text-sm font-medium">
          Відповідь клієнту
        </label>
        <textarea id="admin-message" name="body" rows={3} maxLength={4000} required className={cn(adminFieldClass, "resize-y")} />
        <Feedback state={state} />
        <Button type="submit" disabled={pending} className="self-start">
          {pending ? "Надсилаємо…" : "Надіслати клієнту"}
        </Button>
      </form>
    </div>
  );
}

export function InternalNoteForm({ projectId }: { projectId: string }) {
  const [state, action, pending] = useActionState<ActionState, FormData>(addInternalNoteAction, null);
  const formRef = useRef<HTMLFormElement>(null);
  useEffect(() => {
    if (state?.ok) formRef.current?.reset();
  }, [state]);
  return (
    <form ref={formRef} action={action} className="flex flex-col gap-3">
      <input type="hidden" name="projectId" value={projectId} />
      <label htmlFor="internal-note" className="text-sm font-medium">
        Внутрішня нотатка <span className="font-normal text-muted">(клієнт її не бачить)</span>
      </label>
      <textarea id="internal-note" name="body" rows={3} maxLength={4000} required className={cn(adminFieldClass, "resize-y")} />
      <Feedback state={state} />
      <Button type="submit" variant="ghost" disabled={pending} className="self-start">
        {pending ? "Зберігаємо…" : "Додати нотатку"}
      </Button>
    </form>
  );
}

export function CreateProposalForm({ projectId, copyFrom }: { projectId: string; copyFrom: string | null }) {
  const [state, action, pending] = useActionState<ActionState, FormData>(createProposalAction, null);
  return (
    <form action={action} className="flex flex-col gap-3">
      <input type="hidden" name="projectId" value={projectId} />
      <input type="hidden" name="copyFrom" value={copyFrom ?? ""} />
      <Button type="submit" disabled={pending} className="self-start">
        {pending ? "Створюємо…" : copyFrom ? "Нова версія на основі останньої" : "Створити пропозицію"}
      </Button>
      <Feedback state={state} />
    </form>
  );
}

export type DraftProposal = {
  id: string;
  version: number;
  title: string;
  summary: string;
  features: string[];
  price_amount: string | null;
  currency: string;
  duration_days: number | null;
  payment_schedule: ProposalSchedule;
  included_revisions: number;
  acceptance_terms: string;
};

function presetOf(schedule: ProposalSchedule): string {
  const key = schedule.map((item) => item.percent).join("-");
  return key === "30-40-30" || key === "50-50" ? key : schedule.length ? "custom" : "30-40-30";
}

export function ProposalEditor({ projectId, proposal }: { projectId: string; proposal: DraftProposal }) {
  const [saveState, saveAction, saving] = useActionState<ActionState, FormData>(saveProposalAction, null);
  const [sendState, sendAction, sending] = useActionState<ActionState, FormData>(sendProposalAction, null);
  const [preset, setPreset] = useState(presetOf(proposal.payment_schedule));
  const customText = proposal.payment_schedule.map((item) => `${item.label} | ${item.percent}`).join("\n");

  return (
    <div className="flex flex-col gap-6">
      <form action={saveAction} className="grid gap-4 sm:grid-cols-2" noValidate>
        <input type="hidden" name="proposalId" value={proposal.id} />
        <input type="hidden" name="projectId" value={projectId} />
        <label className="flex flex-col gap-2 text-sm font-medium sm:col-span-2">
          Назва
          <input name="title" defaultValue={proposal.title} maxLength={160} required className={adminFieldClass} />
        </label>
        <label className="flex flex-col gap-2 text-sm font-medium sm:col-span-2">
          Опис робіт
          <textarea name="summary" defaultValue={proposal.summary} rows={4} maxLength={4000} className={cn(adminFieldClass, "resize-y")} />
        </label>
        <label className="flex flex-col gap-2 text-sm font-medium sm:col-span-2">
          Склад функціоналу (кожен пункт з нового рядка)
          <textarea name="features" defaultValue={proposal.features.join("\n")} rows={6} className={cn(adminFieldClass, "resize-y")} />
        </label>
        <label className="flex flex-col gap-2 text-sm font-medium">
          Вартість
          <input name="price" type="number" min="0" step="0.01" defaultValue={proposal.price_amount ?? ""} required className={adminFieldClass} />
        </label>
        <label className="flex flex-col gap-2 text-sm font-medium">
          Валюта
          <select name="currency" defaultValue={proposal.currency} className={adminFieldClass}>
            <option value="UAH">₴ UAH</option>
            <option value="USD">$ USD</option>
            <option value="EUR">€ EUR</option>
          </select>
        </label>
        <label className="flex flex-col gap-2 text-sm font-medium">
          Термін, днів
          <input name="durationDays" type="number" min="1" max="1000" defaultValue={proposal.duration_days ?? ""} required className={adminFieldClass} />
        </label>
        <label className="flex flex-col gap-2 text-sm font-medium">
          Включено правок
          <input name="revisions" type="number" min="0" max="50" defaultValue={proposal.included_revisions} required className={adminFieldClass} />
        </label>
        <label className="flex flex-col gap-2 text-sm font-medium">
          Графік платежів
          <select name="preset" value={preset} onChange={(event) => setPreset(event.target.value)} className={adminFieldClass}>
            <option value="30-40-30">30 / 40 / 30</option>
            <option value="50-50">50 / 50</option>
            <option value="custom">Індивідуальний</option>
          </select>
        </label>
        <div className="flex flex-col gap-2 text-sm font-medium">
          {preset === "custom" ? (
            <label className="flex flex-col gap-2">
              Рядки «Назва | відсоток» (разом {scheduleTotal(proposal.payment_schedule)}%)
              <textarea name="customSchedule" defaultValue={customText} rows={4} className={cn(adminFieldClass, "resize-y font-mono")} />
            </label>
          ) : (
            <>
              <input type="hidden" name="customSchedule" value="" />
              <span className="text-muted">Платежі розрахуються автоматично від вартості.</span>
            </>
          )}
        </div>
        <label className="flex flex-col gap-2 text-sm font-medium sm:col-span-2">
          Умови приймання результату
          <textarea name="terms" defaultValue={proposal.acceptance_terms} rows={3} maxLength={4000} className={cn(adminFieldClass, "resize-y")} />
        </label>
        <div className="flex flex-col gap-2 sm:col-span-2">
          <Feedback state={saveState} />
          <Button type="submit" variant="ghost" disabled={saving} className="self-start">
            {saving ? "Зберігаємо…" : "Зберегти чернетку"}
          </Button>
        </div>
      </form>

      <form action={sendAction} className="flex flex-col gap-3 border-t border-line pt-5">
        <input type="hidden" name="proposalId" value={proposal.id} />
        <input type="hidden" name="projectId" value={projectId} />
        <p className="text-sm text-muted">Спершу збережіть чернетку. Після відправки зміст зафіксується; правки робляться новою версією.</p>
        <Feedback state={sendState} />
        <Button type="submit" disabled={sending} className="self-start">
          {sending ? "Надсилаємо…" : "Надіслати клієнту"}
        </Button>
      </form>
    </div>
  );
}
