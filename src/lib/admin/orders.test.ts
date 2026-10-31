import { describe, expect, it } from "vitest";
import {
  PAGE_SIZE,
  assignInput,
  filtersToQuery,
  noteInput,
  parseOrderFilters,
  statusInput,
  toSearchArgs,
} from "./orders";

const ID = "0b0b0b0b-0b0b-4b0b-8b0b-0b0b0b0b0b0b";

describe("parseOrderFilters", () => {
  it("повертає значення за замовчуванням", () => {
    expect(parseOrderFilters({})).toEqual({ page: 1 });
  });

  it("приймає коректні фільтри", () => {
    expect(
      parseOrderFilters({ q: "  BON-2026  ", status: "new", service: "shop", from: "2026-10-01", to: "2026-10-31", page: "3" }),
    ).toEqual({ q: "BON-2026", status: "new", service: "shop", from: "2026-10-01", to: "2026-10-31", page: 3 });
  });

  it("відкидає некоректні значення замість помилки", () => {
    expect(
      parseOrderFilters({ status: "hacked", service: "x", from: "31.10.2026", to: "2026-13-45", page: "-5" }),
    ).toEqual({ page: 1 });
    expect(parseOrderFilters({ page: "abc" })).toEqual({ page: 1 });
    expect(parseOrderFilters({ q: "x".repeat(101) })).toEqual({ page: 1 });
  });

  it("бере перше значення, якщо параметр повторюється", () => {
    expect(parseOrderFilters({ status: ["done", "new"] }).status).toBe("done");
  });
});

describe("toSearchArgs / filtersToQuery", () => {
  it("рахує зсув пагінації й включно «до» дати", () => {
    const args = toSearchArgs({ page: 3, from: "2026-10-01", to: "2026-10-31" });
    expect(args.p_limit).toBe(PAGE_SIZE);
    expect(args.p_offset).toBe(2 * PAGE_SIZE);
    expect(args.p_from).toBe("2026-10-01T00:00:00Z");
    expect(args.p_to).toBe("2026-11-01T00:00:00.000Z");
  });

  it("серіалізує фільтри в query без значень за замовчуванням", () => {
    expect(filtersToQuery({ page: 1 })).toBe("");
    expect(filtersToQuery({ q: "а&б", status: "new", page: 2 })).toBe("?q=%D0%B0%26%D0%B1&status=new&page=2");
    expect(filtersToQuery({ status: "new", page: 5 }, { page: 1 })).toBe("?status=new");
  });
});

describe("схеми дій", () => {
  it("статус: лише відомі значення й UUID", () => {
    expect(statusInput.safeParse({ orderId: ID, status: "done" }).success).toBe(true);
    expect(statusInput.safeParse({ orderId: ID, status: "drop" }).success).toBe(false);
    expect(statusInput.safeParse({ orderId: "1 or 1=1", status: "done" }).success).toBe(false);
  });

  it("призначення: порожнє значення означає зняття виконавця", () => {
    expect(assignInput.parse({ orderId: ID, assignee: "" }).assignee).toBeNull();
    expect(assignInput.parse({ orderId: ID, assignee: ID }).assignee).toBe(ID);
    expect(assignInput.safeParse({ orderId: ID, assignee: "x" }).success).toBe(false);
  });

  it("нотатка: тримінг і межі", () => {
    expect(noteInput.parse({ orderId: ID, body: "  ok  " }).body).toBe("ok");
    expect(noteInput.safeParse({ orderId: ID, body: "   " }).success).toBe(false);
    expect(noteInput.safeParse({ orderId: ID, body: "x".repeat(4001) }).success).toBe(false);
  });
});
