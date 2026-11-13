import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  requireAdmin: vi.fn(),
  queueProjectEmail: vi.fn(),
  revalidatePath: vi.fn(),
}));

vi.mock("@/lib/admin/guard", () => ({ requireAdmin: mocks.requireAdmin }));
vi.mock("@/lib/email/events", () => ({ queueProjectEmail: mocks.queueProjectEmail, quarterHour: vi.fn() }));
vi.mock("next/cache", () => ({ revalidatePath: mocks.revalidatePath }));

import { paymentDecisionAction } from "./project-actions";

const projectId = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const paymentId = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const confirmedPaymentId = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";
const invoiceId = "dddddddd-dddd-4ddd-8ddd-dddddddddddd";

describe("paymentDecisionAction", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.queueProjectEmail.mockResolvedValue(true);

    const supabase = {
      from: vi.fn((table: string) => {
        let filteredPaymentId: unknown;
        const query = {
          select: vi.fn(() => query),
          eq: vi.fn((column: string, value: unknown) => {
            if (table === "payments" && column === "id") filteredPaymentId = value;
            return query;
          }),
          order: vi.fn(() => query),
          limit: vi.fn(() => query),
          maybeSingle: vi.fn(async () => {
            if (table === "invoices") return { data: { number: "INV-42" }, error: null };
            if (filteredPaymentId === confirmedPaymentId) {
              return {
                data: { id: confirmedPaymentId, amount: 125, currency: "USD", status: "confirmed", invoice_id: invoiceId, project_id: projectId },
                error: null,
              };
            }
            return { data: { project_id: projectId, invoice_id: invoiceId }, error: null };
          }),
        };
        return query;
      }),
      rpc: vi.fn(async () => ({ data: confirmedPaymentId, error: null })),
    };
    mocks.requireAdmin.mockResolvedValue({ supabase });
  });

  it("queues the event for the newly inserted confirmed payment when the amount changes", async () => {
    const form = new FormData();
    form.set("paymentId", paymentId);
    form.set("projectId", "eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee");
    form.set("op", "confirm");
    form.set("amount", "125");
    form.set("note", "Actual amount received");

    const result = await paymentDecisionAction({}, form);

    expect(result).toMatchObject({ ok: true });
    expect(mocks.queueProjectEmail).toHaveBeenCalledWith({
      projectId,
      template: "payment_confirmed",
      key: `payment-confirmed:${confirmedPaymentId}`,
      payload: { number: "INV-42", amount: 125, currency: "USD" },
    });
  });
});
