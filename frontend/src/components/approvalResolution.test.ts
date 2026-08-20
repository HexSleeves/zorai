import { describe, expect, it, vi } from "vitest";
import type { ApprovalRequest } from "@/lib/agentMissionStore";
import { resolveApprovalAtSource, shouldBypassApprovalPrompt } from "./approvalResolution";

function approval(source: ApprovalRequest["source"]): ApprovalRequest {
  return {
    id: "approval-1",
    createdAt: 1,
    paneId: "pane_1",
    workspaceId: null,
    surfaceId: null,
    sessionId: "thread-1",
    source,
    command: "cargo test",
    reasons: ["network"],
    riskLevel: "high",
    blastRadius: "workspace",
    status: "pending",
    handledAt: null,
  };
}

describe("approval source routing", () => {
  it("routes agent task approvals without touching a pane terminal bridge", async () => {
    const resolveManagedApproval = vi.fn();
    const agentResolveTaskApproval = vi.fn().mockResolvedValue({ ok: true });

    await expect(resolveApprovalAtSource(
      { resolveManagedApproval, agentResolveTaskApproval },
      approval("agent-task"),
      "approved-once",
    )).resolves.toBe(true);

    expect(agentResolveTaskApproval).toHaveBeenCalledWith("approval-1", "approve-once");
    expect(resolveManagedApproval).not.toHaveBeenCalled();
  });

  it("routes terminal bridge approvals to their pane bridge", async () => {
    const resolveManagedApproval = vi.fn().mockResolvedValue(true);
    const agentResolveTaskApproval = vi.fn();

    await expect(resolveApprovalAtSource(
      { resolveManagedApproval, agentResolveTaskApproval },
      approval("terminal-bridge"),
      "denied",
    )).resolves.toBe(true);

    expect(resolveManagedApproval).toHaveBeenCalledWith("pane_1", "approval-1", "deny");
    expect(agentResolveTaskApproval).not.toHaveBeenCalled();
  });

  it("keeps local terminal approvals local", async () => {
    const resolveManagedApproval = vi.fn();
    const agentResolveTaskApproval = vi.fn();

    await expect(resolveApprovalAtSource(
      { resolveManagedApproval, agentResolveTaskApproval },
      approval("local-terminal"),
      "approved-session",
    )).resolves.toBe(true);

    expect(resolveManagedApproval).not.toHaveBeenCalled();
    expect(agentResolveTaskApproval).not.toHaveBeenCalled();
  });
});

describe("YOLO approval suppression", () => {
  it("suppresses daemon task approvals under managed YOLO", () => {
    expect(shouldBypassApprovalPrompt(approval("agent-task"), "moderate", "yolo")).toBe(true);
  });

  it("suppresses terminal approvals under terminal YOLO", () => {
    expect(shouldBypassApprovalPrompt(approval("terminal-bridge"), "yolo", "moderate")).toBe(true);
  });

  it("does not suppress approvals from the unrelated policy domain", () => {
    expect(shouldBypassApprovalPrompt(approval("agent-task"), "yolo", "moderate")).toBe(false);
    expect(shouldBypassApprovalPrompt(approval("terminal-bridge"), "moderate", "yolo")).toBe(false);
  });
});
