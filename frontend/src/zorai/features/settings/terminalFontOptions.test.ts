import { describe, expect, it } from "vitest";
import { buildTerminalFontOptions } from "./terminalFontOptions";

describe("buildTerminalFontOptions", () => {
  it("sorts and deduplicates system fonts while preserving the selected font", () => {
    expect(buildTerminalFontOptions(["JetBrains Mono", "Cascadia Code", "JetBrains Mono"], "Custom Mono")).toEqual([
      "Cascadia Code",
      "Custom Mono",
      "JetBrains Mono",
    ]);
  });

  it("uses known terminal fonts when system font discovery is unavailable", () => {
    const options = buildTerminalFontOptions([], "Cascadia Code");

    expect(options).toContain("Cascadia Code");
    expect(options).toContain("JetBrains Mono");
    expect(options).toContain("monospace");
  });
});
