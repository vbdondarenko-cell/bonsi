"use client";

import { useActionState } from "react";
import { signOutOtherSessionsAction, updateProfileAction, type FormState } from "@/app/app/actions";
import { adminFieldClass } from "@/components/admin/ui";
import { Button } from "@/components/ui/button";

function Status({ state }: { state: FormState }) {
  if (state?.error) return <p role="alert" className="text-sm text-danger">{state.error}</p>;
  if (state?.ok && state.notice) return <p role="status" className="text-sm text-ok">{state.notice}</p>;
  return null;
}

export function ProfileForm({ name, phone }: { name: string; phone: string }) {
  const [state, action, pending] = useActionState<FormState, FormData>(updateProfileAction, null);
  return (
    <form action={action} className="flex max-w-lg flex-col gap-5" noValidate>
      <div className="flex flex-col gap-2">
        <label htmlFor="profile-name" className="text-sm font-medium">Імʼя</label>
        <input id="profile-name" name="name" defaultValue={name} autoComplete="name" maxLength={100} className={adminFieldClass} />
      </div>
      <div className="flex flex-col gap-2">
        <label htmlFor="profile-phone" className="text-sm font-medium">Телефон (необовʼязково)</label>
        <input id="profile-phone" name="phone" defaultValue={phone} type="tel" autoComplete="tel" maxLength={30} className={adminFieldClass} />
      </div>
      <Status state={state} />
      <Button type="submit" disabled={pending} className="self-start">{pending ? "Зберігаємо…" : "Зберегти"}</Button>
    </form>
  );
}

export function OtherSessionsForm() {
  const [state, action, pending] = useActionState<FormState, FormData>(signOutOtherSessionsAction as never, null);
  return (
    <form action={action} className="flex flex-col gap-3">
      <Status state={state} />
      <Button type="submit" variant="ghost" disabled={pending} className="self-start">
        {pending ? "Завершуємо…" : "Вийти на всіх інших пристроях"}
      </Button>
    </form>
  );
}
