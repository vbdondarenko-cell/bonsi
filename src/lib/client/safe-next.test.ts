import { describe, expect, it } from "vitest";
import { safeNext } from "./safe-next";

describe("safeNext", () => {
  it("пропускає лише шляхи кабінету", () => {
    expect(safeNext("/app")).toBe("/app");
    expect(safeNext("/app/projects/abc")).toBe("/app/projects/abc");
    expect(safeNext("/app?x=1")).toBe("/app?x=1");
  });
  it("відкидає зовнішні й підозрілі адреси", () => {
    for (const bad of ["https://evil.example", "//evil.example", "/\\evil", "/admin", "/application", "javascript:alert(1)", "/app\\..", "", null, undefined, "/app/\u0000x"]) {
      expect(safeNext(bad as string | null | undefined)).toBe("/app");
    }
  });
});
