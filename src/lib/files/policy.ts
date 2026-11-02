/** Політика завантаження файлів: розмір, типи, назви, сигнатури. Сервер перевіряє все; база дублює список MIME. */
export const MAX_FILE_BYTES = 10 * 1024 * 1024;
export const MAX_FILES_PER_REQUEST = 5;
export const MAX_REQUEST_BYTES = MAX_FILE_BYTES * MAX_FILES_PER_REQUEST + 512 * 1024;

/** Розширення → MIME. SVG свідомо відсутній: це виконуваний контент, який не завантажуємо. */
export const ALLOWED_TYPES: Record<string, string> = {
  png: "image/png",
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  webp: "image/webp",
  gif: "image/gif",
  pdf: "application/pdf",
  txt: "text/plain",
  md: "text/markdown",
  csv: "text/csv",
  json: "application/json",
  zip: "application/zip",
  doc: "application/msword",
  docx: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  xls: "application/vnd.ms-excel",
  xlsx: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  pptx: "application/vnd.openxmlformats-officedocument.presentationml.presentation",
  fig: "application/vnd.figma",
};

export const CLIENT_CATEGORIES = ["logo", "text", "mockup", "document", "attachment", "other"] as const;
export const ADMIN_CATEGORIES = [...CLIENT_CATEGORIES, "final", "handover"] as const;

export type FileCheck = { ok: true; mime: string; name: string } | { ok: false; reason: "empty" | "too_large" | "extension" | "signature" | "name" };

export function sanitizeName(raw: string): string | null {
  // Лише базове ім'я файлу: без шляху, керувальних символів і крапок на початку.
  const base = raw.split(/[\\/]/).pop() ?? "";
  const cleaned = base.replace(/[\u0000-\u001f\u007f<>:"|?*]/g, "").replace(/\s+/g, " ").trim().replace(/^\.+/, "");
  if (!cleaned || cleaned.length > 200) return null;
  return cleaned;
}

export function extensionOf(name: string): string {
  const index = name.lastIndexOf(".");
  return index < 0 ? "" : name.slice(index + 1).toLowerCase();
}

const startsWith = (bytes: Uint8Array, signature: number[], offset = 0) => signature.every((value, i) => bytes[offset + i] === value);

/** Сигнатури для бінарних форматів: розширення не повинно брехати про вміст. Текстові формати перевіряються на відсутність NUL. */
export function matchesSignature(ext: string, bytes: Uint8Array): boolean {
  switch (ext) {
    case "png":
      return startsWith(bytes, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
    case "jpg":
    case "jpeg":
      return startsWith(bytes, [0xff, 0xd8, 0xff]);
    case "gif":
      return startsWith(bytes, [0x47, 0x49, 0x46, 0x38]);
    case "webp":
      return startsWith(bytes, [0x52, 0x49, 0x46, 0x46]) && startsWith(bytes, [0x57, 0x45, 0x42, 0x50], 8);
    case "pdf":
      return startsWith(bytes, [0x25, 0x50, 0x44, 0x46]);
    case "zip":
    case "docx":
    case "xlsx":
    case "pptx":
      return startsWith(bytes, [0x50, 0x4b, 0x03, 0x04]) || startsWith(bytes, [0x50, 0x4b, 0x05, 0x06]);
    case "doc":
    case "xls":
      return startsWith(bytes, [0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1]);
    case "txt":
    case "md":
    case "csv":
    case "json":
      return !bytes.subarray(0, 4096).includes(0);
    default:
      return true; // fig та інші без стабільної сигнатури: тип обмежений списком, віддача — лише як завантаження
  }
}

/**
 * Проміжні розширення, що роблять файл небезпечним при "подвійному розширенні" (`shell.php.png`, `invoice.exe.pdf`):
 * якщо десь у назві є виконуваний/активний тип, файл відхиляється, навіть коли останнє розширення дозволене.
 */
const ACTIVE_EXTENSIONS = new Set(["exe", "dll", "msi", "bat", "cmd", "com", "scr", "ps1", "vbs", "js", "mjs", "jar", "sh", "php", "phtml", "asp", "aspx", "jsp", "py", "pl", "rb", "html", "htm", "xhtml", "svg", "swf", "apk", "app", "lnk", "hta"]);

export function hasActiveExtension(name: string): boolean {
  return name.toLowerCase().split(".").slice(1, -1).some((part) => ACTIVE_EXTENSIONS.has(part.trim()));
}

export function checkFile(rawName: string, size: number, head: Uint8Array): FileCheck {
  if (size <= 0) return { ok: false, reason: "empty" };
  if (size > MAX_FILE_BYTES) return { ok: false, reason: "too_large" };
  const name = sanitizeName(rawName);
  if (!name) return { ok: false, reason: "name" };
  if (hasActiveExtension(name)) return { ok: false, reason: "name" };
  const ext = extensionOf(name);
  const mime = ALLOWED_TYPES[ext];
  if (!mime) return { ok: false, reason: "extension" };
  if (!matchesSignature(ext, head)) return { ok: false, reason: "signature" };
  return { ok: true, mime, name };
}

export const FILE_ERRORS: Record<string, string> = {
  empty: "Файл порожній.",
  too_large: "Файл завеликий (максимум 10 МБ).",
  extension: "Цей тип файлу не підтримується. Дозволені: зображення, PDF, текст, Office-документи, ZIP, Figma.",
  signature: "Вміст файлу не відповідає його розширенню.",
  name: "Некоректна назва файлу.",
};
