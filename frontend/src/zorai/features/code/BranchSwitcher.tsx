import { useEffect, useRef, useState } from "react";

export function BranchSwitcher({ root, bridge, currentBranch, onSwitched }: {
  root: string;
  bridge: Pick<ZoraiBridge, "workspaceGitBranches" | "workspaceGitCheckout">;
  currentBranch: string | null;
  onSwitched: () => Promise<void> | void;
}) {
  const [open, setOpen] = useState(false);
  const [branches, setBranches] = useState<Array<{ name: string; isCurrent: boolean }>>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const rootRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!open || !bridge.workspaceGitBranches) return;
    let cancelled = false;
    void bridge.workspaceGitBranches(root)
      .then((next) => { if (!cancelled) { setBranches(next); setError(null); } })
      .catch((reason: unknown) => { if (!cancelled) setError(reason instanceof Error ? reason.message : String(reason)); });
    return () => { cancelled = true; };
  }, [open, root, bridge]);

  useEffect(() => {
    if (!open) return;
    const onPointerDown = (event: globalThis.PointerEvent) => {
      if (!rootRef.current?.contains(event.target as Node)) setOpen(false);
    };
    document.addEventListener("pointerdown", onPointerDown);
    return () => document.removeEventListener("pointerdown", onPointerDown);
  }, [open]);

  const checkout = async (branch: string) => {
    if (!bridge.workspaceGitCheckout || busy) return;
    setBusy(true);
    setError(null);
    try {
      await bridge.workspaceGitCheckout(root, branch);
      setOpen(false);
      await onSwitched();
    } catch (reason: unknown) {
      setError(reason instanceof Error ? reason.message : String(reason));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div ref={rootRef} className="zorai-branch-switcher">
      <button
        type="button"
        className="zorai-branch-switcher-button"
        aria-haspopup="menu"
        aria-expanded={open}
        title="Switch branch"
        onClick={() => setOpen((value) => !value)}
      >
        <BranchIcon />
        <span>{currentBranch ?? "detached"}</span>
        <em aria-hidden="true">▾</em>
      </button>
      {open ? (
        <div className="zorai-branch-switcher-menu" role="menu" aria-label="Branches">
          {error ? <div className="zorai-branch-switcher-error" role="alert">{error}</div> : null}
          {branches.length === 0 && !error ? <div className="zorai-branch-switcher-empty">{busy ? "Switching…" : "No branches."}</div> : null}
          {branches.map((branch) => (
            <button
              type="button"
              key={branch.name}
              role="menuitem"
              className={branch.isCurrent ? "zorai-branch-switcher-item is-current" : "zorai-branch-switcher-item"}
              disabled={busy}
              onClick={() => void checkout(branch.name)}
            >
              {branch.name}
              {branch.isCurrent ? <em aria-hidden="true">●</em> : null}
            </button>
          ))}
        </div>
      ) : null}
    </div>
  );
}

function BranchIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <circle cx="6" cy="6" r="2.4" />
      <circle cx="6" cy="18" r="2.4" />
      <circle cx="18" cy="8" r="2.4" />
      <path d="M6 8.4v7.2" />
      <path d="M18 10.4c0 3-2.5 4.6-6 4.6h-2" />
    </svg>
  );
}
