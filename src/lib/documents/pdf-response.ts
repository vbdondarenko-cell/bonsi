import { PdfIntegrityError, type PdfResult } from "./pdf";

/** Однакові заголовки для всіх PDF: приватне, без кешу, без вгадування типу, ASCII-ім'я файлу. */
export function pdfResponse(result: PdfResult, filename: string): Response {
  const ascii = filename.replace(/[^A-Za-z0-9._-]/g, "_");
  return new Response(new Uint8Array(result.buffer), {
    status: 200,
    headers: {
      "Content-Type": "application/pdf",
      "Content-Disposition": `attachment; filename="${ascii}"; filename*=UTF-8''${encodeURIComponent(filename)}`,
      "Content-Length": String(result.buffer.length),
      "Cache-Control": "private, no-store",
      "X-Content-Type-Options": "nosniff",
    },
  });
}

export const notFoundResponse = () => new Response("Not found", { status: 404, headers: { "Cache-Control": "no-store" } });

/** Порушення цілісності — окрема відповідь 409 без деталей: версію не віддаємо, адміністратор бачить помилку в журналі сервера. */
export function pdfFailure(error: unknown): Response {
  if (error instanceof PdfIntegrityError) {
    console.error("[pdf] integrity check failed: stored hash does not match document text");
    return new Response("Документ не пройшов перевірку цілісності", { status: 409, headers: { "Cache-Control": "no-store" } });
  }
  console.error("[pdf] generation failed:", error instanceof Error ? error.name : "unknown");
  return new Response("Не вдалося сформувати PDF", { status: 500, headers: { "Cache-Control": "no-store" } });
}
