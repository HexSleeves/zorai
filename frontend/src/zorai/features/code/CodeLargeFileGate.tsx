export function exceedsCodeFileLimit(sizeBytes: number, maxFileSizeMb: number): boolean {
  return sizeBytes > Math.min(100, Math.max(1, maxFileSizeMb)) * 1024 * 1024;
}

export function CodeLargeFileGate({ path, sizeBytes, maxFileSizeMb, onOpenReduced, onOpenExternal, onReveal }: {
  path: string; sizeBytes: number; maxFileSizeMb: number; onOpenReduced: () => void; onOpenExternal: () => void; onReveal: () => void;
}) {
  return <div className="zorai-code-large-file" role="alert">
    <strong>Large file blocked</strong>
    <p>{path} is {(sizeBytes / 1024 / 1024).toFixed(1)} MB. The current editable limit is {maxFileSizeMb} MB.</p>
    <p>Reduced mode disables language services, diagnostics, tests, minimap, sticky scroll, and formatting.</p>
    <div><button type="button" onClick={onOpenReduced}>Open once in reduced mode</button><button type="button" onClick={onOpenExternal}>Open externally</button><button type="button" onClick={onReveal}>Reveal</button></div>
  </div>;
}
