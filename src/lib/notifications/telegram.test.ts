import { describe, expect, it, vi } from "vitest";
import {
  escapeHtml,
  formatOrderMessage,
  getTelegramConfig,
  isTelegramEnabled,
  sendTelegramMessage,
} from "./telegram";

describe("конфігурація Telegram", () => {
  it("вимкнена без токена або chat id", () => {
    expect(isTelegramEnabled({} as NodeJS.ProcessEnv)).toBe(false);
    expect(isTelegramEnabled({ TELEGRAM_BOT_TOKEN: "123:abc" } as unknown as NodeJS.ProcessEnv)).toBe(false);
    expect(isTelegramEnabled({ TELEGRAM_CHAT_IDS: "1" } as unknown as NodeJS.ProcessEnv)).toBe(false);
  });

  it("читає кілька chat id і відкидає сміття", () => {
    const config = getTelegramConfig({
      TELEGRAM_BOT_TOKEN: " 123:abc ",
      TELEGRAM_CHAT_IDS: "111, -100222 ,abc,,33a",
    } as unknown as NodeJS.ProcessEnv);
    expect(config).toEqual({ token: "123:abc", chatIds: ["111", "-100222"] });
  });
});

describe("повідомлення про заявку", () => {
  const notice = {
    orderId: "0b0b0b0b-0b0b-4b0b-8b0b-0b0b0b0b0b0b",
    ticket: "BON-2026-00007",
    service: "webapp",
    name: "Іван <b>Хакер</b> & Ко",
    createdAt: "2026-10-31T10:00:00Z",
  };

  it("містить номер, послугу, імʼя, час і посилання на заявку", () => {
    const text = formatOrderMessage(notice, "https://bonsi.example/");
    expect(text).toContain("BON-2026-00007");
    expect(text).toContain("Вебзастосунки");
    expect(text).toContain("12:00"); // Київ, UTC+2
    expect(text).toContain('href="https://bonsi.example/admin/orders/0b0b0b0b-0b0b-4b0b-8b0b-0b0b0b0b0b0b"');
  });

  it("екранує HTML у даних клієнта", () => {
    const text = formatOrderMessage(notice, "https://bonsi.example");
    expect(text).toContain("Іван &lt;b&gt;Хакер&lt;/b&gt; &amp; Ко");
    expect(text).not.toContain("<b>Хакер</b>");
    expect(escapeHtml('<a href="x">')).toBe('&lt;a href="x"&gt;');
  });

  it("не містить email, телефону, бюджету чи опису ідеї", () => {
    const text = formatOrderMessage({ ...notice, name: "Іван" }, "https://bonsi.example");
    expect(text).not.toMatch(/@|\+380|бюджет|ідея/i);
  });
});

describe("надсилання", () => {
  const config = { token: "123456:SECRET-TOKEN", chatIds: ["1"] };

  it("викликає sendMessage з chat id й HTML-режимом", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(new Response("{}", { status: 200 }));
    await sendTelegramMessage(config, "42", "hi", fetchImpl as unknown as typeof fetch);
    const [url, init] = fetchImpl.mock.calls[0]!;
    expect(url).toBe("https://api.telegram.org/bot123456:SECRET-TOKEN/sendMessage");
    expect(JSON.parse((init as RequestInit).body as string)).toMatchObject({ chat_id: "42", text: "hi", parse_mode: "HTML" });
  });

  it("помилка не розкриває токен", async () => {
    const http = vi.fn().mockResolvedValue(new Response("{}", { status: 401 }));
    await expect(sendTelegramMessage(config, "1", "x", http as unknown as typeof fetch)).rejects.toThrow(/HTTP 401/);
    await sendTelegramMessage(config, "1", "x", http as unknown as typeof fetch).catch((e: Error) => {
      expect(e.message).not.toContain("SECRET-TOKEN");
    });

    const network = vi.fn().mockRejectedValue(new Error("connect to https://api.telegram.org/bot123456:SECRET-TOKEN failed"));
    await sendTelegramMessage(config, "1", "x", network as unknown as typeof fetch).catch((e: Error) => {
      expect(e.message).not.toContain("SECRET-TOKEN");
    });
  });
});
