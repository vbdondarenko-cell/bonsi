"use client";

import { useActionState, useState, useTransition } from "react";
import { startMfaEnrollAction, verifyMfaAction, type ActionState } from "@/app/admin/actions";
import { adminFieldClass } from "@/components/admin/ui";
import { Button } from "@/components/ui/button";

function CodeForm({ factorId }: { factorId: string }) {
  const [state, action, pending] = useActionState<ActionState, FormData>(verifyMfaAction, null);
  return (
    <form action={action} className="flex flex-col gap-4" noValidate>
      <input type="hidden" name="factorId" value={factorId} />
      <div className="flex flex-col gap-2">
        <label htmlFor="code" className="text-sm font-medium">
          Код із додатка (6 цифр)
        </label>
        <input
          id="code"
          name="code"
          inputMode="numeric"
          autoComplete="one-time-code"
          pattern="\d{6}"
          maxLength={6}
          required
          aria-invalid={Boolean(state?.fieldError)}
          aria-describedby={state?.fieldError ? "code-error" : undefined}
          className={`${adminFieldClass} font-mono tracking-[0.4em]`}
        />
        {state?.fieldError ? (
          <p id="code-error" role="alert" className="text-sm text-danger">
            {state.fieldError}
          </p>
        ) : null}
      </div>
      <Button type="submit" disabled={pending}>
        {pending ? "Перевіряємо…" : "Підтвердити"}
      </Button>
    </form>
  );
}

/** Вхід другим фактором: у користувача вже є підтверджений TOTP. */
export function MfaChallenge({ factorId }: { factorId: string }) {
  return <CodeForm factorId={factorId} />;
}

/** Перше налаштування TOTP: QR-код, ключ для ручного введення й підтвердження кодом. */
export function MfaEnroll() {
  const [setup, setSetup] = useState<{ factorId: string; qr: string; secret: string } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  if (!setup) {
    return (
      <div className="flex flex-col gap-4">
        <p className="text-muted">
          Для доступу до заявок потрібна двофакторна автентифікація. Використайте додаток-автентифікатор
          (1Password, Google Authenticator, Authy тощо).
        </p>
        {error ? (
          <p role="alert" className="text-sm text-danger">
            {error}
          </p>
        ) : null}
        <Button
          type="button"
          disabled={pending}
          onClick={() =>
            startTransition(async () => {
              const result = await startMfaEnrollAction();
              if (result.ok) {
                setError(null);
                setSetup({ factorId: result.factorId, qr: result.qr, secret: result.secret });
              } else {
                setError(result.error);
              }
            })
          }
        >
          {pending ? "Готуємо…" : "Налаштувати MFA"}
        </Button>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-6">
      <p className="text-muted">Скануйте QR-код у додатку або введіть ключ вручну, потім підтвердіть кодом.</p>
      <div className="flex flex-col items-start gap-4 sm:flex-row sm:items-center">
        {/* eslint-disable-next-line @next/next/no-img-element -- data URI із SVG від Supabase Auth */}
        <img src={setup.qr} alt="QR-код для додатка-автентифікатора" width={160} height={160} className="rounded-xl bg-white p-2" />
        <div>
          <p className="text-sm text-muted">Ключ для ручного введення</p>
          <p data-testid="mfa-secret" className="mt-1 break-all font-mono text-sm">
            {setup.secret}
          </p>
        </div>
      </div>
      <CodeForm factorId={setup.factorId} />
    </div>
  );
}
