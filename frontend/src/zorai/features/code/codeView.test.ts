import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { displayRootName } from "./codeEmptyStateModel";
import type { CodeOpenWorkspaceBoundary } from "./CodeView";

function readSource(relativePath: string): string {
  return readFileSync(new URL(relativePath, import.meta.url), "utf8");
}

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

describe("CodeView controller stability contract", () => {
  const source = readSource("./CodeView.tsx");
  const emptyStateSource = readSource("./CodeEmptyState.tsx");

  it("uses a stable module-level default for onOpenWorkspace instead of an inline arrow", () => {
    expect(source).toContain("const NOOP_OPEN_WORKSPACE");
    expect(source).toContain("onOpenWorkspace = NOOP_OPEN_WORKSPACE");
    expect(source).not.toContain("onOpenWorkspace = () => {}");
  });

  it("stabilizes handleRootSelected with useCallback so parent rerenders reuse the controller", () => {
    expect(source).toContain("useCallback");
    expect(source).toContain("const handleRootSelected = useCallback");
    expect(source).toContain("onRootSelected={handleRootSelected}");
    expect(source).toContain("onOpenWorkspace(root, source)");
  });

  it("keeps the secure nested picker envelope by passing through only validated roots", () => {
    expect(source).toContain("setLastRoot(root.root)");
    expect(source).toContain("setBoundRoot(root.root)");
    expect(emptyStateSource).toContain("onRootSelected");
    expect(emptyStateSource).toContain("createMemoizedCodeEmptyStateController");
    expect(emptyStateSource).toContain("NOOP_ROOT_SELECTED");
  });
});
