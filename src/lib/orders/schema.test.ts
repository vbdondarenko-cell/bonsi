import { describe, expect, it } from "vitest";
import { checkedOrderSchema, orderSchema } from "./schema";

const valid = {
  service: "webapp",
  idea: "Потрібна платформа з кабінетом клієнта та адмін-панеллю.",
  budget: "50-150k",
  deadline: "1-3-months",
  name: "Олена",
  email: "Olena@Example.com",
  phone: "+380 50 123 45 67",
  consent: true,
  startedAt: 1_700_000_000_000,
};

describe("orderSchema", () => {
  it("приймає коректну заявку й нормалізує email", () => {
    const result = orderSchema.safeParse(valid);
    expect(result.success).toBe(true);
    if (result.success) expect(result.data.email).toBe("olena@example.com");
  });

  it("дозволяє порожній телефон", () => {
    expect(orderSchema.safeParse({ ...valid, phone: undefined }).success).toBe(true);
    expect(orderSchema.safeParse({ ...valid, phone: "" }).success).toBe(true);
  });

  it("приймає короткий опис, а також заявку взагалі без опису, бюджету й термінів", () => {
    expect(orderSchema.safeParse({ ...valid, idea: "Сайт" }).success).toBe(true);
    const minimal = { service: "landing", name: "Іван", email: "ivan@example.com", consent: true, startedAt: 1 };
    expect(orderSchema.safeParse(minimal).success).toBe(true);
  });

  it("відхиляє опис довший за 3000 символів", () => {
    expect(orderSchema.safeParse({ ...valid, idea: "а".repeat(3001) }).success).toBe(false);
  });

  it("відхиляє невідомий тип послуги, бюджет і терміни", () => {
    expect(orderSchema.safeParse({ ...valid, service: "hack" }).success).toBe(false);
    expect(orderSchema.safeParse({ ...valid, budget: "free" }).success).toBe(false);
    expect(orderSchema.safeParse({ ...valid, deadline: "yesterday" }).success).toBe(false);
  });

  it("відхиляє некоректний email і телефон із літерами", () => {
    expect(orderSchema.safeParse({ ...valid, email: "not-an-email" }).success).toBe(false);
    expect(orderSchema.safeParse({ ...valid, phone: "call me" }).success).toBe(false);
  });

  it("вимагає згоду на обробку даних", () => {
    expect(orderSchema.safeParse({ ...valid, consent: false }).success).toBe(false);
    expect(orderSchema.safeParse({ ...valid, consent: undefined }).success).toBe(false);
  });
});

describe("checkedOrderSchema: уточнення за послугою й посилання", () => {
  const base = { service: "landing", name: "Іван", email: "ivan@example.com", consent: true, startedAt: 1 };

  it("приймає уточнення, що належать обраній послузі", () => {
    expect(checkedOrderSchema.safeParse({ ...base, details: { goal: "leads", content: "ready" } }).success).toBe(true);
  });

  it("відхиляє уточнення іншої послуги, невідомі відповіді й підроблені ключі", () => {
    expect(checkedOrderSchema.safeParse({ ...base, details: { platform: "ios" } }).success).toBe(false);
    expect(checkedOrderSchema.safeParse({ ...base, details: { goal: "world-domination" } }).success).toBe(false);
    expect(checkedOrderSchema.safeParse({ ...base, details: { __proto__: "x", constructor: "y" } }).success).toBe(false);
  });

  it("приймає до 5 http(s)-посилань і відхиляє решту", () => {
    const ok = Array.from({ length: 5 }, (_, i) => `https://example.com/ref/${i}`);
    expect(checkedOrderSchema.safeParse({ ...base, links: ok }).success).toBe(true);
    expect(checkedOrderSchema.safeParse({ ...base, links: [...ok, "https://example.com/6"] }).success).toBe(false);
    expect(checkedOrderSchema.safeParse({ ...base, links: ["javascript:alert(1)"] }).success).toBe(false);
    expect(checkedOrderSchema.safeParse({ ...base, links: ["ftp://example.com/file"] }).success).toBe(false);
    expect(checkedOrderSchema.safeParse({ ...base, links: ["не посилання"] }).success).toBe(false);
  });
});
