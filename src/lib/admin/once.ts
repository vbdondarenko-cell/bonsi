import "server-only";
import { isRedirectError } from "next/dist/client/components/redirect-error";
import type { ActionState } from "@/app/admin/actions";
import { createSupabaseServerClient } from "@/lib/supabase/server";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
/** Має збігатися з OPERATION_FIELD у `src/lib/forms/use-guarded-action.ts`. */
const OPERATION_FIELD = "_op";

type AdminAction = (prev: ActionState, formData: FormData) => Promise<ActionState>;

/**
 * Захист від повторного виконання адмінської дії (подвійний клік, Enter, повтор запиту).
 * Форма надсилає ідентифікатор спроби; перший запит «захоплює» його в БД (`admin_claim_operation`), наступні з тим самим
 * ідентифікатором не виконуються й отримують повідомлення про вже виконану дію. Невдала дія звільняє ідентифікатор.
 * Без ідентифікатора (старі клієнти) дія виконується як раніше. Авторизацію й валідацію виконує сама дія.
 */
export function once<T extends AdminAction>(name: string, action: T): T {
  const wrapped: AdminAction = async (prev, formData) => {
    const raw = formData.get(OPERATION_FIELD);
    const op = typeof raw === "string" && UUID.test(raw) ? raw : null;
    if (!op) return action(prev, formData);

    let supabase;
    try {
      supabase = await createSupabaseServerClient();
    } catch {
      return action(prev, formData);
    }
    const claim = await supabase.rpc("admin_claim_operation", { p_op: op, p_action: name });
    if (claim.error) return action(prev, formData); // не адміністратор: власну відмову поверне сама дія
    if (claim.data === false) return { ok: true, notice: "Цю дію вже виконано — повторно вона не виконувалась." };

    const release = async () => {
      await supabase.rpc("admin_release_operation", { p_op: op });
    };
    try {
      const result = await action(prev, formData);
      if (result && (result.error || result.fieldError)) await release();
      return result;
    } catch (error) {
      if (!isRedirectError(error)) await release(); // успішний redirect — це завершена дія
      throw error;
    }
  };
  return wrapped as T;
}
