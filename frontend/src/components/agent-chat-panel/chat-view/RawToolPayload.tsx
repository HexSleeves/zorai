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
      <pre>{display}</pre>
      <button type="button" className="zorai-ghost-button" onClick={() => void copy()} style={{ justifySelf: "flex-end", background: "transparent", border: "none"}}>
        {copied ? (
          <span style={{ display: "inline-flex", alignItems: "center", gap: 4 }}>
            <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              <path d="M20 6 9 17l-5-5" />
            </svg>
          </span>
        ) : (
          <span style={{ display: "inline-flex", alignItems: "center", gap: 4 }}>
            <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              <rect x="9" y="9" width="13" height="13" rx="2" />
              <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" />
            </svg>
          </span>
        )}
   
      </button>
    </details>
  );
}
