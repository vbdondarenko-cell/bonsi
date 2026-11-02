import { describe, expect, it } from "vitest";
import { mergeMessages, type ThreadMessage } from "./message-thread";

const m = (id: number, extra: Partial<ThreadMessage> = {}): ThreadMessage => ({ id, role: "admin", body: `m${id}`, at: "2026-01-01T00:00:00Z", ...extra });

describe("mergeMessages", () => {
  it("не створює дублікатів і зберігає порядок за id", () => {
    const merged = mergeMessages([m(3), m(4)], [m(1), m(2), m(3), m(4), m(5)]);
    expect(merged.map((x) => x.id)).toEqual([1, 2, 3, 4, 5]);
  });
  it("нові дані перекривають старі (позначка «прочитано»)", () => {
    const merged = mergeMessages([m(1, { role: "client", readByStudio: false })], [m(1, { role: "client", readByStudio: true })]);
    expect(merged).toHaveLength(1);
    expect(merged[0].readByStudio).toBe(true);
  });
});
