import { useEffect, useRef, useState } from "react";
import { submitWorkspacePath } from "./workspacePathSubmission";

export type WorkspacePathOperation = "file" | "directory" | "rename";

export function WorkspacePathDialog({ operation, initialPath = "", busy = false, error = null, onSubmit, onClose }: {
  operation: WorkspacePathOperation;
  initialPath?: string;
  busy?: boolean;
  error?: string | null;
  onSubmit: (path: string) => void | Promise<void>;
  onClose: () => void;
}) {
  const [path, setPath] = useState(initialPath);
  const inputRef = useRef<HTMLInputElement | null>(null);
  const label = operation === "file" ? "Create file" : operation === "directory" ? "Create folder" : "Rename path";

  useEffect(() => {
    inputRef.current?.focus();
    inputRef.current?.select();
  }, []);

  return (
    <div className="zorai-code-dialog-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget && !busy) onClose(); }}>
      <form className="zorai-code-close-dialog zorai-workspace-path-dialog" role="dialog" aria-modal="true" aria-labelledby="zorai-workspace-path-title" onSubmit={(event) => {
        event.preventDefault();
        void submitWorkspacePath(path, busy, onSubmit);
      }}>
        <h2 id="zorai-workspace-path-title">{label}</h2>
        <label>
          <span>Workspace-relative path</span>
          <input ref={inputRef} value={path} disabled={busy} onChange={(event) => setPath(event.target.value)} onKeyDown={(event) => { if (event.key === "Escape" && !busy) onClose(); }} placeholder={operation === "directory" ? "src/components" : "src/components/NewFile.tsx"} />
        </label>
        {error ? <p role="alert">{error}</p> : null}
        <footer>
          <button type="button" disabled={busy} onClick={onClose}>Cancel</button>
          <button type="submit" className="is-primary" disabled={busy || !path.trim()}>{busy ? "Working…" : label}</button>
        </footer>
      </form>
    </div>
  );
}
