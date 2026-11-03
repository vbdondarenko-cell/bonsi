import type { SupabaseClient } from "@supabase/supabase-js";
import { describe, expect, it, vi } from "vitest";
import { OPERATION_FIELD, OPERATION_RETRY_TEXT, operationErrorText, rpcOnce } from "./operations";

const OP = "123e4567-e89b-42d3-a456-426614174000";
const form = (op?: string) => {
  const f = new FormData();
  if (op !== undefined) f.set(OPERATION_FIELD, op);
  return f;
};
const client = (rpc: (...args: unknown[]) => unknown) => ({ rpc: vi.fn(rpc) }) as unknown as SupabaseClient & { rpc: ReturnType<typeof vi.fn> };

describe("rpcOnce: fail-closed (бізнес-функція не викликається без підтвердженого захисту)", () => {
  it("відсутній ідентифікатор операції", async () => {
    const supabase = client(async () => ({ data: null, error: null }));
    for (const f of [form(), form("")]) {
      const r = await rpcOnce(supabase, f, "admin_create_invoice", {});
      expect(r.error?.message).toBe("operation_id_missing");
      expect(r.data).toBeNull();
    }
    expect(supabase.rpc).not.toHaveBeenCalled();
  });

  it("некоректний UUID", async () => {
    const supabase = client(async () => ({ data: null, error: null }));
    for (const bad of ["abc", "123e4567-e89b-42d3-a456-42661417400", "123e4567-e89b-42d3-a456-4266141740000", "'; drop table x; --"]) {
      expect((await rpcOnce(supabase, form(bad), "admin_create_invoice", {})).error?.message).toBe("operation_id_invalid");
    }
    expect(supabase.rpc).not.toHaveBeenCalled();
  });

  it("Supabase недоступний (виняток) і мережеві помилки", async () => {
    const down = client(async () => {
      throw new Error("fetch failed");
    });
    expect((await rpcOnce(down, form(OP), "admin_create_invoice", {})).error?.message).toBe("operations_unavailable");
    for (const message of ["fetch failed", "connect ECONNREFUSED 127.0.0.1", "network error", "request timeout"]) {
      const supabase = client(async () => ({ data: null, error: { message } }));
      expect((await rpcOnce(supabase, form(OP), "admin_create_invoice", {})).error?.message).toBe("operations_unavailable");
    }
  });

  it("міграція не застосована (функції run_operation немає)", async () => {
    for (const error of [{ code: "PGRST202", message: "Could not find the function public.run_operation(p_args, p_fn, p_op) in the schema cache" }, { code: "42883", message: "function public.run_operation does not exist" }]) {
      const supabase = client(async () => ({ data: null, error }));
      const r = await rpcOnce(supabase, form(OP), "admin_create_invoice", {});
      expect(r.error?.message).toBe("operations_unavailable");
      expect(operationErrorText(r.error!)).toBe(OPERATION_RETRY_TEXT);
    }
  });

  it("незрозуміла відповідь не вважається успіхом", async () => {
    for (const data of [null, "ok", { result: 1 }, { replayed: "yes" }]) {
      const supabase = client(async () => ({ data, error: null }));
      expect((await rpcOnce(supabase, form(OP), "admin_create_invoice", {})).error?.message).toBe("operations_unavailable");
    }
  });
});

describe("rpcOnce: нормальні відповіді", () => {
  it("передає ідентифікатор, функцію й аргументи; повертає результат і прапорець повтору", async () => {
    const supabase = client(async () => ({ data: { replayed: false, result: "task-1" }, error: null }));
    const r = await rpcOnce(supabase, form(OP), "admin_create_task", { p_title: "x" });
    expect(r).toEqual({ data: "task-1", error: null, replayed: false });
    expect(supabase.rpc).toHaveBeenCalledWith("run_operation", { p_op: OP, p_fn: "admin_create_task", p_args: { p_title: "x" } });
    const again = await rpcOnce(client(async () => ({ data: { replayed: true, result: "task-1" }, error: null })), form(OP), "admin_create_task", {});
    expect(again).toEqual({ data: "task-1", error: null, replayed: true });
  });

  it("бізнес-помилки проходять без змін, помилки захисту отримують зрозумілий текст", async () => {
    const business = client(async () => ({ data: null, error: { message: "not_pending" } }));
    expect((await rpcOnce(business, form(OP), "admin_confirm_payment", {})).error?.message).toBe("not_pending");
    expect(operationErrorText({ message: "not_pending" })).toBeNull();
    expect(operationErrorText({ message: "operation_conflict" })).toMatch(/уже використано/);
    expect(operationErrorText({ message: "operation_id_missing" })).toMatch(/Оновіть сторінку/);
    expect(operationErrorText({ message: "operation_not_allowed" })).toMatch(/внутрішню помилку/);
  });
});
