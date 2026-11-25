"use client";

import { useEffect } from "react";
import { hasIgnoreCookie, ignoreCookieString } from "@/lib/analytics/ignore";

/**
 * Будь-яке відкриття адмінки на пристрої робить його «своїм»: його заходи на сайт не потраплять у статистику.
 * Один раз відкрийте адмінку на телефоні й на комп'ютері, і далі нічого робити не треба.
 */
export function MarkDevice() {
  useEffect(() => {
    if (!hasIgnoreCookie(document.cookie)) document.cookie = ignoreCookieString(true);
  }, []);
  return null;
}
