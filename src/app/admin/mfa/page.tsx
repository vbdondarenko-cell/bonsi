import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { MfaChallenge, MfaEnroll } from "@/components/admin/mfa-panel";
import { signOutAction } from "@/app/admin/actions";
import { getAuthState } from "@/lib/admin/guard";

export const metadata: Metadata = { title: "Двофакторна автентифікація" };
export const dynamic = "force-dynamic";

export default async function AdminMfaPage() {
  const state = await getAuthState();
  if (state.kind === "admin") redirect("/admin");
  if (state.kind !== "needs_mfa") redirect("/admin/login");

  return (
    <main id="main" className="flex min-h-dvh items-center justify-center px-5 py-16">
      <div className="w-full max-w-lg rounded-[var(--radius-card)] border border-line bg-surface/80 p-7 sm:p-10">
        <p className="font-mono text-xs uppercase tracking-[0.2em] text-accent-soft">Крок 2 з 2</p>
        <h1 className="mt-4 text-3xl font-semibold tracking-tight">
          {state.hasFactor ? "Підтвердіть вхід" : "Налаштуйте MFA"}
        </h1>
        <p className="mt-2 text-sm text-muted">{state.email}</p>
        <div className="mt-8">
          {state.hasFactor && state.factorId ? <MfaChallenge factorId={state.factorId} /> : <MfaEnroll />}
        </div>
        <form action={signOutAction} className="mt-8 border-t border-line pt-6">
          <button type="submit" className="text-sm text-muted underline underline-offset-4 hover:text-fg">
            Вийти
          </button>
        </form>
      </div>
    </main>
  );
}
