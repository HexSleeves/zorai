import { describe, expect, it } from "vitest";
import { displayRootName } from "./codeEmptyStateModel";
import type { CodeOpenWorkspaceBoundary } from "./CodeView";

const sampleRoot = {
  root: "/work/a",
  name: "a",
  gitRoot: null,
  isGitRepository: false,
} as const;

describe("CodeView pure helpers", () => {
  it("derives a display name from the canonical root path", () => {
    expect(displayRootName("/work/example")).toBe("example");
    expect(displayRootName("C:\\work\\app")).toBe("app");
    expect(displayRootName("/mnt/e/gitlab/it/zorai/src")).toBe("src");
  });

  it("falls back for null and empty roots", () => {
    expect(displayRootName(null)).toBe("No repository open.");
    expect(displayRootName("   ")).toBe("No repository open.");
  });

  it("keeps the GLM lifecycle boundary typed and callable", () => {
    const boundary: CodeOpenWorkspaceBoundary = (root, source) => {
      expect(root.root).toBe("/work/a");
      expect(source).toMatch(/^(picker|manual)$/);
    };
    boundary(sampleRoot, "picker");
  });
});
