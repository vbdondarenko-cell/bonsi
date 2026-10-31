import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/orders/service", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/orders/service")>();
  return { ...actual, createOrder: vi.fn() };
});

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

function post(body: unknown, headers: Record<string, string> = {}) {
  return POST(
    new Request("http://localhost/api/orders", {
      method: "POST",
      headers: { "content-type": "application/json", ...headers },
      body: typeof body === "string" ? body : JSON.stringify(body),
    }),
  );
}

describe("POST /api/orders", () => {
  beforeEach(() => {
    createOrderMock.mockReset();
    vi.spyOn(console, "error").mockImplementation(() => {});
  });

  it("зберігає валідну заявку й повертає номер звернення", async () => {
    createOrderMock.mockResolvedValue({ ticket: "BON-2026-00001" });
    const response = await post(payload());
    expect(response.status).toBe(201);
    expect(await response.json()).toEqual({ ticket: "BON-2026-00001" });
    expect(createOrderMock).toHaveBeenCalledTimes(1);
  });

  it("повертає 400 на некоректний JSON", async () => {
    const response = await post("{not json");
    expect(response.status).toBe(400);
    expect(createOrderMock).not.toHaveBeenCalled();
  });

  it("повертає 400 і помилки полів на невалідні дані", async () => {
    const response = await post(payload({ email: "oops", idea: "коротко" }));
    expect(response.status).toBe(400);
    const body = await response.json();
    expect(body.error).toBe("validation");
    expect(body.fieldErrors.email).toBeDefined();
    expect(body.fieldErrors.idea).toBeDefined();
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

  it("відхиляє запити з чужого Origin", async () => {
    const response = await post(payload(), { origin: "https://evil.example" });
    expect(response.status).toBe(403);
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
});
