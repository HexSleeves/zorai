import { describe, expect, it } from "vitest";
import { getDefaultZoraiTool, zoraiTools } from "./tools";

describe("Zorai tools", () => {
  it("opens the thread-bound workspace as the default operator tool", () => {
    expect(getDefaultZoraiTool()).toBe("workspace");
  });

  it("exposes runtime-backed tool destinations", () => {
    expect(zoraiTools.map((tool) => tool.id)).toEqual([
      "workspace",
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
