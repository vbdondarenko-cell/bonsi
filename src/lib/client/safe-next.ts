/** Дозволяє лише внутрішні шляхи кабінету: ніяких зовнішніх адрес, схем, `//host` і зворотних слешів (open redirect). */
export function safeNext(value: string | null | undefined, fallback = "/app"): string {
  if (!value || !value.startsWith("/app")) return fallback;
  if (value.startsWith("//") || value.includes("\\") || /[\u0000-\u001f]/.test(value)) return fallback;
  if (value !== "/app" && !value.startsWith("/app/") && !value.startsWith("/app?")) return fallback;
  return value;
}
