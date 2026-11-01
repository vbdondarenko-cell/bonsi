import { beforeEach, describe, expect, it, vi } from "vitest";

const rpc = vi.fn();
const signUp = vi.fn();

vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("next/navigation", () => ({ redirect: vi.fn() }));
vi.mock("@/lib/admin/guard", () => ({ getAuthState: vi.fn(), requireAdmin: vi.fn() }));
vi.mock("@/lib/supabase/service", () => ({ createSupabaseServiceClient: () => ({ rpc }) }));
vi.mock("@/lib/supabase/server", () => ({ createSupabaseServerClient: async () => ({ auth: { signUp } }) }));

import { registerAction } from "./actions";

function form(values: Record<string, string>) {
  const data = new FormData();
  for (const [key, value] of Object.entries(values)) data.set(key, value);
  return data;
}

const valid = { email: "  Founder@Bonsi.Test ", password: "correct-horse-battery", confirm: "correct-horse-battery" };

describe("registerAction (закрита реєстрація адмінів)", () => {
  beforeEach(() => {
    rpc.mockReset();
    signUp.mockReset();
    vi.stubEnv("NEXT_PUBLIC_SITE_URL", "https://bonsi.example/");
  });

  it("відхиляє короткий пароль і не звертається до Supabase", async () => {
    const result = await registerAction(null, form({ ...valid, password: "short", confirm: "short" }));
    expect(result?.fieldError).toMatch(/12 символів/);
    expect(rpc).not.toHaveBeenCalled();
    expect(signUp).not.toHaveBeenCalled();
  });

  it("відхиляє різні паролі", async () => {
    const result = await registerAction(null, form({ ...valid, confirm: "something-else-entirely" }));
    expect(result?.fieldError).toMatch(/не збігаються/);
    expect(signUp).not.toHaveBeenCalled();
  });

  it("незапрошена адреса: та сама відповідь, але акаунт не створюється", async () => {
    rpc.mockResolvedValue({ data: false, error: null });
    const result = await registerAction(null, form(valid));
    expect(result?.ok).toBe(true);
    expect(result?.notice).toMatch(/Якщо цю адресу запрошено/);
    expect(signUp).not.toHaveBeenCalled();
  });

  it("запрошена адреса: signUp з нормалізованим email і посиланням на вхід", async () => {
    rpc.mockResolvedValue({ data: true, error: null });
    signUp.mockResolvedValue({ error: null });
    const result = await registerAction(null, form(valid));
    expect(rpc).toHaveBeenCalledWith("admin_invite_exists", { p_email: "founder@bonsi.test" });
    expect(signUp).toHaveBeenCalledWith({
      email: "founder@bonsi.test",
      password: valid.password,
      options: { emailRedirectTo: "https://bonsi.example/admin/login" },
    });
    expect(result?.ok).toBe(true);
  });

  it("помилка signUp не видає зайвого й не повертає успіх", async () => {
    rpc.mockResolvedValue({ data: true, error: null });
    signUp.mockResolvedValue({ error: { message: "Password is known to be weak" } });
    const result = await registerAction(null, form(valid));
    expect(result?.ok).toBeUndefined();
    expect(result?.error).not.toMatch(/weak/i);
  });

  it("помилка перевірки запрошення не створює акаунта", async () => {
    rpc.mockResolvedValue({ data: null, error: { message: "boom" } });
    const result = await registerAction(null, form(valid));
    expect(result?.error).toBeDefined();
    expect(signUp).not.toHaveBeenCalled();
  });
});
