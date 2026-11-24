import { describe, expect, it } from "vitest";
import { buildSummary, buildTelegramLink } from "./summary";

describe("buildSummary", () => {
  it("показує послугу, відповіді, терміни, задачу й посилання без жодних цін", () => {
    const lines = buildSummary({
      service: "support",
      details: { plan: "standard", product: "site" },
      deadline: "asap",
      idea: " Потрібен супровід ",
      links: ["https://example.com"],
    });
    expect(lines.map((line) => line.label)).toEqual(["Послуга", "Пакет підтримки", "Що потрібно підтримувати", "Терміни", "Задача", "Приклади"]);
    expect(lines.some((line) => /₴|грн/i.test(line.value))).toBe(false);
    expect(lines.find((line) => line.label === "Задача")?.value).toBe("Потрібен супровід");
  });

  it("ігнорує невідомі відповіді", () => {
    const lines = buildSummary({ service: "landing", details: { goal: "nope" } });
    expect(lines).toHaveLength(1);
  });
});

describe("buildTelegramLink", () => {
  it("веде на @bonsi_studio й містить номер звернення в text", () => {
    const link = buildTelegramLink("BON-2026-00042", "Іван", buildSummary({ service: "landing" }));
    const url = new URL(link);
    expect(url.origin + url.pathname).toBe("https://t.me/bonsi_studio");
    const text = url.searchParams.get("text") ?? "";
    expect(text).toContain("BON-2026-00042");
    expect(text).toContain("Іван");
    expect(text).toContain("Landing Page");
  });

  it("обрізає надто довгий опис", () => {
    const lines = buildSummary({ service: "landing", idea: "а".repeat(3000) });
    const text = new URL(buildTelegramLink("BON-1", "Іван", lines)).searchParams.get("text") ?? "";
    expect(text.length).toBeLessThanOrEqual(900);
  });
});
