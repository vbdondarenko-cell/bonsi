import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/notifications/dispatch", () => ({
  dispatchNotifications: vi.fn().mockResolvedValue({ disabled: false, claimed: 0, sent: 0, failed: 0 }),
}));

import { dispatchNotifications } from "@/lib/notifications/dispatch";
import { GET, POST } from "./route";

const SECRET = "s".repeat(32);
const req = (headers: Record<string, string> = {}, method = "POST") =>
  new Request("http://localhost/api/internal/notifications", { method, headers });

describe("/api/internal/notifications", () => {
  beforeEach(() => {
    vi.mocked(dispatchNotifications).mockClear();
    vi.stubEnv("CRON_SECRET", SECRET);
  });
  afterEach(() => vi.unstubAllEnvs());

  it("відхиляє запит без заголовка авторизації", async () => {
    expect((await POST(req())).status).toBe(401);
    expect(dispatchNotifications).not.toHaveBeenCalled();
  });

  it("відхиляє неправильний секрет", async () => {
    expect((await POST(req({ authorization: "Bearer wrong" }))).status).toBe(401);
    expect((await POST(req({ authorization: `Bearer ${"x".repeat(32)}` }))).status).toBe(401);
  });

  it("не працює, якщо CRON_SECRET не заданий або занадто короткий", async () => {
    vi.stubEnv("CRON_SECRET", "");
    expect((await POST(req({ authorization: "Bearer " }))).status).toBe(401);
    vi.stubEnv("CRON_SECRET", "short");
    expect((await POST(req({ authorization: "Bearer short" }))).status).toBe(401);
  });

  it("запускає доставку з правильним секретом (POST і GET)", async () => {
    const headers = { authorization: `Bearer ${SECRET}` };
    const post = await POST(req(headers));
    expect(post.status).toBe(200);
    expect(await post.json()).toMatchObject({ disabled: false });
    expect((await GET(req(headers, "GET"))).status).toBe(200);
    expect(dispatchNotifications).toHaveBeenCalledTimes(2);
  });

  it("повертає 500 без деталей, якщо доставка впала", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    vi.mocked(dispatchNotifications).mockRejectedValueOnce(new Error("db password=hunter2"));
    const response = await POST(req({ authorization: `Bearer ${SECRET}` }));
    expect(response.status).toBe(500);
    expect(JSON.stringify(await response.json())).not.toContain("hunter2");
  });
});
