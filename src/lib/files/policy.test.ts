import { describe, expect, it } from "vitest";
import { ALLOWED_TYPES, MAX_FILE_BYTES, checkFile, sanitizeName } from "./policy";
import { storagePath } from "./storage";

const PNG = Uint8Array.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0]);
const PDF = Uint8Array.from([0x25, 0x50, 0x44, 0x46, 0x2d]);
const ZIP = Uint8Array.from([0x50, 0x4b, 0x03, 0x04]);
const EXE = Uint8Array.from([0x4d, 0x5a, 0x90, 0x00]);

describe("checkFile", () => {
  it("приймає коректні файли з відповідною сигнатурою", () => {
    expect(checkFile("logo.PNG", 100, PNG)).toEqual({ ok: true, mime: "image/png", name: "logo.PNG" });
    expect(checkFile("brief.pdf", 100, PDF)).toMatchObject({ ok: true, mime: "application/pdf" });
    expect(checkFile("site.zip", 100, ZIP)).toMatchObject({ ok: true });
    expect(checkFile("notes.txt", 5, new TextEncoder().encode("hello"))).toMatchObject({ ok: true, mime: "text/plain" });
  });
  it("відхиляє виконувані й небезпечні типи (exe, svg, html, js)", () => {
    for (const name of ["a.exe", "a.svg", "a.html", "a.js", "a.php", "a.sh", "noext"]) {
      expect(checkFile(name, 10, PNG), name).toEqual({ ok: false, reason: "extension" });
    }
  });
  it("не вірить розширенню: exe під виглядом png і двійковий вміст під виглядом txt відхиляються", () => {
    expect(checkFile("fake.png", 10, EXE)).toEqual({ ok: false, reason: "signature" });
    expect(checkFile("fake.txt", 10, Uint8Array.from([65, 0, 66]))).toEqual({ ok: false, reason: "signature" });
    expect(checkFile("fake.pdf", 10, PNG)).toEqual({ ok: false, reason: "signature" });
  });
  it("обмежує розмір і порожні файли", () => {
    expect(checkFile("a.png", 0, PNG)).toEqual({ ok: false, reason: "empty" });
    expect(checkFile("a.png", MAX_FILE_BYTES + 1, PNG)).toEqual({ ok: false, reason: "too_large" });
    expect(checkFile("a.png", MAX_FILE_BYTES, PNG)).toMatchObject({ ok: true });
  });
  it("кожен дозволений тип узгоджений зі списком MIME у базі", () => {
    const dbList = new Set([
      "image/png", "image/jpeg", "image/webp", "image/gif", "application/pdf", "text/plain", "text/markdown", "text/csv", "application/zip",
      "application/vnd.openxmlformats-officedocument.wordprocessingml.document", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "application/vnd.openxmlformats-officedocument.presentationml.presentation", "application/msword", "application/vnd.ms-excel", "application/vnd.figma", "application/json",
    ]);
    for (const mime of Object.values(ALLOWED_TYPES)) expect(dbList.has(mime), mime).toBe(true);
  });
});

describe("sanitizeName і storagePath", () => {
  it("прибирає шляхи, керувальні символи й ведучі крапки", () => {
    expect(sanitizeName("../../etc/passwd")).toBe("passwd");
    expect(sanitizeName("C:\\Users\\x\\логотип.png")).toBe("логотип.png");
    expect(sanitizeName("..hidden.png")).toBe("hidden.png");
    expect(sanitizeName("a\u0000b<c>.png")).toBe("abc.png");
    expect(sanitizeName("   ")).toBeNull();
    expect(sanitizeName("a".repeat(300) + ".png")).toBeNull();
  });
  it("шлях сховища не містить імені користувача й унікальний", () => {
    const project = "11111111-1111-4111-8111-111111111111";
    const one = storagePath(project), two = storagePath(project);
    expect(one).toMatch(new RegExp(`^${project}/[0-9a-f-]{36}$`));
    expect(one).not.toBe(two);
  });
});
