export class PayloadTooLargeError extends Error {
  constructor() {
    super("payload_too_large");
  }
}

/**
 * Читає тіло запиту потоково й перериває читання, щойно перевищено ліміт.
 * `request.text()` спершу буферизує ВСЕ тіло, тож заголовку Content-Length
 * (який клієнт може не надіслати або збрехати) недостатньо.
 */
export async function readBodyLimited(request: Request, maxBytes: number): Promise<string> {
  const declared = request.headers.get("content-length");
  if (declared !== null) {
    const length = Number(declared);
    if (Number.isFinite(length) && length > maxBytes) throw new PayloadTooLargeError();
  }
  if (!request.body) return "";

  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > maxBytes) {
      await reader.cancel().catch(() => undefined);
      throw new PayloadTooLargeError();
    }
    chunks.push(value);
  }
  return Buffer.concat(chunks).toString("utf8");
}
