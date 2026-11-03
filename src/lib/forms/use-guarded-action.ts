"use client";

import { useActionState, useEffect, useLayoutEffect, useRef, useState } from "react";
import { OPERATION_FIELD, OPERATION_RETRY_TEXT } from "@/lib/operations";

export { OPERATION_FIELD };

/** Результат серверної дії, який розуміє хук: помилка (error / fieldError) або успіх (ok). */
type Result = { ok?: boolean; error?: string; fieldError?: string } | null | undefined;

/**
 * Повертає у форму значення, які користувач надіслав. React 19 скидає форму після будь-якої дії, навіть невдалої,
 * тому після помилки валідації введене зникло б. Секретні поля (password) і файли не відновлюються.
 */
export function restoreFormValues(form: HTMLFormElement, data: FormData) {
  for (const el of Array.from(form.elements) as Array<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>) {
    if (!el.name || el.name === OPERATION_FIELD) continue;
    if (el instanceof HTMLInputElement && ["hidden", "file", "password", "submit", "button"].includes(el.type)) continue;
    const values = data.getAll(el.name).map(String);
    if (el instanceof HTMLInputElement && (el.type === "checkbox" || el.type === "radio")) el.checked = values.includes(el.value);
    else if (values.length > 0 || el instanceof HTMLTextAreaElement || el instanceof HTMLInputElement) el.value = values[0] ?? "";
    else if (el instanceof HTMLSelectElement && values[0] !== undefined) el.value = values[0];
  }
}

const newOperationId = () => (typeof crypto !== "undefined" && "randomUUID" in crypto ? crypto.randomUUID() : `${Date.now()}-${Math.random()}`.replace(/\./g, ""));

/**
 * Обгортка над useActionState для форм із серверними діями.
 *  - один ідентифікатор операції на спробу: повторна відправка тієї ж спроби (подвійний клік, Enter, повтор запиту)
 *    не виконується двічі ні на клієнті (guard), ні на сервері (`runOnce`);
 *  - після помилки введені дані повертаються у форму; після успіху форма очищується лише за `resetOnSuccess`;
 *  - кнопка неактивна до гідрації, щоб клік не перетворився на звичайну навігацію форми.
 */
export function useGuardedAction<S extends Result>(action: (prev: S, data: FormData) => Promise<S>, options: { resetOnSuccess?: boolean } = {}) {
  const formRef = useRef<HTMLFormElement>(null);
  const lastData = useRef<FormData | null>(null);
  const inFlight = useRef(false);
  const operationId = useRef<string>("");
  const [ready, setReady] = useState(false);

  useEffect(() => {
    operationId.current = newOperationId();
    setReady(true);
  }, []);

  const guarded = async (prev: S, data: FormData): Promise<S> => {
    if (inFlight.current) return prev; // повторна відправка тієї ж спроби ігнорується
    inFlight.current = true;
    if (!data.get(OPERATION_FIELD)) data.set(OPERATION_FIELD, operationId.current || newOperationId());
    lastData.current = data;
    try {
      const result = await action(prev, data);
      // Остаточна відповідь сервера (успіх або помилка) закриває спробу: наступна відправка — нова операція.
      // Якщо виконання не підтверджено, ідентифікатор лишається тим самим, і повтор не виконає дію вдруге.
      if (result?.error !== OPERATION_RETRY_TEXT) operationId.current = newOperationId();
      return result;
    } catch {
      // Мережевий збій або таймаут: дія могла виконатися. Ідентифікатор не змінюємо.
      return { error: OPERATION_RETRY_TEXT } as unknown as S;
    } finally {
      inFlight.current = false;
    }
  };

  const [state, run, pending] = useActionState(guarded as unknown as (prev: Awaited<S>, data: FormData) => Promise<Awaited<S>>, null as Awaited<S>);

  // До малювання: інакше користувач, побачивши сповіщення, міг би почати вводити, і запізніле скидання стерло б введене.
  useLayoutEffect(() => {
    const form = formRef.current;
    if (!state || !form) return;
    if (state.ok) {
      if (options.resetOnSuccess) form.reset();
    } else if ((state.error || state.fieldError) && lastData.current) {
      restoreFormValues(form, lastData.current);
    }
  }, [state, options.resetOnSuccess]);

  return { state, run, pending, formRef, ready };
}
