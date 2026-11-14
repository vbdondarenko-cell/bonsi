import { beforeEach, describe, expect, it, vi } from "vitest";

const { rpcMock } = vi.hoisted(() => ({ rpcMock: vi.fn() }));

vi.mock("@supabase/supabase-js", () => ({
  createClient: vi.fn(() => ({ rpc: rpcMock })),
}));

import { createOrder } from "./service";

describe("createOrder", () => {
  beforeEach(() => {
    vi.stubEnv("SUPABASE_URL", "https://bonsi.example");
    vi.stubEnv("SUPABASE_SERVICE_ROLE_KEY", "test-service-role-key");
    rpcMock.mockReset().mockResolvedValue({ data: "BON-2026-00001", error: null });
  });

  it("передає null для необов'язкового email у SQL RPC", async () => {
    const result = await createOrder(
      {
        service: "landing",
        name: "Клієнт",
        phone: "@bonsi_client",
        email: undefined,
        consent: true,
        startedAt: Date.now() - 10_000,
      },
      { ipBucket: null, userAgent: "vitest" },
    );

    expect(result).toEqual({ ticket: "BON-2026-00001" });
    expect(rpcMock).toHaveBeenCalledWith("create_order_v2", expect.objectContaining({ p_email: null }));
  });
});
