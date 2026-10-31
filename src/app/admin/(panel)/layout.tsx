import Link from "next/link";
import { signOutAction } from "@/app/admin/actions";
import { AdminNav } from "@/components/admin/nav";
import { requireAdmin } from "@/lib/admin/guard";

export const dynamic = "force-dynamic";

export default async function PanelLayout({ children }: { children: React.ReactNode }) {
  const admin = await requireAdmin();

  return (
    <div className="mx-auto flex min-h-dvh w-full max-w-[1400px] flex-col gap-6 px-5 py-5 sm:px-8 lg:flex-row lg:gap-10 lg:py-8">
      <a
        href="#main"
        className="sr-only z-[70] rounded-full bg-accent px-5 py-3 font-medium text-white focus:not-sr-only focus:fixed focus:left-4 focus:top-4"
      >
        Перейти до вмісту
      </a>
      <aside className="flex flex-col gap-4 lg:sticky lg:top-8 lg:h-[calc(100dvh-4rem)] lg:w-60 lg:shrink-0 lg:justify-between">
        <div className="flex flex-col gap-4 lg:gap-10">
          <div className="flex items-center justify-between">
            <Link href="/admin" className="font-mono text-lg font-semibold tracking-[0.2em]">
              BONSI<span className="text-accent-soft">.</span>
              <span className="ml-3 text-xs font-normal uppercase tracking-widest text-muted">admin</span>
            </Link>
            <form action={signOutAction} className="lg:hidden">
              <button type="submit" className="rounded-full border border-line px-4 py-2 text-sm text-muted hover:text-fg">
                Вийти
              </button>
            </form>
          </div>
          <AdminNav />
        </div>
        <div className="hidden flex-col gap-3 rounded-2xl border border-line bg-surface/70 p-4 lg:flex">
          <div>
            <p className="text-sm font-medium">{admin.displayName}</p>
            <p className="break-all text-xs text-muted">{admin.email}</p>
          </div>
          <form action={signOutAction}>
            <button type="submit" className="text-sm text-muted underline underline-offset-4 hover:text-fg">
              Вийти
            </button>
          </form>
        </div>
      </aside>
      <main id="main" tabIndex={-1} className="min-w-0 flex-1 pb-16 outline-none">
        {children}
      </main>
    </div>
  );
}
