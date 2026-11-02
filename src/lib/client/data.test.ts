import { describe, expect, it, vi } from "vitest";
import { DataError, getInvoicesWithPayments, getMessages, listProjects, read, unreadByProject } from "./data";

vi.mock("server-only", () => ({}));

type Result = { data: unknown; error: { message: string; code?: string; status?: number } | null };

/** Мінімальний chainable-мок PostgREST: кожен виклик у ланцюжку повертає той самий об'єкт, await віддає результат. */
function chain(results: Result[]) {
  let call = 0;
  const calls: Array<[string, unknown[]]> = [];
  const next = () => results[Math.min(call++, results.length - 1)];
  const proxy: unknown = new Proxy(
    {},
    {
      get(_t, prop: string) {
        if (prop === "then") return (resolve: (v: Result) => void) => resolve(next());
        return (...args: unknown[]) => {
          calls.push([prop, args]);
          return proxy;
        };
      },
    },
  );
  return { client: { from: () => proxy, rpc: () => proxy } as never, calls, count: () => call };
}

describe("читання даних клієнта: помилки не маскуються", () => {
  it("помилка БД кидає DataError, а не повертає порожній список", async () => {
    const { client } = chain([{ data: null, error: { message: "permission denied", code: "42501" } }]);
    await expect(listProjects(client)).rejects.toBeInstanceOf(DataError);
  });

  it("тимчасова помилка повторюється один раз і далі віддає реальні дані", async () => {
    const { client, count } = chain([
      { data: null, error: { message: "fetch failed" } },
      { data: [{ id: "p1" }], error: null },
    ]);
    await expect(listProjects(client)).resolves.toEqual([{ id: "p1" }]);
    expect(count()).toBe(2);
  });

  it("постійна тимчасова помилка після повтору → DataError(retryable)", async () => {
    const { client, count } = chain([{ data: null, error: { message: "boom", status: 503 } }]);
    const error = await listProjects(client).catch((e) => e);
    expect(error).toBeInstanceOf(DataError);
    expect(error.retryable).toBe(true);
    expect(count()).toBe(2);
  });

  it("логічна помилка (RLS/синтаксис) не повторюється", async () => {
    const { client, count } = chain([{ data: null, error: { message: "new row violates", code: "42501" } }]);
    await expect(listProjects(client)).rejects.toMatchObject({ retryable: false });
    expect(count()).toBe(1);
  });

  it("виняток fetch (мережа) також стає DataError", async () => {
    await expect(read("x", () => Promise.reject(new TypeError("fetch failed")))).rejects.toBeInstanceOf(DataError);
  });

  it("лічильник непрочитаних: помилка RPC не перетворюється на «0 непрочитаних»", async () => {
    const { client } = chain([{ data: null, error: { message: "down", status: 500 } }]);
    await expect(unreadByProject(client, ["a"])).rejects.toBeInstanceOf(DataError);
  });

  it("рахунки: помилка стану оплати не перетворюється на «не сплачено»", async () => {
    // invoices ok, payments ok, states fail
    const { client } = chain([
      { data: [{ id: "i1" }], error: null },
      { data: [], error: null },
      { data: null, error: { message: "down", code: "XX000" } },
    ]);
    await expect(getInvoicesWithPayments(client, "p")).rejects.toBeInstanceOf(DataError);
  });

  it("рахунок без стану в БД — помилка даних, а не «не сплачено»", async () => {
    const { client } = chain([
      { data: [{ id: "i1" }], error: null },
      { data: [], error: null },
      { data: [], error: null },
    ]);
    await expect(getInvoicesWithPayments(client, "p")).rejects.toBeInstanceOf(DataError);
  });

  it("повідомлення: остання сторінка розвертається за зростанням і повідомляє, чи є старіші", async () => {
    const rows = [{ id: 5 }, { id: 4 }, { id: 3 }];
    const { client } = chain([{ data: rows, error: null }]);
    const page = await getMessages(client, "p", { limit: 2 });
    expect(page.messages.map((m) => m.id)).toEqual([4, 5]);
    expect(page.hasMore).toBe(true);
  });
});
