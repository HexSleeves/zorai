import { getBridge } from "@/lib/bridge";
import { useThreadFilePreview } from "@/zorai/features/threads/ThreadFilePreviewContext";
import type { ToolArtifactReference } from "./toolArtifacts";
import { toolArtifactPreviewEntry } from "./toolArtifactPresentation";

export function ToolArtifactChips({
  artifacts,
  createdAt,
  compact = false,
}: {
  artifacts: ToolArtifactReference[];
  createdAt: number;
  compact?: boolean;
}) {
  const { openThreadFilePreview } = useThreadFilePreview();
  const visible = compact ? artifacts.slice(0, 2) : artifacts;
  const overflow = compact ? Math.max(0, artifacts.length - visible.length) : 0;
  const bridge = getBridge();

  if (artifacts.length === 0) return null;

  return (
    <div className={compact ? "zorai-tool-artifacts zorai-tool-artifacts--compact" : "zorai-tool-artifacts"}>
      {visible.map((artifact) => (
        <div key={`${artifact.provenance}:${artifact.path}`} className="zorai-tool-artifact">
          <button
            type="button"
            className="zorai-tool-artifact__path"
            title={`Preview ${artifact.path}`}
            onClick={(event) => {
              event.stopPropagation();
              openThreadFilePreview(toolArtifactPreviewEntry(artifact, createdAt));
            }}
          >
            {artifact.path}
          </button>
          {!compact ? (
            <>
              <span className="zorai-status-pill">{artifact.provenance}</span>
              {bridge?.openFsPath ? (
                <button type="button" className="zorai-ghost-button" onClick={() => void bridge.openFsPath?.(artifact.path)}>Open</button>
              ) : null}
              {bridge?.revealFsPath ? (
                <button type="button" className="zorai-ghost-button" onClick={() => void bridge.revealFsPath?.(artifact.path)}>Reveal</button>
              ) : null}
            </>
          ) : null}
        </div>
      ))}
      {overflow > 0 ? <span className="zorai-status-pill">+{overflow}</span> : null}
    </div>
  );
}
