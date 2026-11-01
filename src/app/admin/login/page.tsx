import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { LoginForm } from "@/components/admin/login-form";
import { getAuthState } from "@/lib/admin/guard";

export const metadata: Metadata = { title: "Вхід" };
export const dynamic = "force-dynamic";

export default async function AdminLoginPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string }>;
}) {
  const state = await getAuthState();
  if (state.kind === "admin") redirect("/admin");
  if (state.kind === "needs_mfa") redirect("/admin/mfa");

  const { error } = await searchParams;

  return (
    <main id="main" className="relative isolate flex min-h-dvh items-center justify-center overflow-hidden px-5 py-16">
      <div
        aria-hidden="true"
        className="absolute left-1/2 top-[-14rem] -z-10 size-[44rem] -translate-x-1/2 rounded-full bg-accent/25 blur-[140px]"
      />
      <div className="w-full max-w-md rounded-[var(--radius-card)] border border-line bg-surface/80 p-7 shadow-2xl backdrop-blur sm:p-10">
        <p className="font-mono text-lg font-semibold tracking-[0.2em]">
          BONSI<span className="text-accent-soft">.</span>
        </p>
        <h1 className="mt-8 text-3xl font-semibold tracking-tight">Вхід до адмінпанелі</h1>
        <p className="mt-3 text-muted">Доступ лише для засновників студії.</p>
        {state.kind === "unconfigured" ? (
          <p role="alert" className="mt-8 rounded-xl border border-line bg-surface-2 p-4 text-sm text-muted">
            Адмін-панель ще не налаштована: на сервері не задано підключення до Supabase.
          </p>
        ) : (
          <div className="mt-8">
            <LoginForm initialError={error === "forbidden" ? "Невірний email або пароль." : undefined} />
          </div>
        )}
        <p className="mt-6 text-sm text-muted">
          Вперше тут?{" "}
          <Link prefetch={false} href="/admin/register" className="text-accent-soft underline underline-offset-4">
            Зареєструватися
          </Link>
        </p>
      </div>
    </main>
  );
}
