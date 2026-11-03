import { describe, expect, it } from "vitest";
import { newerOrderSnapshot, type OrderSnapshot } from "./order-snapshot";

const snapshot = (revision: number, status: string, id = "order-a"): OrderSnapshot => ({
  id, status, assigned_to: null, order_notes: [],
  order_events: [{ id: revision, actor_id: "admin", type: "status_changed", data: {}, created_at: "2026-11-03T00:00:00Z" }],
});

describe("confirmed order state", () => {
  it("ignores a delayed action/RSC response after a newer status has been confirmed", () => {
    const current = snapshot(22, "done");
    expect(newerOrderSnapshot(current, snapshot(21, "in_progress"))).toBe(current);
    expect(newerOrderSnapshot(current, snapshot(22, "done"))).toBe(current);
    expect(newerOrderSnapshot(current, snapshot(23, "in_review")).status).toBe("in_review");
  });
  it("does not apply a response belonging to another order", () => {
    const current = snapshot(22, "done");
    expect(newerOrderSnapshot(current, snapshot(99, "new", "order-b"))).toBe(current);
  });
});
