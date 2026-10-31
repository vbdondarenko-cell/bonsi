import { describe, expect, it } from "vitest";
import { orderSchema } from "./schema";

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

  it("відхиляє занадто короткий опис ідеї", () => {
    const result = orderSchema.safeParse({ ...valid, idea: "Сайт" });
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.flatten().fieldErrors.idea).toBeDefined();
    }
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
