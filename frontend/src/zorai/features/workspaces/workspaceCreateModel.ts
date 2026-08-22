import type { WorkspaceOperator } from "@/lib/workspaceBoard";

export type WorkspaceCreateDraft = {
  workspaceId: string;
  operator: WorkspaceOperator;
};

export type WorkspaceCreateRequest = {
  workspaceId: string;
  operator: WorkspaceOperator;
};

export function emptyWorkspaceCreateDraft(): WorkspaceCreateDraft {
  return { workspaceId: "", operator: "user" };
}

export function parseWorkspaceCreateDraft(
  draft: WorkspaceCreateDraft,
): { ok: true; request: WorkspaceCreateRequest } | { ok: false; error: string } {
  const workspaceId = draft.workspaceId.trim();
  if (!workspaceId) {
    return { ok: false, error: "Workspace name is required" };
  }
  return {
    ok: true,
    request: {
      workspaceId,
      operator: draft.operator === "svarog" ? "svarog" : "user",
    },
  };
}
