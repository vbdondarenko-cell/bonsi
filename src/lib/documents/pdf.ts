import { createHash } from "node:crypto";
import { join } from "node:path";
import PDFDocument from "pdfkit";

/**
 * Серверна генерація PDF (A4) без зовнішніх сервісів. Шрифт Liberation Sans (OFL) з кирилицею лежить у `assets/fonts`.
 * PDF будується з ЗАМОРОЖЕНОЇ версії документа: перед генерацією перевіряється, що SHA-256 тексту збігається з хешем у БД.
 * Це друкована копія тексту, а не електронний підпис: погодження в кабінеті не є кваліфікованим електронним підписом (КЕП).
 */
const FONT_REGULAR = join(process.cwd(), "assets", "fonts", "LiberationSans-Regular.ttf");
const FONT_BOLD = join(process.cwd(), "assets", "fonts", "LiberationSans-Bold.ttf");

const PAGE = { width: 595.28, height: 841.89, margin: 56 };
const NOT_QES = "Погодження в системі BONSI фіксує рішення в журналі з версією та контрольною сумою; воно не є кваліфікованим електронним підписом (КЕП).";

export class PdfIntegrityError extends Error {
  constructor() {
    super("document_hash_mismatch");
  }
}

export type PdfResult = { buffer: Buffer; pages: number; text: string };

export type DocumentPdfInput = {
  kindLabel: string;
  title: string;
  /** Стабільний номер документа (похідний від ідентифікатора). */
  number: string;
  version: number;
  statusLabel: string;
  /** Чернетка: версія ще не заморожена й не відправлена клієнту — на сторінках позначка «ЧЕРНЕТКА». */
  draft: boolean;
  createdAt: string;
  sentAt?: string | null;
  decidedAt?: string | null;
  projectTitle?: string | null;
  clientName?: string | null;
  operatorName: string;
  body: string;
  contentHash: string;
};

export type InvoicePdfInput = {
  number: string;
  label: string;
  amount: string;
  currency: string;
  statusLabel: string;
  issuedAt?: string | null;
  dueDate?: string | null;
  projectTitle?: string | null;
  clientName?: string | null;
  operatorName: string;
  recipient?: string | null;
  iban?: string | null;
  bank?: string | null;
  taxId?: string | null;
  purposeHint?: string | null;
};

const dateFormat = new Intl.DateTimeFormat("uk-UA", { day: "2-digit", month: "long", year: "numeric", timeZone: "Europe/Kyiv" });
export const formatPdfDate = (value: string | null | undefined) => (value ? dateFormat.format(new Date(value)) : "—");
export const formatPdfMoney = (amount: string | number, currency: string) => {
  const n = Number(amount);
  const text = new Intl.NumberFormat("uk-UA", { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(Number.isFinite(n) ? n : 0).replace(/ | /g, " ");
  return `${text} ${currency}`;
};

/** Короткий зрозумілий номер документа з UUID (у БД окремої нумерації документів немає). */
export const documentNumber = (id: string, createdAt: string) => `DOC-${new Date(createdAt).getUTCFullYear()}-${id.replace(/-/g, "").slice(0, 8).toUpperCase()}`;

type Block = { type: "h1" | "h2" | "p" | "li"; text: string };
function parseBody(body: string): Block[] {
  const blocks: Block[] = [];
  for (const raw of body.split(/\r?\n/)) {
    const line = raw.trimEnd();
    if (!line.trim()) continue;
    if (line.startsWith("- ")) blocks.push({ type: "li", text: line.slice(2) });
    else if (line.startsWith("## ")) blocks.push({ type: "h2", text: line.slice(3) });
    else if (line.startsWith("# ")) blocks.push({ type: "h1", text: line.slice(2) });
    else blocks.push({ type: "p", text: line });
  }
  return blocks;
}

function collect(doc: PDFKit.PDFDocument) {
  const chunks: Buffer[] = [];
  doc.on("data", (c: Buffer) => chunks.push(c));
  return new Promise<Buffer>((resolve, reject) => {
    doc.on("end", () => resolve(Buffer.concat(chunks)));
    doc.on("error", reject);
  });
}

function newDoc(title: string, author: string) {
  const doc = new PDFDocument({
    size: "A4",
    margins: { top: PAGE.margin, bottom: PAGE.margin + 18, left: PAGE.margin, right: PAGE.margin },
    bufferPages: true,
    font: FONT_REGULAR,
    info: { Title: title, Author: author, Producer: "BONSI Studios", Creator: "BONSI Studios" },
    compress: true,
  });
  doc.registerFont("Regular", FONT_REGULAR);
  doc.registerFont("Bold", FONT_BOLD);
  return doc;
}

/** Пише текст і одночасно збирає його в масив (для тестів і перевірок без розбору PDF). */
function writer(doc: PDFKit.PDFDocument) {
  const lines: string[] = [];
  const width = PAGE.width - PAGE.margin * 2;
  return {
    lines,
    width,
    text(text: string, options: PDFKit.Mixins.TextOptions & { font?: "Regular" | "Bold"; size?: number; color?: string } = {}) {
      const { font = "Regular", size = 10.5, color = "#111111", ...rest } = options;
      doc.font(font).fontSize(size).fillColor(color).text(text, { width, lineGap: 2.5, ...rest });
      lines.push(text);
    },
    /** Таблиця «ключ — значення»: значення переноситься, текст не обрізається, рядок не розривається між сторінками. */
    table(rows: Array<[string, string]>, labelWidth = 150) {
      const valueWidth = width - labelWidth - 12;
      for (const [label, value] of rows) {
        doc.font("Regular").fontSize(10.5);
        const height = Math.max(doc.heightOfString(label, { width: labelWidth }), doc.heightOfString(value, { width: valueWidth })) + 8;
        if (doc.y + height > PAGE.height - doc.page.margins.bottom) doc.addPage();
        const y = doc.y;
        doc.font("Regular").fontSize(10.5).fillColor("#555555").text(label, PAGE.margin, y, { width: labelWidth });
        doc.font("Regular").fontSize(10.5).fillColor("#111111").text(value, PAGE.margin + labelWidth + 12, y, { width: valueWidth });
        doc.moveTo(PAGE.margin, y + height - 4).lineTo(PAGE.margin + width, y + height - 4).lineWidth(0.4).strokeColor("#cccccc").stroke();
        doc.x = PAGE.margin;
        doc.y = y + height;
        lines.push(`${label}: ${value}`);
      }
    },
    gap(points = 8) {
      doc.moveDown(points / 10.5);
    },
  };
}

/** Нумерація «Сторінка X з Y», контрольна сума й застереження про КЕП внизу кожної сторінки; водяний напис для чернеток. */
function decorate(doc: PDFKit.PDFDocument, footerLeft: string, draft: boolean) {
  const range = doc.bufferedPageRange();
  for (let i = 0; i < range.count; i++) {
    doc.switchToPage(range.start + i);
    const bottom = doc.page.margins.bottom;
    doc.page.margins.bottom = 0; // інакше текст нижче поля створить нову сторінку
    const y = PAGE.height - PAGE.margin - 4;
    doc.font("Regular").fontSize(8).fillColor("#666666");
    doc.text(footerLeft, PAGE.margin, y, { width: PAGE.width - PAGE.margin * 2 - 90, lineBreak: false });
    doc.text(`Сторінка ${i + 1} з ${range.count}`, PAGE.width - PAGE.margin - 90, y, { width: 90, align: "right", lineBreak: false });
    if (draft) {
      doc.save().rotate(-35, { origin: [PAGE.width / 2, PAGE.height / 2] }).font("Bold").fontSize(72).fillColor("#d9d9d9").opacity(0.35).text("ЧЕРНЕТКА", 70, PAGE.height / 2 - 40, { lineBreak: false }).restore();
    }
    doc.page.margins.bottom = bottom;
  }
}

export async function renderDocumentPdf(input: DocumentPdfInput): Promise<PdfResult> {
  // Незмінність: текст, з якого друкуємо, має збігатися з хешем, який порахувала база при фіксації версії.
  const actual = createHash("sha256").update(input.body, "utf8").digest("hex");
  if (input.contentHash && actual !== input.contentHash) throw new PdfIntegrityError();

  const doc = newDoc(input.title, input.operatorName);
  const done = collect(doc);
  const w = writer(doc);

  w.text(input.operatorName.toUpperCase(), { font: "Bold", size: 9, color: "#666666", characterSpacing: 1.5 });
  w.gap(10);
  w.text(`${input.kindLabel} · версія ${input.version}`, { size: 9.5, color: "#666666" });
  w.text(input.title, { font: "Bold", size: 19 });
  w.gap(10);
  w.table([
    ["Номер документа", input.number],
    ["Версія", `${input.version} (${input.statusLabel})`],
    ["Створено", formatPdfDate(input.createdAt)],
    ...(input.sentAt ? ([["Надіслано клієнту", formatPdfDate(input.sentAt)]] as Array<[string, string]>) : []),
    ...(input.decidedAt ? ([["Рішення клієнта", formatPdfDate(input.decidedAt)]] as Array<[string, string]>) : []),
    ["Виконавець", input.operatorName],
    ...(input.clientName ? ([["Замовник", input.clientName]] as Array<[string, string]>) : []),
    ...(input.projectTitle ? ([["Проєкт", input.projectTitle]] as Array<[string, string]>) : []),
  ]);
  w.gap(14);

  for (const block of parseBody(input.body)) {
    if (block.type === "h1") {
      w.gap(6);
      w.text(block.text, { font: "Bold", size: 15, paragraphGap: 4 });
    } else if (block.type === "h2") {
      w.gap(6);
      w.text(block.text, { font: "Bold", size: 12.5, paragraphGap: 2 });
    } else if (block.type === "li") {
      doc.font("Regular").fontSize(10.5).fillColor("#111111");
      const indent = 14;
      const height = doc.heightOfString(block.text, { width: w.width - indent });
      if (doc.y + height > PAGE.height - doc.page.margins.bottom) doc.addPage();
      const y = doc.y;
      doc.text("•", PAGE.margin + 2, y, { width: indent });
      doc.text(block.text, PAGE.margin + indent, y, { width: w.width - indent, lineGap: 2.5 });
      doc.x = PAGE.margin;
      w.lines.push(`• ${block.text}`);
      doc.moveDown(0.2);
    } else {
      w.text(block.text, { paragraphGap: 5 });
    }
  }

  w.gap(14);
  w.text(`Контрольна сума версії (SHA-256): ${input.contentHash || actual}`, { size: 8.5, color: "#555555" });
  w.text(NOT_QES, { size: 8.5, color: "#555555" });

  decorate(doc, `${input.number} · v${input.version} · ${(input.contentHash || actual).slice(0, 16)}`, input.draft);
  const pages = doc.bufferedPageRange().count;
  doc.end();
  return { buffer: await done, pages, text: w.lines.join("\n") };
}

export async function renderInvoicePdf(input: InvoicePdfInput): Promise<PdfResult> {
  const doc = newDoc(`Рахунок ${input.number}`, input.operatorName);
  const done = collect(doc);
  const w = writer(doc);
  const purpose = (input.purposeHint ?? "Оплата за рахунком {number}").replace(/\{number\}/g, input.number);

  w.text(input.operatorName.toUpperCase(), { font: "Bold", size: 9, color: "#666666", characterSpacing: 1.5 });
  w.gap(10);
  w.text(`Рахунок ${input.number}`, { font: "Bold", size: 19 });
  w.gap(10);
  w.table([
    ["Номер рахунку", input.number],
    ["Статус", input.statusLabel],
    ["Виставлено", formatPdfDate(input.issuedAt)],
    ["Сплатити до", formatPdfDate(input.dueDate)],
    ["Постачальник", input.operatorName],
    ...(input.clientName ? ([["Платник", input.clientName]] as Array<[string, string]>) : []),
    ...(input.projectTitle ? ([["Проєкт", input.projectTitle]] as Array<[string, string]>) : []),
  ]);
  w.gap(14);
  w.text("Позиції", { font: "Bold", size: 12.5, paragraphGap: 4 });
  w.table([[input.label, formatPdfMoney(input.amount, input.currency)]], 330);
  w.gap(6);
  w.text(`До сплати: ${formatPdfMoney(input.amount, input.currency)}`, { font: "Bold", size: 13 });
  w.gap(14);
  w.text("Реквізити для оплати", { font: "Bold", size: 12.5, paragraphGap: 4 });
  if (input.recipient || input.iban) {
    w.table([
      ["Отримувач", input.recipient ?? "—"],
      ["IBAN", input.iban ?? "—"],
      ["Банк", input.bank ?? "—"],
      ["Код отримувача", input.taxId ?? "—"],
      ["Призначення платежу", purpose],
    ]);
  } else {
    w.text("Реквізити ще не заповнені студією. Зверніться до студії для оплати.", { color: "#555555" });
  }
  w.gap(12);
  w.text("Рахунок вважається сплаченим лише після підтвердження студією надходження коштів. Повідомлення клієнта «Я сплатив(ла)» оплатою не є.", { size: 8.5, color: "#555555" });

  decorate(doc, `Рахунок ${input.number}`, false);
  const pages = doc.bufferedPageRange().count;
  doc.end();
  return { buffer: await done, pages, text: w.lines.join("\n") };
}
