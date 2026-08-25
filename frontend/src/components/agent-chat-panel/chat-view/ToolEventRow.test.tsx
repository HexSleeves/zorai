import { describe, expect, it } from "vitest";

import { ToolStatusIcon } from "./ToolStatusIcon";
import { boundedRawToolPayload, formatRawToolPayload, toolArtifactPreviewEntry } from "./toolArtifactPresentation";

describe("tool status icon", () => {
  it("renders muted svg icons for ok, running, and error statuses", () => {
    for (const status of ["done", "requested", "executing", "error"] as const) {
      const html = renderToStaticMarkup(<ToolStatusIcon status={status} />);
      expect(html).toContain("<svg");
      expect(html).toContain('class="acp-tool-status-icon');
      expect(html).not.toContain("var(--success)");
      expect(html).not.toContain("var(--warning)");
      expect(html).not.toContain("var(--danger)");
    }
  });
});

import { renderToStaticMarkup } from "react-dom/server";

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
