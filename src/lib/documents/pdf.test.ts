import { execFileSync, spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { documentNumber, formatPdfMoney, PdfIntegrityError, renderDocumentPdf, renderInvoicePdf, type DocumentPdfInput } from "./pdf";

const sha = (s: string) => createHash("sha256").update(s, "utf8").digest("hex");
const hasPoppler = spawnSync("pdftotext", ["-v"]).status !== null && spawnSync("pdftotext", ["-v"]).error === undefined;
const body = [
  "# Договір на розробку",
  "Заявка BON-2026-00001 · Сайт-платформа · 03.11.2026",
  "## 1. Сторони\n- Виконавець: BONSI Studios\n- Замовник: Іван Петренко ґ є ї і",
  "## 2. Вартість\n- Вартість: 100 000,01 UAH\n- Оплата вважається здійсненою після підтвердження надходження коштів",
].join("\n\n");
const input = (over: Partial<DocumentPdfInput> = {}): DocumentPdfInput => ({
  kindLabel: "Договір", title: "Договір на розробку BON-2026-00001", number: documentNumber("123e4567-e89b-42d3-a456-426614174000", "2026-11-03T10:00:00Z"), version: 2, statusLabel: "Погоджено", draft: false,
  createdAt: "2026-11-03T10:00:00Z", sentAt: "2026-11-04T10:00:00Z", decidedAt: "2026-11-05T10:00:00Z", projectTitle: "Сайт-платформа", clientName: "Іван Петренко", operatorName: "BONSI Studios", body, contentHash: sha(body), ...over,
});
const pdfText = (buffer: Buffer) => {
  const file = join(mkdtempSync(join(tmpdir(), "pdf-")), "x.pdf");
  writeFileSync(file, buffer);
  return execFileSync("pdftotext", ["-layout", file, "-"], { encoding: "utf8" });
};

describe("PDF документа", () => {
  it("формує коректний PDF A4 з українським текстом, номером, датами й контрольною сумою", async () => {
    const { buffer, pages, text } = await renderDocumentPdf(input());
    expect(buffer.subarray(0, 5).toString()).toBe("%PDF-");
    expect(pages).toBe(1);
    for (const needle of ["Договір на розробку", "DOC-2026-123E4567", "Іван Петренко", "100 000,01 UAH", "ґ є ї і", sha(body)]) expect(text).toContain(needle);
  });

  it.skipIf(!hasPoppler)("PDF справді містить кирилицю, сторінки A4 і нумерацію «Сторінка 1 з 1»", async () => {
    const { buffer } = await renderDocumentPdf(input());
    const file = join(mkdtempSync(join(tmpdir(), "pdf-")), "x.pdf");
    writeFileSync(file, buffer);
    const info = execFileSync("pdfinfo", [file], { encoding: "utf8" });
    expect(info).toMatch(/Page size:\s+595\.\d+ x 841\.\d+ pts \(A4\)/);
    const text = pdfText(buffer);
    expect(text).toContain("Договір на розробку");
    expect(text).toContain("Іван Петренко");
    expect(text).toContain("Сторінка 1 з 1");
    expect(text.replace(/\s+/g, " ")).toContain("кваліфікованим електронним підписом");
  });

  it.skipIf(!hasPoppler)("довгий документ переноситься на кілька сторінок без обрізання; нумерація «з N» правильна", async () => {
    const long = ["# Технічне завдання", ...Array.from({ length: 60 }, (_, i) => `## Розділ ${i + 1}\n- ${"Дуже довгий пункт без пробілів-обмежень, який має переноситись на наступний рядок. ".repeat(3)}\n\nПараграф ${i + 1}: ${"текст ".repeat(40)}`)].join("\n\n");
    const result = await renderDocumentPdf(input({ body: long, contentHash: sha(long) }));
    expect(result.pages).toBeGreaterThan(3);
    const text = pdfText(result.buffer);
    expect(text).toContain("Розділ 60");
    expect(text).toContain(`Сторінка ${result.pages} з ${result.pages}`);
    expect(text).toContain("Параграф 60");
  });

  it("чернетка позначається, а змінений текст (хеш не збігається) відхиляється", async () => {
    const draft = await renderDocumentPdf(input({ draft: true, statusLabel: "Чернетка" }));
    expect(draft.buffer.length).toBeGreaterThan(1000);
    await expect(renderDocumentPdf(input({ body: body + "\n- підмінений пункт" }))).rejects.toBeInstanceOf(PdfIntegrityError);
  });

  it("однакова версія дає однаковий текст (детермінованість змісту)", async () => {
    const a = await renderDocumentPdf(input());
    const b = await renderDocumentPdf(input());
    expect(a.text).toBe(b.text);
    expect(a.pages).toBe(b.pages);
  });
});

describe("PDF рахунку", () => {
  const invoice = { number: "INV-2026-00012", label: "Передоплата 30%", amount: "30000.50", currency: "UAH", statusLabel: "Виставлено", issuedAt: "2026-11-03T10:00:00Z", dueDate: "2026-11-10", projectTitle: "Сайт-платформа", clientName: "Іван Петренко", operatorName: "BONSI Studios", recipient: "ФОП Тест", iban: "UA213223130000026007233566001", bank: "Банк", taxId: "1234567890", purposeHint: "Оплата за рахунком {number}" };
  it("містить номер, суму з валютою, реквізити й призначення платежу з номером", async () => {
    const { buffer, text, pages } = await renderInvoicePdf(invoice);
    expect(buffer.subarray(0, 5).toString()).toBe("%PDF-");
    expect(pages).toBe(1);
    for (const needle of ["INV-2026-00012", "30 000,50 UAH", "UA213223130000026007233566001", "Оплата за рахунком INV-2026-00012", "лише після підтвердження студією"]) expect(text).toContain(needle);
  });
  it("без заповнених реквізитів чесно про це пише", async () => {
    expect((await renderInvoicePdf({ ...invoice, recipient: null, iban: null })).text).toContain("Реквізити ще не заповнені");
  });
  it("формат грошей: дві цифри після коми", () => {
    expect(formatPdfMoney("1000", "UAH")).toBe("1 000,00 UAH");
    expect(formatPdfMoney(0.5, "USD")).toBe("0,50 USD");
  });
});
