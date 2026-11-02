import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { ClientLoginForm } from "@/components/workspace/login-form";
import { getClientState } from "@/lib/client/auth";
import { safeNext } from "@/lib/client/safe-next";

export const metadata: Metadata = { title: "Вхід до кабінету", robots: { index: false, follow: false } };
export const dynamic = "force-dynamic";

export default async function ClientLoginPage({
  searchParams,
}: {
  searchParams: Promise<{ email?: string; next?: string; error?: string }>;
}) {
  const state = await getClientState();
  const params = await searchParams;
  if (state.kind === "client") redirect(safeNext(params.next));

  const email = typeof params.email === "string" && params.email.length <= 200 ? params.email : undefined;

  return (
    <main id="main" className="relative isolate flex min-h-dvh items-center justify-center overflow-hidden px-5 py-16">
      <div
        aria-hidden="true"
        className="absolute left-1/2 top-[-14rem] -z-10 size-[44rem] -translate-x-1/2 rounded-full bg-accent/25 blur-[140px]"
      />
      <div className="w-full max-w-md rounded-[var(--radius-card)] border border-line bg-surface/80 p-7 shadow-2xl backdrop-blur sm:p-10">
        <Link href="/" className="font-mono text-lg font-semibold tracking-[0.2em]">
          BONSI<span className="text-accent-soft">.</span>
        </Link>
        <h1 className="mt-8 text-3xl font-semibold tracking-tight">Кабінет клієнта</h1>
        <p className="mt-3 text-muted">Стежте за проєктом, спілкуйтеся зі студією та погоджуйте етапи в одному місці.</p>
        {state.kind === "unconfigured" ? (
          <p role="alert" className="mt-8 rounded-xl border border-line bg-surface-2 p-4 text-sm text-muted">
            Кабінет ще не налаштований: на сервері не задано підключення до Supabase.
          </p>
        ) : (
          <div className="mt-8">
            <ClientLoginForm
              initialEmail={email}
              next={params.next}
              initialError={params.error === "link" ? "Посилання недійсне або застаріло. Запросіть новий код." : undefined}
            />
          </div>
        )}
        <p className="mt-6 text-sm text-muted">
          Ще не залишали заявку?{" "}
          <Link href="/contact" className="text-accent-soft underline underline-offset-4">
            Надіслати заявку
          </Link>
        </p>
      </div>
    </main>
  );
}
