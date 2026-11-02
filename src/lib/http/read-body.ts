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

/**
 * Обгортає запит так, що тіло рахується під час читання: при перевищенні ліміту потік падає з PayloadTooLargeError,
 * навіть якщо Content-Length збрехав. Для formData(), який інакше буферизує тіло повністю.
 */
export function withBodyLimit(request: Request, maxBytes: number): Request {
  if (!request.body) return request;
  let total = 0;
  const limiter = new TransformStream<Uint8Array, Uint8Array>({
    transform(chunk, controller) {
      total += chunk.byteLength;
      if (total > maxBytes) controller.error(new PayloadTooLargeError());
      else controller.enqueue(chunk);
    },
  });
  return new Request(request.url, { method: request.method, headers: request.headers, body: request.body.pipeThrough(limiter), duplex: "half" } as RequestInit);
}
