/**
 * Публічний (anon / publishable) ключ — єдиний, який використовує сесія адміністратора.
 * Він працює лише в межах RLS. Ключ service_role сюди не потрапляє ніколи.
 */
export function getSupabaseAuthEnv(): { url: string; anonKey: string } | null {
  const url = process.env.SUPABASE_URL;
  const anonKey = process.env.SUPABASE_ANON_KEY;
  if (!url || !anonKey) return null;
  return { url, anonKey };
}
