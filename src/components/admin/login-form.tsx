"use client";

import { useActionState } from "react";
import { signInAction, type ActionState } from "@/app/admin/actions";
import { Button } from "@/components/ui/button";
import { adminFieldClass } from "@/components/admin/ui";

export function LoginForm({ initialError }: { initialError?: string }) {
  const [state, action, pending] = useActionState<ActionState, FormData>(signInAction, null);
  const error = state?.error ?? initialError;

  return (
    <form action={action} className="flex flex-col gap-5" noValidate>
      <div className="flex flex-col gap-2">
        <label htmlFor="email" className="text-sm font-medium">
          Email
        </label>
        <input
          id="email"
          name="email"
          type="email"
          autoComplete="username"
          required
          aria-invalid={Boolean(error)}
          aria-describedby={error ? "login-error" : undefined}
          className={adminFieldClass}
        />
      </div>
      <div className="flex flex-col gap-2">
        <label htmlFor="password" className="text-sm font-medium">
          Пароль
        </label>
        <input
          id="password"
          name="password"
          type="password"
          autoComplete="current-password"
          required
          aria-invalid={Boolean(error)}
          aria-describedby={error ? "login-error" : undefined}
          className={adminFieldClass}
        />
      </div>
      {error ? (
        <p id="login-error" role="alert" className="text-sm text-danger">
          {error}
        </p>
      ) : null}
      <Button type="submit" disabled={pending} className="w-full">
        {pending ? "Входимо…" : "Увійти"}
      </Button>
    </form>
  );
}
