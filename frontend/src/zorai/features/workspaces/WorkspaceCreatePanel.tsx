import { useState, type FormEvent } from "react";
import { setWorkspaceOperator, type WorkspaceOperator, type WorkspaceSettings } from "@/lib/workspaceBoard";
import {
  emptyWorkspaceCreateDraft,
  parseWorkspaceCreateDraft,
} from "./workspaceCreateModel";

export function WorkspaceCreatePanel({
  onCreated,
  onCancel,
}: {
  onCreated: (workspace: WorkspaceSettings) => void;
  onCancel: () => void;
}) {
  const [draft, setDraft] = useState(emptyWorkspaceCreateDraft);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    const parsed = parseWorkspaceCreateDraft(draft);
    if (!parsed.ok) {
      setError(parsed.error);
      return;
    }
    setBusy(true);
    setError(null);
    const settings = await setWorkspaceOperator(parsed.request.workspaceId, parsed.request.operator);
    setBusy(false);
    if (!settings) {
      setError("Workspace create failed.");
      return;
    }
    onCreated(settings);
  };

  return (
    <form className="zorai-workspace-create" onSubmit={(event) => void submit(event)}>
      <label>
        <span>Workspace *</span>
        <input
          value={draft.workspaceId}
          onChange={(event) => setDraft({ ...draft, workspaceId: event.target.value })}
          placeholder="Workspace name"
          autoFocus
        />
      </label>
      <label>
        <span>Operator</span>
        <select
          value={draft.operator}
          onChange={(event) => setDraft({ ...draft, operator: event.target.value as WorkspaceOperator })}
        >
          <option value="user">user</option>
          <option value="svarog">svarog</option>
        </select>
      </label>
      {error ? <span className="zorai-workspace-create__error">{error}</span> : null}
      <div className="zorai-card-actions">
        <button type="submit" className="zorai-primary-button" disabled={busy}>Create</button>
        <button type="button" className="zorai-ghost-button" onClick={onCancel} disabled={busy}>Cancel</button>
      </div>
    </form>
  );
}
