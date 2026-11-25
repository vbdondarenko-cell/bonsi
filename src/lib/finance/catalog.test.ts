import { describe, expect, it } from "vitest";
import {
  INCOME_ITEMS,
  financeInput,
  formatSigned,
  monthLabel,
  parseAmount,
  resolveMonth,
  shiftMonth,
} from "./catalog";

describe("INCOME_ITEMS", () => {
  it("містить усі послуги з прайсу й три пакети підтримки", () => {
    const labels = INCOME_ITEMS.map((item) => item.label);
    expect(labels).toContain("Landing Page");
    expect(labels).toContain("Telegram-бот");
    expect(INCOME_ITEMS.filter((item) => item.group === "Підтримка")).toHaveLength(3);
    // «Технічна підтримка» замінена трьома пакетами, дубля немає
    expect(labels).not.toContain("Технічна підтримка");
  });
  it("ціни збігаються з прайсом", () => {
    expect(INCOME_ITEMS.find((item) => item.id === "landing")?.price).toBe(3000);
    expect(INCOME_ITEMS.find((item) => item.id === "support-business")?.price).toBe(2000);
    expect(INCOME_ITEMS.find((item) => item.id === "design")?.price).toBeNull();
  });
});

describe("parseAmount", () => {
  it("приймає кому, крапку та пробіли", () => {
    expect(parseAmount("3 000")).toBe(3000);
    expect(parseAmount("1250,50")).toBe(1250.5);
    expect(parseAmount("12.5")).toBe(12.5);
  });
  it("відхиляє нуль, мінус, літери й зайві знаки", () => {
    expect(parseAmount("0")).toBeNull();
    expect(parseAmount("-5")).toBeNull();
    expect(parseAmount("abc")).toBeNull();
    expect(parseAmount("1,234")).toBeNull();
    expect(parseAmount("")).toBeNull();
  });
});

describe("financeInput", () => {
  const valid = { kind: "expense", date: "2026-11-25", category: "Реклама", title: "Instagram", amount: "1 500", client: "", note: "" };
  it("перетворює суму на число", () => {
    const parsed = financeInput.safeParse(valid);
    expect(parsed.success && parsed.data.amount).toBe(1500);
  });
  it("відхиляє неіснуючу дату й некоректну суму", () => {
    expect(financeInput.safeParse({ ...valid, date: "2026-02-31" }).success).toBe(false);
    expect(financeInput.safeParse({ ...valid, amount: "0" }).success).toBe(false);
    expect(financeInput.safeParse({ ...valid, kind: "other" }).success).toBe(false);
  });
});

describe("місяці та формат", () => {
  it("resolveMonth бере параметр або поточний місяць за Києвом", () => {
    expect(resolveMonth("2026-03")).toBe("2026-03-01");
    expect(resolveMonth("bad", new Date("2026-11-25T10:00:00Z"))).toBe("2026-11-01");
    // 31 грудня 23:30 UTC вже 1 січня за Києвом
    expect(resolveMonth(undefined, new Date("2026-12-31T23:30:00Z"))).toBe("2027-01-01");
  });
  it("shiftMonth переходить через межу року", () => {
    expect(shiftMonth("2026-01-01", -1)).toBe("2025-12-01");
    expect(shiftMonth("2026-12-01", 1)).toBe("2027-01-01");
  });
  it("monthLabel українською з великої літери", () => {
    expect(monthLabel("2026-11-01")).toMatch(/^Листопад/);
  });
  it("formatSigned показує знак", () => {
    expect(formatSigned(1000)).toMatch(/^\+/);
    expect(formatSigned(-1000)).toMatch(/^−/);
    expect(formatSigned(0)).not.toMatch(/^[+−]/);
  });
});
