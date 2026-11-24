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
    expect(isTelegramEnabled({ TELEGRAM_BOT_TOKEN: "123:abc", TELEGRAM_CHAT_IDS: "1" } as unknown as NodeJS.ProcessEnv)).toBe(false);
  });

  it("читає кілька chat id і відкидає сміття", () => {
    const config = getTelegramConfig({
      TELEGRAM_BOT_TOKEN: " 123:abc ",
      TELEGRAM_CHAT_IDS: "111, -100222 ,abc,,33a",
    } as unknown as NodeJS.ProcessEnv);
    expect(config).toEqual({ token: "123:abc", targets: [{ chatId: "-100222" }] });
  });

  it("читає гілку форум-групи у форматі chatId:threadId", () => {
    const config = getTelegramConfig({
      TELEGRAM_BOT_TOKEN: "123:abc",
      TELEGRAM_CHAT_IDS: "-1001234567890:45, -100999:12 ,77",
    } as unknown as NodeJS.ProcessEnv);
    expect(config).toEqual({
      token: "123:abc",
      targets: [{ chatId: "-1001234567890", threadId: 45 }, { chatId: "-100999", threadId: 12 }],
    });
  });

  it("відкидає некоректний thread id, але лишає решту", () => {
    const config = getTelegramConfig({
      TELEGRAM_BOT_TOKEN: "123:abc",
      TELEGRAM_CHAT_IDS: "-100:0,-100:abc,-100:-5,-100:45",
    } as unknown as NodeJS.ProcessEnv);
    expect(config?.targets).toEqual([{ chatId: "-100", threadId: 45 }]);
  });
});

describe("альтернативні змінні однієї групи", () => {
  it("читає TELEGRAM_CHAT_ID і TELEGRAM_MESSAGE_THREAD_ID", () => {
    const config = getTelegramConfig({
      TELEGRAM_BOT_TOKEN: "1:a",
      TELEGRAM_CHAT_ID: "-1001234567890",
      TELEGRAM_MESSAGE_THREAD_ID: "45",
    } as unknown as NodeJS.ProcessEnv);
    expect(config?.targets).toEqual([{ chatId: "-1001234567890", threadId: 45 }]);
  });

  it("порожній або некоректний thread id ігнорується, TELEGRAM_CHAT_IDS має пріоритет", () => {
    const base = { TELEGRAM_BOT_TOKEN: "1:a", TELEGRAM_CHAT_ID: "-100", TELEGRAM_MESSAGE_THREAD_ID: "" };
    expect(getTelegramConfig(base as unknown as NodeJS.ProcessEnv)?.targets).toEqual([{ chatId: "-100" }]);
    expect(
      getTelegramConfig({ ...base, TELEGRAM_CHAT_IDS: "-200" } as unknown as NodeJS.ProcessEnv)?.targets,
    ).toEqual([{ chatId: "-200" }]);
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

  it("містить номер, послугу, імʼя й час, без посилання на неіснуючу адмінку", () => {
    const text = formatOrderMessage(notice, "https://bonsi.example/");
    expect(text).toContain("BON-2026-00007");
    expect(text).toContain("Вебзастосунки");
    expect(text).toContain("12:00"); // Київ, UTC+2
    expect(text).not.toContain("/admin/");
  });

  it("екранує HTML у даних клієнта", () => {
    const text = formatOrderMessage(notice, "https://bonsi.example");
    expect(text).toContain("Іван &lt;b&gt;Хакер&lt;/b&gt; &amp; Ко");
    expect(text).not.toContain("<b>Хакер</b>");
    expect(escapeHtml('<a href="x">')).toBe('&lt;a href="x"&gt;');
  });

  it("без повної заявки не містить email, телефону чи опису", () => {
    const text = formatOrderMessage({ ...notice, name: "Іван" }, "https://bonsi.example");
    expect(text).not.toMatch(/@|\+380|бюджет|ідея|Задача/i);
  });

  it("з повною заявкою містить контакти, відповіді, терміни, опис і посилання, без цін", () => {
    const text = formatOrderMessage(
      {
        ...notice,
        name: "Іван",
        brief: {
          email: "ivan@example.com",
          phone: "@ivan_tg",
          idea: "Потрібен <сайт> для кав'ярні",
          deadline: "asap",
          details: { kind: "cabinet", integrations: "payments" },
          links: ["https://example.com/a"],
        },
      },
      "https://bonsi.example",
    );
    expect(text).toContain("Email: ivan@example.com");
    expect(text).toContain("Telegram / телефон: @ivan_tg");
    expect(text).toContain("Кабінет клієнта");
    expect(text).toContain("Якнайшвидше");
    expect(text).toContain("Задача: Потрібен &lt;сайт&gt; для кав'ярні");
    expect(text).toContain("https://example.com/a");
    expect(text).not.toMatch(/₴/);
  });

  it("не перевищує ліміт Telegram навіть з дуже довгим описом", () => {
    const text = formatOrderMessage({ ...notice, brief: { idea: "а".repeat(3000), links: ["https://example.com/" + "x".repeat(250)] } }, "https://bonsi.example");
    expect(text.length).toBeLessThan(4096);
  });
});

describe("надсилання", () => {
  const config = { token: "123456:SECRET-TOKEN", targets: [{ chatId: "1" }] };

  it("викликає sendMessage з chat id й HTML-режимом", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(new Response("{}", { status: 200 }));
    await sendTelegramMessage(config, { chatId: "42" }, "hi", fetchImpl as unknown as typeof fetch);
    const [url, init] = fetchImpl.mock.calls[0]!;
    expect(url).toBe("https://api.telegram.org/bot123456:SECRET-TOKEN/sendMessage");
    expect(JSON.parse((init as RequestInit).body as string)).toMatchObject({ chat_id: "42", text: "hi", parse_mode: "HTML" });
    expect(JSON.parse((init as RequestInit).body as string)).not.toHaveProperty("message_thread_id");
  });

  it("передає message_thread_id для гілки форум-групи", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(new Response("{}", { status: 200 }));
    await sendTelegramMessage(config, { chatId: "-1001234567890", threadId: 45 }, "hi", fetchImpl as unknown as typeof fetch);
    const [, init] = fetchImpl.mock.calls[0]!;
    expect(JSON.parse((init as RequestInit).body as string)).toMatchObject({
      chat_id: "-1001234567890",
      message_thread_id: 45,
    });
  });

  it("помилка не розкриває токен", async () => {
    const http = vi.fn().mockResolvedValue(new Response("{}", { status: 401 }));
    await expect(sendTelegramMessage(config, { chatId: "1" }, "x", http as unknown as typeof fetch)).rejects.toThrow(/HTTP 401/);
    await sendTelegramMessage(config, { chatId: "1" }, "x", http as unknown as typeof fetch).catch((e: Error) => {
      expect(e.message).not.toContain("SECRET-TOKEN");
    });

    const network = vi.fn().mockRejectedValue(new Error("connect to https://api.telegram.org/bot123456:SECRET-TOKEN failed"));
    await sendTelegramMessage(config, { chatId: "1" }, "x", network as unknown as typeof fetch).catch((e: Error) => {
      expect(e.message).not.toContain("SECRET-TOKEN");
    });
  });
});
