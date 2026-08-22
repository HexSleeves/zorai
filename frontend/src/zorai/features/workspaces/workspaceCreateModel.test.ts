import { describe, expect, it } from "vitest";
import { emptyWorkspaceCreateDraft, parseWorkspaceCreateDraft } from "./workspaceCreateModel";

describe("workspace create draft", () => {
  it("rejects an empty name because the daemon keys settings by workspace id", () => {
    expect(parseWorkspaceCreateDraft(emptyWorkspaceCreateDraft())).toEqual({
      ok: false,
      error: "Workspace name is required",
    });
    expect(parseWorkspaceCreateDraft({ workspaceId: "   ", operator: "svarog" })).toEqual({
      ok: false,
      error: "Workspace name is required",
    });
  });

  it("trims the name and keeps the TUI operator choice", () => {
    expect(parseWorkspaceCreateDraft({ workspaceId: "  client-a  ", operator: "svarog" })).toEqual({
      ok: true,
      request: { workspaceId: "client-a", operator: "svarog" },
    });
    expect(parseWorkspaceCreateDraft({ workspaceId: "ops", operator: "user" })).toEqual({
      ok: true,
      request: { workspaceId: "ops", operator: "user" },
    });
  });
});
