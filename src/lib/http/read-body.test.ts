import { describe, expect, it } from "vitest";
import { PayloadTooLargeError, readBodyLimited } from "./read-body";

function streamed(chunks: number, size: number): Request {
  const encoder = new TextEncoder();
  const body = new ReadableStream<Uint8Array>({
    start(controller) {
      for (let i = 0; i < chunks; i += 1) controller.enqueue(encoder.encode("x".repeat(size)));
      controller.close();
    },
  });
  return new Request("http://localhost/x", {
    method: "POST",
    body,
    duplex: "half",
  } as RequestInit);
}

describe("readBodyLimited", () => {
  it("повертає тіло в межах ліміту", async () => {
    const request = new Request("http://localhost/x", { method: "POST", body: '{"a":1}' });
    await expect(readBodyLimited(request, 100)).resolves.toBe('{"a":1}');
  });

  it("відхиляє за заявленим Content-Length ще до читання", async () => {
    const request = new Request("http://localhost/x", {
      method: "POST",
      body: "small",
      headers: { "content-length": "999999" },
    });
    await expect(readBodyLimited(request, 100)).rejects.toBeInstanceOf(PayloadTooLargeError);
  });

  it("обриває потік без Content-Length, щойно перевищено ліміт", async () => {
    await expect(readBodyLimited(streamed(20, 1000), 5000)).rejects.toBeInstanceOf(PayloadTooLargeError);
  });

  it("рахує байти, а не символи", async () => {
    const request = new Request("http://localhost/x", { method: "POST", body: "я".repeat(60) });
    await expect(readBodyLimited(request, 100)).rejects.toBeInstanceOf(PayloadTooLargeError);
  });

  it("повертає порожній рядок для запиту без тіла", async () => {
    await expect(readBodyLimited(new Request("http://localhost/x", { method: "POST" }), 10)).resolves.toBe("");
  });
});
