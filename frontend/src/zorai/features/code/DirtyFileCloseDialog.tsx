import { useEffect, useRef } from "react";

export function DirtyFileCloseDialog({ path, saving, error, onSave, onDiscard, onCancel }: {
  path: string;
  saving: boolean;
  error?: string | null;
  onSave: () => void;
  onDiscard: () => void;
  onCancel: () => void;
}) {
  const cancelRef = useRef<HTMLButtonElement | null>(null);
  useEffect(() => {
    cancelRef.current?.focus();
    const onKeyDown = (event: KeyboardEvent) => { if (event.key === "Escape" && !saving) onCancel(); };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [onCancel, saving]);
  return <div className="zorai-code-dialog-backdrop" onMouseDown={(event) => { if (event.target === event.currentTarget && !saving) onCancel(); }}>
    <section className="zorai-code-close-dialog" role="dialog" aria-modal="true" aria-labelledby="zorai-dirty-close-title">
      <h2 id="zorai-dirty-close-title">Save changes?</h2>
      <p><strong>{path}</strong> has unsaved changes.</p>
      <p>Closing without saving permanently discards the editor changes.</p>
      {error ? <div role="alert">{error}</div> : null}
      <footer>
        <button ref={cancelRef} type="button" disabled={saving} onClick={onCancel}>Cancel</button>
        <button type="button" className="is-danger" disabled={saving} onClick={onDiscard}>Don’t Save</button>
        <button type="button" className="is-primary" disabled={saving} onClick={onSave}>{saving ? "Saving…" : "Save"}</button>
      </footer>
    </section>
  </div>;
}
