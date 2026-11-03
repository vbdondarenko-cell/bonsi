import { describe, expect, it } from "vitest";
import { checklistToText, isOverdue, linksToText, parseChecklist, parseLinks } from "./tasks";

describe("чекліст", () => {
  it("розбирає маркери й повертає той самий текст", () => {
    const items = parseChecklist("[x] Макет\n[ ] Тести\nПросто рядок\n\n[x]   ");
    expect(items).toEqual([{ done: true, text: "Макет" }, { done: false, text: "Тести" }, { done: false, text: "Просто рядок" }]);
    expect(parseChecklist(checklistToText(items))).toEqual(items);
  });
  it("обмежує кількість пунктів", () => {
    expect(parseChecklist(Array.from({ length: 80 }, (_, i) => `пункт ${i}`).join("\n"))).toHaveLength(50);
  });
});

describe("посилання", () => {
  it("визначає тип за доменом і приймає явний тип", () => {
    const { links, invalid } = parseLinks("https://github.com/org/repo/pull/3\nfigma https://www.figma.com/design/abc\npreview https://stage.example.com\nhttps://example.com/x");
    expect(invalid).toEqual([]);
    expect(links.map((l) => l.kind)).toEqual(["github", "figma", "preview", "other"]);
    expect(parseLinks(linksToText(links)).links).toEqual(links);
  });
  it("відхиляє не-https, javascript: і пробіли в URL", () => {
    const { links, invalid } = parseLinks("http://insecure.example\njavascript:alert(1)\nhttps://ok.example/a b");
    expect(links).toEqual([]);
    expect(invalid).toHaveLength(3);
  });
});

describe("прострочення", () => {
  const today = new Date("2026-11-10T12:00:00Z");
  it("прострочено лише незавершене завдання з минулим дедлайном", () => {
    expect(isOverdue("2026-11-09", "todo", today)).toBe(true);
    expect(isOverdue("2026-11-09", "done", today)).toBe(false);
    expect(isOverdue("2026-11-10", "todo", today)).toBe(false);
    expect(isOverdue(null, "todo", today)).toBe(false);
  });
});
