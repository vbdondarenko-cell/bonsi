import { describe, expect, it } from "vitest";
import { hasIgnoreCookie, ignoreCookieString } from "./ignore";

describe("hasIgnoreCookie", () => {
  it("знаходить позначку серед інших cookie", () => {
    expect(hasIgnoreCookie("a=1; bonsi_ignore=1; b=2")).toBe(true);
    expect(hasIgnoreCookie("bonsi_ignore=1")).toBe(true);
  });
  it("не реагує на відсутню, порожню чи схожу позначку", () => {
    expect(hasIgnoreCookie(null)).toBe(false);
    expect(hasIgnoreCookie("")).toBe(false);
    expect(hasIgnoreCookie("bonsi_ignore=")).toBe(false);
    expect(hasIgnoreCookie("x_bonsi_ignore=1")).toBe(false);
  });
});

describe("ignoreCookieString", () => {
  it("вмикає на рік і знімає нульовим Max-Age", () => {
    expect(ignoreCookieString(true)).toContain("bonsi_ignore=1");
    expect(ignoreCookieString(true)).toContain("Max-Age=31536000");
    expect(ignoreCookieString(false)).toContain("Max-Age=0");
  });
});
