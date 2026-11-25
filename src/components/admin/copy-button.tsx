"use client";

import { useState } from "react";

/** Копіює значення в буфер обміну й на мить підтверджує це. */
export function CopyButton({ value, label }: { value: string; label: string }) {
  const [copied, setCopied] = useState(false);

  return (
    <button
      type="button"
      onClick={async () => {
        try {
          await navigator.clipboard.writeText(value);
          setCopied(true);
          window.setTimeout(() => setCopied(false), 1600);
        } catch {
          // Буфер недоступний (не HTTPS чи заборонено): людина може виділити адресу вручну.
        }
      }}
      className="shrink-0 rounded-full border border-line px-3 py-1 text-xs text-muted transition-colors hover:text-fg"
      aria-label={`Скопіювати: ${label}`}
    >
      {copied ? "Скопійовано" : "Копіювати"}
    </button>
  );
}
