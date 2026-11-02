import { describe, expect, it } from "vitest";
import { SCHEDULE_PRESETS, formatMoney, scheduleAmounts, scheduleTotal, stageProgress } from "./labels";

describe("stageProgress", () => {
  it("рахує лише завершені етапи", () => {
    const rows = ["brief", "proposal", "agreement", "design", "development", "qa", "delivery", "support"].map((stage, i) => ({
      stage,
      position: i + 1,
      state: i < 2 ? "done" : i === 2 ? "in_progress" : "pending",
    }));
    expect(stageProgress(rows)).toEqual({ done: 2, total: 8, current: "agreement" });
  });
  it("не вигадує прогрес без даних", () => {
    expect(stageProgress([])).toEqual({ done: 0, total: 8, current: null });
  });
});

describe("графік платежів", () => {
  it("пресети дають рівно 100%", () => {
    for (const preset of Object.values(SCHEDULE_PRESETS)) expect(scheduleTotal(preset)).toBe(100);
  });
  it("суми збігаються з ціною до копійки (залишок йде в останній платіж)", () => {
    const parts = scheduleAmounts(100000.01, SCHEDULE_PRESETS["30-40-30"]!);
    expect(parts.map((p) => p.amount)).toEqual([30000, 40000, 30000.01]);
    expect(Math.round(parts.reduce((s, p) => s + p.amount, 0) * 100)).toBe(10000001);
  });
  it("50/50 ділить порівну", () => {
    expect(scheduleAmounts(90000, SCHEDULE_PRESETS["50-50"]!).map((p) => p.amount)).toEqual([45000, 45000]);
  });
});

describe("formatMoney", () => {
  it("додає символ валюти", () => {
    expect(formatMoney(120000, "UAH")).toMatch(/₴$/);
    expect(formatMoney("99.5", "USD")).toMatch(/\$$/);
  });
});
