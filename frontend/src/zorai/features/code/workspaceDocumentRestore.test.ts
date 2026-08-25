import { describe, expect, it } from "vitest";
import { shouldRestoreWorkspaceDocument } from "./workspaceDocumentRestore";

describe("shouldRestoreWorkspaceDocument", () => {
  it("reloads a persisted tab whose contents were not kept in memory across a window restart", () => {
    expect(shouldRestoreWorkspaceDocument("README.md", {})).toBe(true);
  });

  it("does not refetch a tab that already has a document after the explorer opened it", () => {
    expect(shouldRestoreWorkspaceDocument("README.md", { "README.md": { content: "# hi" } })).toBe(false);
    expect(shouldRestoreWorkspaceDocument(null, {})).toBe(false);
  });
});
