"use client";

import { useActionState } from "react";
import { registerAction, type ActionState } from "@/app/admin/actions";
import { Button } from "@/components/ui/button";
import { adminFieldClass } from "@/components/admin/ui";

export function RegisterForm() {
  const [state, action, pending] = useActionState<ActionState, FormData>(registerAction, null);

  if (state?.ok) {
    return (
      <p role="status" className="rounded-xl border border-ok/40 bg-ok/10 p-4 text-sm">
        {state.notice}
      </p>
    );
  }

  const error = state?.error ?? state?.fieldError;
  return (
    <form action={action} className="flex flex-col gap-5" noValidate>
      <div className="flex flex-col gap-2">
        <label htmlFor="reg-email" className="text-sm font-medium">
          Email
        </label>
        <input id="reg-email" name="email" type="email" autoComplete="username" required className={adminFieldClass} />
      </div>
      <div className="flex flex-col gap-2">
        <label htmlFor="reg-password" className="text-sm font-medium">
          Пароль (від 12 символів)
        </label>
        <input
          id="reg-password"
          name="password"
          type="password"
          autoComplete="new-password"
          minLength={12}
          required
          className={adminFieldClass}
        />
      </div>
      <div className="flex flex-col gap-2">
        <label htmlFor="reg-confirm" className="text-sm font-medium">
          Повторіть пароль
        </label>
        <input
          id="reg-confirm"
          name="confirm"
          type="password"
          autoComplete="new-password"
          minLength={12}
          required
          aria-invalid={Boolean(error)}
          aria-describedby={error ? "reg-error" : undefined}
          className={adminFieldClass}
        />
      </div>
      {error ? (
        <p id="reg-error" role="alert" className="text-sm text-danger">
          {error}
        </p>
      ) : null}
      <Button type="submit" disabled={pending} className="w-full">
        {pending ? "Створюємо…" : "Зареєструватися"}
      </Button>
    </form>
  );
}
