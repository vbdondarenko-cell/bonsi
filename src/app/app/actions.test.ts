import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  requireClient: vi.fn(),
  queueProjectEmail: vi.fn(),
  revalidatePath: vi.fn(),
}));

vi.mock("@/lib/client/auth", () => ({ requireClient: mocks.requireClient }));
vi.mock("@/lib/email/events", () => ({ queueProjectEmail: mocks.queueProjectEmail }));
vi.mock("next/cache", () => ({ revalidatePath: mocks.revalidatePath }));

import { decideDeliverableAction, decideProposalAction } from "./actions";

const ownProjectId = "10000000-0000-4000-8000-000000000001";
const otherProjectId = "20000000-0000-4000-8000-000000000002";
const ownProposalId = "30000000-0000-4000-8000-000000000003";
const foreignProposalId = "40000000-0000-4000-8000-000000000004";
const ownDeliverableId = "50000000-0000-4000-8000-000000000005";
const foreignDeliverableId = "60000000-0000-4000-8000-000000000006";

function form(values: Record<string, string>) {
  const data = new FormData();
  for (const [key, value] of Object.entries(values)) data.set(key, value);
  return data;
}

function client(options: {
  records?: Record<string, { project_id: string } | null>;
  readError?: { message: string } | null;
  rpc?: (...args: unknown[]) => Promise<{ error: { message: string } | null }>;
} = {}) {
  const from = vi.fn((table: string) => {
    const query = {
      select: vi.fn(() => query),
      eq: vi.fn(() => query),
      maybeSingle: vi.fn(async () => ({ data: options.records?.[table] ?? null, error: options.readError ?? null })),
    };
    return query;
  });
  const rpc = vi.fn(options.rpc ?? (async () => ({ error: null })));
  return { from, rpc };
}

describe("client decisions and notification target", () => {
  beforeEach(() => {
    mocks.requireClient.mockReset();
    mocks.queueProjectEmail.mockReset().mockResolvedValue(true);
    mocks.revalidatePath.mockReset();
  });

  it("uses the RLS-visible proposal association and ignores a forged projectId", async () => {
    const supabase = client({ records: { proposals: { project_id: ownProjectId } } });
    mocks.requireClient.mockResolvedValue({ supabase });

    const result = await decideProposalAction(null, form({
      proposalId: ownProposalId,
      projectId: otherProjectId,
      decision: "approved",
    }));

    expect(result?.ok).toBe(true);
    expect(supabase.rpc).toHaveBeenCalledWith("client_decide_proposal", {
      p_proposal: ownProposalId,
      p_decision: "approved",
      p_comment: null,
    });
    expect(mocks.queueProjectEmail).toHaveBeenCalledWith({
      projectId: ownProjectId,
      template: "proposal_decision",
      key: `proposal-decision:${ownProposalId}`,
    });
    expect(mocks.revalidatePath).toHaveBeenCalledWith(`/app/projects/${ownProjectId}`, "layout");
    expect(mocks.queueProjectEmail).not.toHaveBeenCalledWith(expect.objectContaining({ projectId: otherProjectId }));
  });

  it("does not decide or queue for a proposal that is not visible under RLS", async () => {
    const supabase = client();
    mocks.requireClient.mockResolvedValue({ supabase });

    const result = await decideProposalAction(null, form({ proposalId: foreignProposalId, decision: "approved" }));

    expect(result?.error).toMatch(/Немає доступу/);
    expect(supabase.rpc).not.toHaveBeenCalled();
    expect(mocks.queueProjectEmail).not.toHaveBeenCalled();
  });

  it("does not queue a proposal email when the database decision fails", async () => {
    const supabase = client({
      records: { proposals: { project_id: ownProjectId } },
      rpc: async () => ({ error: { message: "not_pending" } }),
    });
    mocks.requireClient.mockResolvedValue({ supabase });

    const result = await decideProposalAction(null, form({ proposalId: ownProposalId, decision: "approved" }));

    expect(result?.error).toBeTruthy();
    expect(mocks.queueProjectEmail).not.toHaveBeenCalled();
    expect(mocks.revalidatePath).not.toHaveBeenCalled();
  });

  it("does not use a proposal association when the RLS read fails", async () => {
    const supabase = client({ readError: { message: "database unavailable" } });
    mocks.requireClient.mockResolvedValue({ supabase });

    const result = await decideProposalAction(null, form({ proposalId: ownProposalId, decision: "approved" }));

    expect(result?.error).toBeTruthy();
    expect(supabase.rpc).not.toHaveBeenCalled();
    expect(mocks.queueProjectEmail).not.toHaveBeenCalled();
  });

  it("resolves deliverable notifications from the deliverable row, not form data", async () => {
    const supabase = client({ records: { deliverables: { project_id: ownProjectId } } });
    mocks.requireClient.mockResolvedValue({ supabase });

    const result = await decideDeliverableAction(null, form({
      deliverableId: ownDeliverableId,
      projectId: otherProjectId,
      decision: "approved",
    }));

    expect(result?.ok).toBe(true);
    expect(supabase.from).toHaveBeenCalledWith("deliverables");
    expect(mocks.queueProjectEmail).toHaveBeenCalledWith({
      projectId: ownProjectId,
      template: "deliverable_decision",
      key: `deliverable-decision:${ownDeliverableId}`,
    });
    expect(mocks.revalidatePath).toHaveBeenCalledWith(`/app/projects/${ownProjectId}`, "layout");
    expect(mocks.queueProjectEmail).not.toHaveBeenCalledWith(expect.objectContaining({ projectId: otherProjectId }));
  });

  it("does not decide or queue for a deliverable that is not visible under RLS", async () => {
    const supabase = client();
    mocks.requireClient.mockResolvedValue({ supabase });

    const result = await decideDeliverableAction(null, form({ deliverableId: foreignDeliverableId, decision: "approved" }));

    expect(result?.error).toMatch(/Немає доступу/);
    expect(supabase.rpc).not.toHaveBeenCalled();
    expect(mocks.queueProjectEmail).not.toHaveBeenCalled();
  });

  it("does not queue a deliverable email when the database decision fails", async () => {
    const supabase = client({
      records: { deliverables: { project_id: ownProjectId } },
      rpc: async () => ({ error: { message: "not_pending" } }),
    });
    mocks.requireClient.mockResolvedValue({ supabase });

    const result = await decideDeliverableAction(null, form({ deliverableId: ownDeliverableId, decision: "approved" }));

    expect(result?.error).toBeTruthy();
    expect(mocks.queueProjectEmail).not.toHaveBeenCalled();
    expect(mocks.revalidatePath).not.toHaveBeenCalled();
  });

  it("rejects malformed or missing IDs before auth, database, or email access", async () => {
    const badProposal = await decideProposalAction(null, form({ proposalId: "bad", decision: "approved" }));
    const missingDeliverable = await decideDeliverableAction(null, form({ decision: "approved" }));

    expect(badProposal?.error).toBeTruthy();
    expect(missingDeliverable?.error).toBeTruthy();
    expect(mocks.requireClient).not.toHaveBeenCalled();
    expect(mocks.queueProjectEmail).not.toHaveBeenCalled();
  });

  it("does not queue duplicate notifications after an already-recorded decision", async () => {
    let calls = 0;
    const supabase = client({
      records: { proposals: { project_id: ownProjectId } },
      rpc: async () => ({ error: calls++ === 0 ? null : { message: "not_pending" } }),
    });
    mocks.requireClient.mockResolvedValue({ supabase });
    const input = form({ proposalId: ownProposalId, decision: "approved" });

    await decideProposalAction(null, input);
    const repeated = await decideProposalAction(null, input);

    expect(repeated?.error).toBeTruthy();
    expect(supabase.rpc).toHaveBeenCalledTimes(2);
    expect(mocks.queueProjectEmail).toHaveBeenCalledTimes(1);
  });

  it("serializes concurrent deliverable decisions through the database and queues one event", async () => {
    let calls = 0;
    const supabase = client({
      records: { deliverables: { project_id: ownProjectId } },
      rpc: async () => {
        const call = calls++;
        await Promise.resolve();
        return { error: call === 0 ? null : { message: "not_pending" } };
      },
    });
    mocks.requireClient.mockResolvedValue({ supabase });
    const input = form({ deliverableId: ownDeliverableId, decision: "approved" });

    const results = await Promise.all([
      decideDeliverableAction(null, input),
      decideDeliverableAction(null, input),
    ]);

    expect(results.filter((result) => result?.ok)).toHaveLength(1);
    expect(supabase.rpc).toHaveBeenCalledTimes(2);
    expect(mocks.queueProjectEmail).toHaveBeenCalledTimes(1);
    expect(mocks.queueProjectEmail).toHaveBeenCalledWith(expect.objectContaining({ projectId: ownProjectId }));
  });

  it("rejects anonymous calls before database or email access", async () => {
    mocks.requireClient.mockRejectedValue(new Error("redirect:/login"));

    await expect(decideProposalAction(null, form({ proposalId: ownProposalId, decision: "approved" }))).rejects.toThrow("redirect:/login");

    expect(mocks.queueProjectEmail).not.toHaveBeenCalled();
  });
});
