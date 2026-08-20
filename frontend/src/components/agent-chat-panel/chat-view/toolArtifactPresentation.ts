import type { WorkContextEntry } from "@/lib/agentWorkContext";
import type { ToolArtifactReference } from "./toolArtifacts";

const MAX_RENDER_CHARS = 100_000;
const TRUNCATION_MARKER = "\n[Display truncated; copy retains full payload]";

export function toolArtifactPreviewEntry(
  artifact: ToolArtifactReference,
  createdAt: number,
): WorkContextEntry {
  return {
    path: artifact.path,
    kind: "artifact",
    source: `tool-${artifact.provenance}`,
    isText: true,
    updatedAt: createdAt,
  };
}

export function formatRawToolPayload(raw: string): string {
  try {
    return JSON.stringify(JSON.parse(raw), null, 2);
  } catch {
    return raw;
  }
}

export function boundedRawToolPayload(raw: string): string {
  const formatted = formatRawToolPayload(raw);
  return formatted.length > MAX_RENDER_CHARS
    ? `${formatted.slice(0, MAX_RENDER_CHARS)}${TRUNCATION_MARKER}`
    : formatted;
}
