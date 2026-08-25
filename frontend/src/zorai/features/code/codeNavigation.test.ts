import { describe, expect, it } from "vitest";
import {
  contextPanelLabels,
  getDefaultZoraiView,
  normalizeZoraiToolNavigation,
  zoraiNavItems,
} from "../../shell/navigation";
import { getDefaultZoraiTool, zoraiTools } from "../tools/tools";

describe("Code navigation contracts", () => {
  it("places Code directly above Threads in the global rail", () => {
    expect(zoraiNavItems.slice(0, 2).map((item) => item.id)).toEqual(["code", "threads"]);
  });

  it("keeps Threads as the startup default view", () => {
    expect(getDefaultZoraiView()).toBe("threads");
  });

  it("removes the duplicate Workspace tool entry from Tools", () => {
    expect(zoraiTools.some((tool) => tool.id === "workspace")).toBe(false);
  });

  it("defaults the Tools surface to Terminal", () => {
    expect(getDefaultZoraiTool()).toBe("terminal");
  });

  it("provides view-specific context panel labels", () => {
    expect(contextPanelLabels("code")).toEqual({ title: "Code Agent", collapsed: "Agent" });
    expect(contextPanelLabels("threads")).toEqual({ title: "Orchestration Context", collapsed: "Context" });
    expect(contextPanelLabels("goals")).toEqual({ title: "Orchestration Context", collapsed: "Context" });
  });

  it("redirects legacy workspace tool navigation to Code and never keeps the removed tool", () => {
    expect(normalizeZoraiToolNavigation({ tool: "workspace" })).toEqual({ view: "code" });
    expect(normalizeZoraiToolNavigation({ view: "tools", tool: "workspace" })).toEqual({ view: "code" });
    expect(normalizeZoraiToolNavigation({ view: "tools", tool: "terminal" })).toEqual({
      view: "tools",
      tool: "terminal",
    });
    expect(normalizeZoraiToolNavigation({ view: "tools", tool: "unknown-tool" })).toEqual({ view: "tools" });
  });
});