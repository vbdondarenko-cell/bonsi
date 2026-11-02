"use client";

import { useEffect } from "react";
import { Button } from "@/components/ui/button";

/**
 * Помилка читання даних кабінету. Показуємо її прямо, а не «порожній» стан чи вигаданий статус («не сплачено», «повідомлень немає»).
 * Деталі не виводимо: лише код дайджесту, за яким студія знайде запис у журналах.
 */
export default function AppError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  useEffect(() => {
    // Лише службовий дайджест, без даних користувача.
    console.error("client_area_error", error.digest ?? error.name);
  }, [error]);
  return (
    <div role="alert" className="flex flex-col items-start gap-4 rounded-[var(--radius-card)] border border-line bg-surface/50 p-8">
      <h2 className="text-xl font-semibold">Не вдалося завантажити дані</h2>
      <p className="max-w-xl text-muted">
        Це тимчасова помилка на нашому боці або проблема зі зʼєднанням. Ваші дані не змінено. Спробуйте ще раз; якщо помилка повторюється, напишіть нам.
        {error.digest ? <span className="mt-2 block font-mono text-xs">Код: {error.digest}</span> : null}
      </p>
      <Button type="button" onClick={reset}>
        Спробувати ще раз
      </Button>
    </div>
  );
}
