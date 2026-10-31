"use client";

import { Button } from "@/components/ui/button";

export default function PanelError({ reset }: { error: Error; reset: () => void }) {
  return (
    <div role="alert" className="rounded-[var(--radius-card)] border border-danger/40 bg-danger/10 p-8">
      <h1 className="text-2xl font-semibold">Щось пішло не так</h1>
      <p className="mt-3 text-muted">Не вдалося завантажити розділ. Спробуйте ще раз.</p>
      <Button type="button" onClick={reset} className="mt-6">
        Спробувати ще раз
      </Button>
    </div>
  );
}
