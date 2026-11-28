import { describe, expect, it } from "vitest";
import { discountedAmount, getActivePromo, replaceAmountInLabel } from "./promo";

// Зимою Київ = UTC+2, тому «полудень за Києвом» = 10:00 UTC.
const day = (iso: string) => new Date(`${iso}T10:00:00Z`);

describe("promo", () => {
  it("активна з 6 грудня по 2 січня і неактивна поза вікном", () => {
    for (const d of ["2026-12-06", "2026-12-25", "2026-12-31", "2027-01-01", "2027-01-02"]) {
      expect(getActivePromo(day(d))?.id).toBe("new-year");
    }
    for (const d of ["2026-12-05", "2027-01-03", "2026-11-28", "2027-06-15"]) {
      expect(getActivePromo(day(d))).toBeNull();
    }
  });

  it("дні рахуються за київським часом", () => {
    // 22:30 UTC 5 грудня = 00:30 6 грудня в Києві → вже діє
    expect(getActivePromo(new Date("2026-12-05T22:30:00Z"))?.id).toBe("new-year");
    // 22:30 UTC 2 січня = 00:30 3 січня в Києві → вже ні
    expect(getActivePromo(new Date("2027-01-02T22:30:00Z"))).toBeNull();
  });

  it("рахує знижку 40% і підставляє її в підпис", () => {
    expect(discountedAmount(3000, 40)).toBe(1800);
    expect(discountedAmount(500, 40)).toBe(300);
    expect(replaceAmountInLabel("від 3 000 ₴", 1800)).toBe("від 1 800 ₴");
    expect(replaceAmountInLabel("від 500 ₴/міс.", 300)).toBe("від 300 ₴/міс.");
    expect(replaceAmountInLabel("1 000 ₴/місяць", 600)).toBe("600 ₴/місяць");
  });
});
