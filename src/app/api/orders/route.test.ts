import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/orders/service", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/orders/service")>();
  return { ...actual, createOrder: vi.fn() };
});

vi.mock("@/lib/notifications/dispatch", () => ({ dispatchSafely: vi.fn() }));

import {
  ConfigError,
  RateLimitError,
  StorageError,
  createOrder,
} from "@/lib/orders/service";
import { POST } from "./route";

const createOrderMock = vi.mocked(createOrder);

function payload(overrides: Record<string, unknown> = {}) {
  return {
    service: "landing",
    idea: "Потрібен односторінковий сайт для нового продукту.",
    budget: "lt-50k",
    deadline: "1-month",
    name: "Іван",
    email: "ivan@example.com",
    consent: true,
    startedAt: Date.now() - 20_000,
    ...overrides,
  };
}

function post(
  body: unknown,
  headers: Record<string, string> = { "content-type": "application/json" },
) {
  return POST(
    new Request("http://localhost/api/orders", {
      method: "POST",
      headers,
      body: typeof body === "string" ? body : JSON.stringify(body),
    }),
  );
}

const json = { "content-type": "application/json" };

describe("POST /api/orders", () => {
  beforeEach(() => {
    createOrderMock.mockReset();
    vi.stubEnv("TRUSTED_PROXY", "");
    vi.spyOn(console, "error").mockImplementation(() => {});
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    vi.restoreAllMocks();
  });

  it("зберігає валідну заявку й повертає номер звернення", async () => {
    createOrderMock.mockResolvedValue({ ticket: "BON-2026-00001" });
    const response = await post(payload());
    expect(response.status).toBe(201);
    expect(await response.json()).toEqual({ ticket: "BON-2026-00001" });
    expect(createOrderMock).toHaveBeenCalledTimes(1);
  });

  it("повертає 400 на некоректний JSON", async () => {
    const response = await post("{not json", json);
    expect(response.status).toBe(400);
    expect(createOrderMock).not.toHaveBeenCalled();
  });

  it("приймає мінімальну заявку без опису, бюджету й термінів та передає уточнення й посилання", async () => {
    createOrderMock.mockResolvedValue({ ticket: "BON-2026-00002" });
    const response = await post(
      payload({ idea: undefined, budget: undefined, deadline: undefined, service: "landing", details: { goal: "leads" }, links: ["https://example.com/ref"] }),
    );
    expect(response.status).toBe(201);
    expect(createOrderMock.mock.calls[0]![0]).toMatchObject({ service: "landing", details: { goal: "leads" }, links: ["https://example.com/ref"] });
  });

  it("відхиляє уточнення, що не належать обраній послузі", async () => {
    const response = await post(payload({ service: "landing", details: { platform: "ios" } }));
    expect(response.status).toBe(400);
    expect(createOrderMock).not.toHaveBeenCalled();
  });

  it("повертає 400 і помилки полів на невалідні дані", async () => {
    const response = await post(payload({ email: "oops", links: ["javascript:alert(1)"] }));
    expect(response.status).toBe(400);
    const body = await response.json();
    expect(body.error).toBe("validation");
    expect(body.fieldErrors.email).toBeDefined();
    expect(body.fieldErrors.links).toBeDefined();
    expect(createOrderMock).not.toHaveBeenCalled();
  });

  it("вимагає згоду на обробку персональних даних", async () => {
    const response = await post(payload({ consent: false }));
    expect(response.status).toBe(400);
    expect((await response.json()).fieldErrors.consent).toBeDefined();
    expect(createOrderMock).not.toHaveBeenCalled();
  });

  it("мовчки відкидає заявки з заповненим honeypot", async () => {
    const response = await post(payload({ website: "http://spam.example" }));
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ ok: true });
    expect(createOrderMock).not.toHaveBeenCalled();
  });

  it("відхиляє занадто швидке заповнення форми", async () => {
    const response = await post(payload({ startedAt: Date.now() - 500 }));
    expect(response.status).toBe(400);
    expect((await response.json()).error).toBe("too_fast");
    expect(createOrderMock).not.toHaveBeenCalled();
  });

  it("відхиляє startedAt із майбутнього", async () => {
    const response = await post(payload({ startedAt: Date.now() + 60_000 }));
    expect(response.status).toBe(400);
    expect(createOrderMock).not.toHaveBeenCalled();
  });

  it("відхиляє запити з чужого Origin", async () => {
    const response = await post(payload(), { ...json, origin: "https://evil.example" });
    expect(response.status).toBe(403);
    expect(createOrderMock).not.toHaveBeenCalled();
  });

  it("приймає Origin, що збігається з публічною адресою сайту", async () => {
    createOrderMock.mockResolvedValue({ ticket: "BON-2026-00002" });
    const response = await post(payload(), { ...json, origin: "http://localhost:3000" });
    expect(response.status).toBe(201);
  });

  it("відхиляє Content-Type, відмінний від application/json", async () => {
    const response = await post(JSON.stringify(payload()), { "content-type": "text/plain" });
    expect(response.status).toBe(415);
    const form = await post("a=b", { "content-type": "application/x-www-form-urlencoded" });
    expect(form.status).toBe(415);
    expect(createOrderMock).not.toHaveBeenCalled();
  });

  it("повертає 413 для завеликого тіла за Content-Length", async () => {
    const response = await post(payload(), { ...json, "content-length": "999999" });
    expect(response.status).toBe(413);
    expect(createOrderMock).not.toHaveBeenCalled();
  });

  it("повертає 413 для завеликого потокового тіла без Content-Length", async () => {
    const encoder = new TextEncoder();
    const body = new ReadableStream<Uint8Array>({
      start(controller) {
        for (let i = 0; i < 10; i += 1) controller.enqueue(encoder.encode("x".repeat(5_000)));
        controller.close();
      },
    });
    const response = await POST(
      new Request("http://localhost/api/orders", {
        method: "POST",
        headers: json,
        body,
        duplex: "half",
      } as RequestInit),
    );
    expect(response.status).toBe(413);
    expect(createOrderMock).not.toHaveBeenCalled();
  });

  it("повертає 429 при перевищенні ліміту", async () => {
    createOrderMock.mockRejectedValue(new RateLimitError());
    const response = await post(payload());
    expect(response.status).toBe(429);
  });

  it("повертає 503, якщо сервер не налаштований", async () => {
    createOrderMock.mockRejectedValue(new ConfigError("no env"));
    const response = await post(payload());
    expect(response.status).toBe(503);
  });

  it("повертає 500 і не імітує успіх, якщо база недоступна", async () => {
    createOrderMock.mockRejectedValue(new StorageError("db down"));
    const response = await post(payload());
    expect(response.status).toBe(500);
    expect(await response.json()).toEqual({ error: "server_error" });
  });

  it("не пише персональні дані в лог помилок", async () => {
    createOrderMock.mockRejectedValue(new StorageError("db down"));
    await post(payload({ email: "secret.person@example.com" }));
    const logged = JSON.stringify(vi.mocked(console.error).mock.calls);
    expect(logged).not.toContain("secret.person@example.com");
  });
});

describe("POST /api/orders: довіра до проксі-заголовків", () => {
  const spoofedHeaders = {
    ...json,
    "x-forwarded-for": "6.6.6.6, 203.0.113.9",
    "x-real-ip": "7.7.7.7",
    "cf-connecting-ip": "8.8.8.8",
  };

  beforeEach(() => {
    createOrderMock.mockReset();
    createOrderMock.mockResolvedValue({ ticket: "BON-2026-00003" });
    vi.spyOn(console, "error").mockImplementation(() => {});
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    vi.restoreAllMocks();
  });

  const bucketUsed = () => createOrderMock.mock.calls[0]?.[1].ipBucket;

  it("за замовчуванням ігнорує всі заголовки: ключ ліміту невідомий", async () => {
    vi.stubEnv("TRUSTED_PROXY", "");
    expect((await post(payload(), spoofedHeaders)).status).toBe(201);
    expect(bucketUsed()).toBeNull();
  });

  it("hops:1 бере адресу довіреного проксі, а не підроблену першу", async () => {
    vi.stubEnv("TRUSTED_PROXY", "hops:1");
    await post(payload(), spoofedHeaders);
    expect(bucketUsed()).toBe("203.0.113.9");
  });

  it("cloudflare довіряє лише cf-connecting-ip", async () => {
    vi.stubEnv("TRUSTED_PROXY", "cloudflare");
    await post(payload(), spoofedHeaders);
    expect(bucketUsed()).toBe("8.8.8.8");
  });

  it("vercel довіряє x-real-ip, а не x-forwarded-for чи cf-connecting-ip", async () => {
    vi.stubEnv("TRUSTED_PROXY", "vercel");
    await post(payload(), spoofedHeaders);
    expect(bucketUsed()).toBe("7.7.7.7");
  });

  it("некоректна конфігурація TRUSTED_PROXY дає 503 і не зберігає заявку", async () => {
    vi.stubEnv("TRUSTED_PROXY", "trust-everyone");
    const response = await post(payload(), spoofedHeaders);
    expect(response.status).toBe(503);
    expect(createOrderMock).not.toHaveBeenCalled();
  });
});
