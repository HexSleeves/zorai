import { describe, expect, it } from "vitest";
import { getDefaultZoraiTool, zoraiTools } from "./tools";

describe("Zorai tools", () => {
  it("opens the terminal as the default operator tool", () => {
    expect(getDefaultZoraiTool()).toBe("terminal");
  });

  it("exposes runtime-backed tool destinations without the duplicate Workspace entry", () => {
    expect(zoraiTools.map((tool) => tool.id)).toEqual([
      "terminal",
      "canvas",
      "files",
      "browser",
      "history",
      "system",
      "vault",
    ]);
  });

  it("defines user-facing copy for every tool", () => {
    for (const tool of zoraiTools) {
      expect(tool.title.trim().length).toBeGreaterThan(0);
      expect(tool.description.trim().length).toBeGreaterThan(0);
    }
  });
});