import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { createSupabaseServiceClient } from "@/lib/supabase/service";

/**
 * Розділення входів: співробітники студії заходять лише через /admin (пароль + MFA), клієнти — лише через сайт (/login, код на пошту).
 * Тому клієнтський вхід не надсилає коду на адреси адміністраторів і запрошених адміністраторів, а сесія, що виявилась
 * адміністраторською, одразу закривається. Рішення приймає сервер; відповіді для користувача не розкривають причину.
 */
export async function isStaffEmail(email: string): Promise<boolean> {
  const service = createSupabaseServiceClient();
  const [admin, invite] = await Promise.all([
    service.from("admin_users").select("user_id").eq("email", email).maybeSingle(),
    service.rpc("admin_invite_exists", { p_email: email }),
  ]);
  if (admin.error || invite.error) throw new Error("staff_check_failed"); // не вгадуємо: краще відмовити, ніж пустити
  return Boolean(admin.data) || invite.data === true;
}

/** Чи належить поточна сесія адміністратору (allowlist). */
export async function sessionIsStaff(supabase: SupabaseClient): Promise<boolean> {
  const { data, error } = await supabase.rpc("admin_is_allowlisted");
  if (error) throw new Error("staff_check_failed");
  return data === true;
}
