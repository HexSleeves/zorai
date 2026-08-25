import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { WorkspacePathDialog } from "./WorkspacePathDialog";
import { submitWorkspacePath } from "./workspacePathSubmission";

describe("WorkspacePathDialog", () => {
  it.each([
    ["file", "Create file", "src/components/NewFile.tsx"],
    ["directory", "Create folder", "src/components"],
    ["rename", "Rename path", "src/old.ts"],
  ] as const)("renders the %s workflow inside an accessible modal", (operation, label, initialPath) => {
    const html = renderToStaticMarkup(<WorkspacePathDialog operation={operation} initialPath={initialPath} onSubmit={() => undefined} onClose={() => undefined} />);

    expect(html).toContain('role="dialog"');
    expect(html).toContain('aria-modal="true"');
    expect(html).toContain(label);
    expect(html).toContain(`value="${initialPath}"`);
  });

  it("exposes errors and disables submission while busy", () => {
    const html = renderToStaticMarkup(<WorkspacePathDialog operation="file" initialPath="a.ts" busy error="Path already exists" onSubmit={() => undefined} onClose={() => undefined} />);

    expect(html).toContain('role="alert"');
    expect(html).toContain("Path already exists");
    expect(html).toContain("Working…");
    expect(html.match(/disabled/g)?.length).toBeGreaterThanOrEqual(3);
  });

  it("submits the trimmed rendered-dialog value through the creation callback", async () => {
    const createAndRefresh = vi.fn(async () => undefined);

    await expect(submitWorkspacePath("  src/new.ts  ", false, createAndRefresh)).resolves.toBe(true);

    expect(createAndRefresh).toHaveBeenCalledOnce();
    expect(createAndRefresh).toHaveBeenCalledWith("src/new.ts");
  });

  it("does not submit an empty or busy dialog", async () => {
    const createAndRefresh = vi.fn(async () => undefined);
    expect(await submitWorkspacePath("   ", false, createAndRefresh)).toBe(false);
    expect(await submitWorkspacePath("src/new.ts", true, createAndRefresh)).toBe(false);
    expect(createAndRefresh).not.toHaveBeenCalled();
  });

  it("renders a native form so Enter submits without a browser prompt", () => {
    const html = renderToStaticMarkup(<WorkspacePathDialog operation="file" initialPath="src/new.ts" onSubmit={() => undefined} onClose={() => undefined} />);

    expect(html).toContain("<form");
    expect(html).toContain('type="submit"');
    expect(html).not.toContain("window.prompt");
  });

  it("blocks submission while the mutation is in flight and reports rejection to the caller", async () => {
    const submitted: string[] = [];
    const onSubmit = async (path: string) => {
      submitted.push(path);
      throw new Error("create rejected");
    };

    await expect(submitWorkspacePath("src/new.ts", true, onSubmit)).resolves.toBe(false);
    await expect(submitWorkspacePath("  src/new.ts  ", false, onSubmit)).rejects.toThrow("create rejected");
    expect(submitted).toEqual(["src/new.ts"]);
  });
});
