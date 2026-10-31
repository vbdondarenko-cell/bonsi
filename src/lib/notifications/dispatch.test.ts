import { describe, expect, it, vi } from "vitest";
import { dispatchNotifications } from "./dispatch";

const env = { TELEGRAM_BOT_TOKEN: "123:abc", TELEGRAM_CHAT_IDS: "1,2" } as unknown as NodeJS.ProcessEnv;

const row = {
  outbox_id: 5,
  attempts: 1,
  order_id: "0b0b0b0b-0b0b-4b0b-8b0b-0b0b0b0b0b0b",
  ticket_number: "BON-2026-00001",
  service: "landing",
  name: "Іван",
  created_at: "2026-10-31T10:00:00Z",
};

function fakeDb(rows: unknown[]) {
  const rpc = vi.fn(async (fn: string) => {
    if (fn === "claim_notifications") return { data: rows, error: null };
    return { data: null, error: null };
  });
  return { rpc };
}

describe("dispatchNotifications", () => {
  it("нічого не робить і не звертається до бази, коли інтеграція вимкнена", async () => {
    const db = fakeDb([row]);
    const result = await dispatchNotifications({ db, env: {} as NodeJS.ProcessEnv });
    expect(result).toEqual({ disabled: true, claimed: 0, sent: 0, failed: 0 });
    expect(db.rpc).not.toHaveBeenCalled();
  });

  it("надсилає в усі чати й позначає запис як доставлений", async () => {
    const db = fakeDb([row]);
    const fetchImpl = vi.fn().mockResolvedValue(new Response("{}", { status: 200 }));
    const result = await dispatchNotifications({ db, env, fetchImpl: fetchImpl as unknown as typeof fetch });
    expect(fetchImpl).toHaveBeenCalledTimes(2);
    expect(result).toEqual({ disabled: false, claimed: 1, sent: 1, failed: 0 });
    expect(db.rpc).toHaveBeenCalledWith("complete_notification", { p_id: 5, p_error: null });
  });

  it("при помилці повертає запис у чергу з текстом помилки без токена", async () => {
    const db = fakeDb([row]);
    const fetchImpl = vi.fn().mockResolvedValue(new Response("{}", { status: 502 }));
    const result = await dispatchNotifications({ db, env, fetchImpl: fetchImpl as unknown as typeof fetch });
    expect(result).toMatchObject({ claimed: 1, sent: 0, failed: 1 });
    const call = db.rpc.mock.calls.find(([fn]) => fn === "complete_notification")!;
    expect((call[1] as { p_error: string }).p_error).toBe("telegram: HTTP 502");
  });

  it("одне невдале повідомлення не блокує інші", async () => {
    const db = fakeDb([row, { ...row, outbox_id: 6 }]);
    const fetchImpl = vi
      .fn()
      .mockResolvedValueOnce(new Response("{}", { status: 500 }))
      .mockResolvedValue(new Response("{}", { status: 200 }));
    const result = await dispatchNotifications({ db, env, fetchImpl: fetchImpl as unknown as typeof fetch });
    expect(result).toMatchObject({ claimed: 2, sent: 1, failed: 1 });
  });

  it("помилка claim піднімається, а не ковтається", async () => {
    const db = { rpc: vi.fn().mockResolvedValue({ data: null, error: { message: "boom" } }) };
    await expect(dispatchNotifications({ db, env })).rejects.toThrow(/claim_notifications: boom/);
  });
});
