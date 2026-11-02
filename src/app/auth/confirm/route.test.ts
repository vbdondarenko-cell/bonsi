import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

const { verifyOtp, signOut, rpc, sessionStaff } = vi.hoisted(() => ({ verifyOtp: vi.fn(), signOut: vi.fn(), rpc: vi.fn(), sessionStaff: vi.fn() }));
vi.mock("@/lib/supabase/server", () => ({ createSupabaseServerClient: async () => ({ auth: { verifyOtp, signOut }, rpc }) }));
vi.mock("@/lib/client/separation", () => ({ sessionIsStaff: sessionStaff }));

import { GET } from "./route";

const call = (query = "token_hash=abc&type=email") => GET(new NextRequest(`http://localhost/auth/confirm?${query}`));

describe("GET /auth/confirm: розділення з адмінкою", () => {
  beforeEach(() => {
    for (const m of [verifyOtp, signOut, rpc, sessionStaff]) m.mockReset();
    verifyOtp.mockResolvedValue({ error: null });
    sessionStaff.mockResolvedValue(false);
  });
  it("клієнт потрапляє в кабінет", async () => {
    const res = await call("token_hash=abc&type=email&next=/app/projects");
    expect(res.headers.get("location")).toBe("http://localhost/app/projects");
    expect(rpc).toHaveBeenCalledWith("client_claim_orders");
  });
  it("адміністратор за посиланням не входить: сесію закрито, повернення на /login", async () => {
    sessionStaff.mockResolvedValue(true);
    const res = await call();
    expect(signOut).toHaveBeenCalledTimes(1);
    expect(res.headers.get("location")).toBe("http://localhost/login?error=link");
    expect(rpc).not.toHaveBeenCalled();
  });
  it("недійсний токен — на /login", async () => {
    verifyOtp.mockResolvedValue({ error: { message: "x" } });
    expect((await call()).headers.get("location")).toContain("/login?error=link");
  });
});
