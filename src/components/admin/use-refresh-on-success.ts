"use client";

import { useRouter } from "next/navigation";
import { useEffect } from "react";

/** Best-effort route refresh for forms without a returned view model.
 * This is not an acknowledgement that the UI has applied the committed data.
 * Order forms instead apply their server-confirmed snapshot inside the action.
 */
export function useRefreshOnSuccess(state: { ok?: boolean } | null | undefined) {
  const router = useRouter();
  useEffect(() => {
    if (state?.ok) router.refresh();
  }, [state, router]);
}
