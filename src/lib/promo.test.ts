import { describe, expect, it } from "vitest";
import { discountedAmount, getActivePromo, replaceAmountInLabel } from "./promo";

// Зимою Київ = UTC+2, тому «полудень за Києвом» = 10:00 UTC.
const day = (iso: string) => new Date(`${iso}T10:00:00Z`);

describe("promo", () => {
  it("активна у святкові дати і неактивна поза ними", () => {
    expect(getActivePromo(day("2026-12-06"))?.id).toBe("nicholas");
    expect(getActivePromo(day("2026-12-25"))?.id).toBe("christmas");
    expect(getActivePromo(day("2026-12-31"))?.id).toBe("new-year");
    expect(getActivePromo(day("2027-01-01"))?.id).toBe("new-year");
    expect(getActivePromo(day("2027-01-02"))?.id).toBe("new-year");
    expect(getActivePromo(day("2026-12-08"))).toBeNull();
    expect(getActivePromo(day("2027-01-03"))).toBeNull();
    expect(getActivePromo(day("2026-11-28"))).toBeNull();
  });

  it("дні рахуються за київським часом", () => {
    // 22:30 UTC 5 грудня = 00:30 6 грудня в Києві
    expect(getActivePromo(new Date("2026-12-05T22:30:00Z"))?.id).toBe("nicholas");
    // 22:30 UTC 7 грудня = 00:30 8 грудня в Києві → вже без знижки
    expect(getActivePromo(new Date("2026-12-07T22:30:00Z"))).toBeNull();
  });

  it("рахує знижку 40% і підставляє її в підпис", () => {
    expect(discountedAmount(3000, 40)).toBe(1800);
    expect(discountedAmount(500, 40)).toBe(300);
    expect(replaceAmountInLabel("від 3 000 ₴", 1800)).toBe("від 1 800 ₴");
    expect(replaceAmountInLabel("від 500 ₴/міс.", 300)).toBe("від 300 ₴/міс.");
    expect(replaceAmountInLabel("1 000 ₴/місяць", 600)).toBe("600 ₴/місяць");
  });
});
