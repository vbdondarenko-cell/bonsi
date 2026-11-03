import { beforeEach, describe, expect, it, vi } from "vitest";

const { signInWithOtp, verifyOtp, signOut, rpc, throttle, isStaff, sessionStaff } = vi.hoisted(() => ({
  signInWithOtp: vi.fn(),
  verifyOtp: vi.fn(),
  signOut: vi.fn(),
  rpc: vi.fn(),
  throttle: vi.fn(),
  isStaff: vi.fn(),
  sessionStaff: vi.fn(),
}));

vi.mock("next/headers", () => ({ headers: async () => new Headers() }));
vi.mock("next/navigation", () => ({
  redirect: (url: string) => {
    throw new Error(`REDIRECT:${url}`);
  },
}));
vi.mock("@/lib/orders/service", () => ({ hashValue: (v: string) => `h:${v}` }));
vi.mock("@/lib/supabase/server", () => ({
  createSupabaseServerClient: async () => ({ auth: { signInWithOtp, verifyOtp, signOut }, rpc }),
}));
vi.mock("@/lib/supabase/service", () => ({ createSupabaseServiceClient: () => ({ rpc: throttle }) }));
vi.mock("@/lib/client/separation", () => ({ isStaffEmail: isStaff, sessionIsStaff: sessionStaff }));

import { requestCodeAction, verifyCodeAction } from "./actions";

const form = (values: Record<string, string>) => {
  const data = new FormData();
  for (const [k, v] of Object.entries(values)) data.set(k, v);
  return data;
};

describe("клієнтський вхід: розділення з адмінкою", () => {
  beforeEach(() => {
    for (const m of [signInWithOtp, verifyOtp, signOut, rpc, throttle, isStaff, sessionStaff]) m.mockReset();
    throttle.mockResolvedValue({ data: true, error: null });
    signInWithOtp.mockResolvedValue({ error: null });
    verifyOtp.mockResolvedValue({ error: null });
    isStaff.mockResolvedValue(false);
    sessionStaff.mockResolvedValue(false);
  });

  it("клієнту код надсилається", async () => {
    const result = await requestCodeAction(null, form({ email: "Client@Example.com" }));
    expect(signInWithOtp).toHaveBeenCalledWith(expect.objectContaining({ email: "client@example.com" }));
    expect(result).toMatchObject({ step: "code", email: "client@example.com" });
  });

  it("адресі адміністратора код НЕ надсилається, а відповідь не відрізняється від звичайної", async () => {
    isStaff.mockResolvedValue(true);
    const staff = await requestCodeAction(null, form({ email: "admin@bonsi.test" }));
    expect(signInWithOtp).not.toHaveBeenCalled();
    isStaff.mockResolvedValue(false);
    const client = await requestCodeAction(null, form({ email: "client@example.com" }));
    expect(staff).toMatchObject({ step: "code", notice: (client as { notice?: string }).notice });
  });

  it("якщо перевірити, чи це адміністратор, не вдалося — відмова, код не надсилається", async () => {
    isStaff.mockRejectedValue(new Error("staff_check_failed"));
    const result = await requestCodeAction(null, form({ email: "x@example.com" }));
    expect(signInWithOtp).not.toHaveBeenCalled();
    expect(result).toMatchObject({ step: "email", error: expect.stringContaining("недоступний") });
  });

  it("сесія адміністратора через клієнтський вхід закривається, кабінет не відкривається", async () => {
    sessionStaff.mockResolvedValue(true);
    const result = await verifyCodeAction(null, form({ email: "admin@bonsi.test", code: "123456" }));
    expect(signOut).toHaveBeenCalledTimes(1);
    expect(rpc).not.toHaveBeenCalled();
    expect(result).toMatchObject({ step: "code", error: expect.stringContaining("Код невірний") });
  });

  it("клієнт після коду потрапляє в кабінет, заявки прив'язуються", async () => {
    await expect(verifyCodeAction(null, form({ email: "client@example.com", code: "123456", next: "/app/projects" }))).rejects.toThrow("REDIRECT:/app/projects");
    expect(rpc).toHaveBeenCalledWith("client_claim_orders");
    expect(signOut).not.toHaveBeenCalled();
  });

  it("429 від Supabase Auth: людське повідомлення про ліміт, перехід до кроку коду не відбувається", async () => {
    signInWithOtp.mockResolvedValue({ error: { status: 429, code: "over_email_send_rate_limit" } });
    const result = await requestCodeAction(null, form({ email: "client@example.com" }));
    expect(result).toEqual({ step: "email", error: expect.stringContaining("Забагато спроб") });
  });

  it("збій доставки листа (SMTP/Send Email Hook повернув 5xx) → «недоступний», а не «код надіслано»", async () => {
    signInWithOtp.mockResolvedValue({ error: { status: 500, code: "unexpected_failure" } });
    const result = await requestCodeAction(null, form({ email: "client@example.com" }));
    expect(result).toEqual({ step: "email", error: expect.stringContaining("недоступний") });
  });

  it("повторне надсилання коду проходить той самий шлях і повертає крок коду без старої помилки", async () => {
    const first = await requestCodeAction(null, form({ email: "client@example.com" }));
    const again = await requestCodeAction(first, form({ email: "client@example.com" }));
    expect(again).toMatchObject({ step: "code", email: "client@example.com" });
    expect((again as { error?: string }).error).toBeUndefined();
    expect(signInWithOtp).toHaveBeenCalledTimes(2);
  });

  it("прострочений або використаний код: однакове повідомлення, сесія не створюється, заявки не прив'язуються", async () => {
    verifyOtp.mockResolvedValue({ error: { status: 403, code: "otp_expired" } });
    const result = await verifyCodeAction(null, form({ email: "client@example.com", code: "123456" }));
    expect(result).toMatchObject({ step: "code", error: expect.stringContaining("Код невірний або застарів") });
    expect(rpc).not.toHaveBeenCalled();
  });

  it("локальний ліміт спроб входу спрацьовує до звернення до Supabase", async () => {
    throttle.mockResolvedValue({ data: false, error: null });
    const result = await requestCodeAction(null, form({ email: "client@example.com" }));
    expect(signInWithOtp).not.toHaveBeenCalled();
    expect(result).toEqual({ step: "email", error: expect.stringContaining("Забагато спроб") });
  });
});
