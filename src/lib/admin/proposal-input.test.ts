import { describe, expect, it } from "vitest";
import { buildSchedule, parseCustomSchedule, parseFeatures, validateSchedule } from "./proposal-input";

describe("parseFeatures", () => {
  it("прибирає маркери, порожні рядки й дублікати", () => {
    expect(parseFeatures("- Каталог\n\n• Оплата\nкаталог\n  Кабінет  ")).toEqual(["Каталог", "Оплата", "Кабінет"]);
  });
  it("обмежує довжину пункту і їх кількість", () => {
    expect(parseFeatures("а".repeat(500))[0]).toHaveLength(200);
    expect(parseFeatures(Array.from({ length: 100 }, (_, i) => `п${i}`).join("\n"))).toHaveLength(60);
  });
});

describe("графік платежів", () => {
  it("розбирає індивідуальний графік", () => {
    expect(parseCustomSchedule("Аванс | 20\nДизайн | 30,5%\nЗдача | 49.5")).toEqual([
      { label: "Аванс", percent: 20 },
      { label: "Дизайн", percent: 30.5 },
      { label: "Здача", percent: 49.5 },
    ]);
  });
  it("відхиляє некоректні рядки", () => {
    expect(parseCustomSchedule("Аванс 20")).toBeNull();
    expect(parseCustomSchedule("Аванс | abc")).toBeNull();
    expect(parseCustomSchedule("Аванс | -5")).toBeNull();
    expect(parseCustomSchedule("Аванс | 101")).toBeNull();
    expect(parseCustomSchedule("")).toBeNull();
  });
  it("пресети 30/40/30 і 50/50 валідні, довільний — лише при сумі 100", () => {
    expect(validateSchedule(buildSchedule("30-40-30", ""))).toBeNull();
    expect(validateSchedule(buildSchedule("50-50", ""))).toBeNull();
    expect(validateSchedule(buildSchedule("custom", "А | 60\nБ | 30"))).toMatch(/100/);
    expect(validateSchedule(buildSchedule("custom", "А | 60\nБ | 40"))).toBeNull();
    expect(validateSchedule(buildSchedule("unknown", ""))).toMatch(/формат/);
  });
});
