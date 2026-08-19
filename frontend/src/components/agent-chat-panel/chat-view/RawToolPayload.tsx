import { useMemo, useState } from "react";
import { boundedRawToolPayload } from "./toolArtifactPresentation";

export function RawToolPayload({ label, raw }: { label: string; raw: string }) {
  const [copied, setCopied] = useState(false);
  const display = useMemo(() => boundedRawToolPayload(raw), [raw]);
  if (!raw) return null;

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(raw);
      setCopied(true);
    } catch {
      setCopied(false);
    }
  };

  return (
    <details className="zorai-raw-tool-payload">
      <summary>{label}</summary>
      <button type="button" className="zorai-ghost-button" onClick={() => void copy()}>
        {copied ? "Copied" : "Copy"}
      </button>
      <pre>{display}</pre>
    </details>
  );
}
