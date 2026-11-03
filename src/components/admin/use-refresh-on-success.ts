"use client";

import { useRouter } from "next/navigation";
import { useEffect } from "react";

/**
 * Після успішної server action примусово перечитує поточний маршрут.
 * Відповідь дії вже містить оновлене дерево (revalidatePath), але у Firefox/WebKit його застосування інколи губиться
 * (база змінена, а історія на сторінці стара). router.refresh() ідемпотентний і гарантує, що екран відображає стан БД.
 */
export function useRefreshOnSuccess(state: { ok?: boolean } | null | undefined) {
  const router = useRouter();
  useEffect(() => {
    if (state?.ok) router.refresh();
  }, [state, router]);
}
