import type { SupabaseClient } from "@supabase/supabase-js";

/** Ім'я прихованого поля форми з ідентифікатором спроби. Має збігатися з OPERATION_FIELD у `src/lib/forms/use-guarded-action.ts`. */
export const OPERATION_FIELD = "_op";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Текст помилки, після якої повтор МАЄ використати той самий ідентифікатор спроби: невідомо, чи дія встигла виконатися
 * (мережевий збій, таймаут, недоступність сервісу). Клієнтський хук за цим текстом не змінює ідентифікатор.
 */
export const OPERATION_RETRY_TEXT = "Немає підтвердження виконання. Натисніть кнопку ще раз: дію не буде виконано двічі.";

export type OnceResult = { data: unknown; error: { message: string } | null; replayed: boolean };

/** Коди, за якими дію зупинено, ще до виконання бізнес-зміни (fail-closed). */
const FAIL_CLOSED = {
  missing: "operation_id_missing",
  invalid: "operation_id_invalid",
  unavailable: "operations_unavailable",
} as const;

/**
 * Виконує неідемпотентний RPC рівно один раз для ідентифікатора спроби (`_op` з форми) через `public.run_operation`:
 * захоплення ідентифікатора, бізнес-функція й збереження результату — в одній транзакції PostgreSQL.
 *
 * Fail-closed: якщо ідентифікатор відсутній чи некоректний, міграція `run_operation` не застосована або Supabase недоступний,
 * бізнес-функція НЕ викликається, а повертається помилка. Дія ніколи не обходить захист.
 */
export async function rpcOnce(supabase: SupabaseClient, formData: FormData, fn: string, args: Record<string, unknown>): Promise<OnceResult> {
  const raw = formData.get(OPERATION_FIELD);
  if (raw === null || raw === "") return { data: null, error: { message: FAIL_CLOSED.missing }, replayed: false };
  if (typeof raw !== "string" || !UUID.test(raw)) return { data: null, error: { message: FAIL_CLOSED.invalid }, replayed: false };

  let response: { data: unknown; error: { message: string; code?: string } | null };
  try {
    response = (await supabase.rpc("run_operation", { p_op: raw, p_fn: fn, p_args: args })) as typeof response;
  } catch {
    return { data: null, error: { message: FAIL_CLOSED.unavailable }, replayed: false };
  }
  if (response.error) {
    const { message, code } = response.error;
    // PGRST202 / 42883 — функції немає (міграція не застосована); мережеві збої PostgREST теж не дають права виконувати дію без захисту.
    if (code === "PGRST202" || code === "42883" || /could not find the function|run_operation/i.test(message) || /fetch failed|network|ECONN|timeout/i.test(message)) {
      return { data: null, error: { message: FAIL_CLOSED.unavailable }, replayed: false };
    }
    return { data: null, error: { message }, replayed: false };
  }
  const payload = response.data as { replayed?: boolean; result?: unknown } | null;
  if (!payload || typeof payload !== "object" || typeof payload.replayed !== "boolean") {
    return { data: null, error: { message: FAIL_CLOSED.unavailable }, replayed: false }; // відповідь незрозуміла: успіх не повідомляємо
  }
  return { data: payload.result ?? null, error: null, replayed: payload.replayed };
}

/** Зрозумілий текст для помилок захисту від повторів; `null` — це не помилка захисту. */
export function operationErrorText(error: { message: string }): string | null {
  const m = error.message;
  if (m.includes(FAIL_CLOSED.missing) || m.includes("operation_id_required")) return "Не вдалося підтвердити унікальність дії. Оновіть сторінку й повторіть.";
  if (m.includes(FAIL_CLOSED.invalid)) return "Некоректний ідентифікатор дії. Оновіть сторінку й повторіть.";
  if (m.includes(FAIL_CLOSED.unavailable)) return OPERATION_RETRY_TEXT;
  if (m.includes("operation_conflict")) return "Цей запит уже використано для іншої дії. Оновіть сторінку й повторіть.";
  if (m.includes("operation_not_allowed") || m.includes("operation_args_invalid") || m.includes("operation_state_unknown")) return "Дію не виконано через внутрішню помилку. Повідомте адміністратора.";
  return null;
}
