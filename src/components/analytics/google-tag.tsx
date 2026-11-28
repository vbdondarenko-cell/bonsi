"use client";

import { usePathname } from "next/navigation";
import Script from "next/script";
import { useEffect, useState } from "react";
import { isTrackingDisabled } from "@/lib/analytics/client";
import { GOOGLE_ADS_ID, GOOGLE_TAG_ID } from "@/lib/analytics/google";

/**
 * Теги Google (Ads + тег GTM + за потреби GA4). Вантажаться лише для звичайних відвідувачів:
 * не в адмінці, не на «своїх» пристроях (cookie bonsi_ignore) і не при Do Not Track / Global Privacy Control.
 * Інакше наші власні заходи й тести спотворювали б дані реклами.
 */
export function GoogleTag({ gaId }: { gaId?: string }) {
  const pathname = usePathname();
  const [enabled, setEnabled] = useState(false);

  useEffect(() => {
    if (pathname.startsWith("/admin")) return;
    if (!isTrackingDisabled()) setEnabled(true);
  }, [pathname]);

  if (!enabled) return null;

  const ids = [GOOGLE_ADS_ID, GOOGLE_TAG_ID, ...(gaId ? [gaId] : [])];
  const init =
    "window.dataLayer=window.dataLayer||[];function gtag(){dataLayer.push(arguments);}gtag('js',new Date());" +
    ids.map((id) => `gtag('config','${id}');`).join("");

  return (
    <>
      <Script src={`https://www.googletagmanager.com/gtag/js?id=${GOOGLE_TAG_ID}`} strategy="afterInteractive" />
      <Script id="google-tag-init" strategy="afterInteractive">
        {init}
      </Script>
    </>
  );
}
