import { describe, expect, it } from "vitest";

import { toolStatusTone } from "./toolStatusTone";

describe("toolStatusTone", () => {
  it("uses success for done tools, warning for requested/executing tools, and danger for errors", () => {
    expect(toolStatusTone("done").text).toBe("var(--success)");
    expect(toolStatusTone("requested").text).toBe("var(--warning)");
    expect(toolStatusTone("executing").text).toBe("var(--warning)");
    expect(toolStatusTone("error").text).toBe("var(--danger)");
  });
});

import { boundedRawToolPayload, formatRawToolPayload, toolArtifactPreviewEntry } from "./toolArtifactPresentation";

describe("tool artifact presentation", () => {
  it("converts artifacts to existing file-preview entries with provenance", () => {
    expect(toolArtifactPreviewEntry({ path: "/tmp/out.txt", provenance: "result" }, 42)).toEqual({
      path: "/tmp/out.txt",
      kind: "artifact",
      source: "tool-result",
      isText: true,
      updatedAt: 42,
    });
  });

  it("pretty prints JSON and preserves malformed text", () => {
    expect(formatRawToolPayload('{"path":"/tmp/a"}')).toBe('{\n  "path": "/tmp/a"\n}');
    expect(formatRawToolPayload("{broken")).toBe("{broken");
  });

  it("bounds display while retaining an explicit truncation marker", () => {
    const raw = "x".repeat(100_010);
    const display = boundedRawToolPayload(raw);
    expect(display).toContain("[Display truncated; copy retains full payload]");
    expect(display.length).toBeLessThan(raw.length + 50);
  });
});
