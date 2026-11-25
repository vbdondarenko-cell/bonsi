import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Loaded } from "@/lib/admin/analytics";

export type FinanceEntry = {
  id: string;
  entry_date: string;
  kind: "income" | "expense";
  category: string;
  title: string;
  amount: number;
  client: string | null;
  note: string | null;
  created_at: string;
};

export type Finance = {
  month: string;
  totals: { income: number; expense: number };
  by_category: { kind: "income" | "expense"; category: string; total: number; n: number }[];
  entries: FinanceEntry[];
  history: { month: string; income: number; expense: number }[];
};

/** 42P01/42883/PGRST202: таблиці чи функції ще немає — міграцію не застосовано. */
function classify(error: { code?: string; message?: string }): "not_ready" | "failed" {
  const code = error.code ?? "";
  const message = error.message ?? "";
  if (code === "42883" || code === "42P01" || code === "PGRST202" || /could not find the function|does not exist/i.test(message)) {
    return "not_ready";
  }
  return "failed";
}

export async function loadFinance(supabase: SupabaseClient, month: string): Promise<Loaded<Finance>> {
  const { data, error } = await supabase.rpc("admin_finance", { p_month: month });
  if (error || !data) return { ok: false, reason: error ? classify(error) : "failed" };
  return { ok: true, data: data as Finance };
}
