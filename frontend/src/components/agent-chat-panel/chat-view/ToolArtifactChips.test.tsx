import { Children, isValidElement, type ReactNode } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  openThreadFilePreview: vi.fn(),
  openFsPath: vi.fn(),
  revealFsPath: vi.fn(),
}));

vi.mock("@/zorai/features/threads/ThreadFilePreviewContext", () => ({
  useThreadFilePreview: () => ({
    previewTarget: null,
    openThreadFilePreview: mocks.openThreadFilePreview,
    closeThreadFilePreview: vi.fn(),
  }),
}));

vi.mock("@/lib/bridge", () => ({
  getBridge: () => ({
    openFsPath: mocks.openFsPath,
    revealFsPath: mocks.revealFsPath,
  }),
}));

import { ToolArtifactChips } from "./ToolArtifactChips";

function elementText(node: ReactNode): string {
  if (node == null || typeof node === "boolean") return "";
  if (typeof node === "string" || typeof node === "number") return String(node);
  if (Array.isArray(node)) return node.map(elementText).join("");
  if (!isValidElement(node)) return "";
  return elementText(node.props.children);
}

function findButton(node: ReactNode, label: string): any {
  if (node == null || typeof node === "boolean" || typeof node === "string" || typeof node === "number") return null;
  if (Array.isArray(node)) {
    for (const child of node) {
      const found = findButton(child, label);
      if (found) return found;
    }
    return null;
  }
  if (!isValidElement(node)) return null;
  if (node.type === "button" && elementText(node.props.children) === label) return node;
  for (const child of Children.toArray(node.props.children)) {
    const found = findButton(child, label);
    if (found) return found;
  }
  return null;
}

describe("ToolArtifactChips actions", () => {
  beforeEach(() => {
    mocks.openThreadFilePreview.mockReset();
    mocks.openFsPath.mockReset();
    mocks.revealFsPath.mockReset();
  });

  it("opens local tool artifacts in the custom preview while Reveal stays native", async () => {
    const path = "/mnt/e/gitlab/it/zorai/frontend/src/zorai/features/threads/openThreadTarget.test.ts";
    const tree = ToolArtifactChips({
      artifacts: [{ path, provenance: "argument" }],
      createdAt: 42,
    });
    const openButton = findButton(tree, "Open");
    const revealButton = findButton(tree, "Reveal");

    expect(openButton).toBeTruthy();
    expect(revealButton).toBeTruthy();

    await openButton.props.onClick({ stopPropagation: vi.fn() });

    expect(mocks.openThreadFilePreview).toHaveBeenCalledWith({
      path,
      kind: "artifact",
      source: "tool-argument",
      isText: true,
      updatedAt: 42,
    });
    expect(mocks.openFsPath).not.toHaveBeenCalled();

    await revealButton.props.onClick({ stopPropagation: vi.fn() });

    expect(mocks.revealFsPath).toHaveBeenCalledWith(path);
  });
});
