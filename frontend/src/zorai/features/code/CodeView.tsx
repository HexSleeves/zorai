const codeRailSections = [
  { id: "explorer", label: "Explorer" },
  { id: "search", label: "Search" },
  { id: "scm", label: "Source Control" },
] as const;

export function CodeRail() {
  return (
    <div className="zorai-rail-stack">
      <div className="zorai-section-label">Code</div>
      {codeRailSections.map((section) => (
        <div key={section.id} className="zorai-rail-card">
          <strong>{section.label}</strong>
          <span>No repository open.</span>
        </div>
      ))}
    </div>
  );
}

export function CodeView() {
  return (
    <section className="zorai-feature-surface zorai-code-surface">
      <div className="zorai-view-header">
        <div>
          <div className="zorai-kicker">Code</div>
          <h1>Code Agent</h1>
          <p>
            The Code surface is where repository files, diffs, and editor views
            will live as a first-class Zorai destination.
          </p>
        </div>
      </div>
      <div className="zorai-code-empty">
        <strong>No repository open</strong>
        <span>
          Open a folder to start exploring files. Explorer, search, and source
          control views will render here once a repository root is bound.
        </span>
      </div>
    </section>
  );
}

export function CodeAgentPane() {
  return (
    <div className="zorai-context-summary">
      <div className="zorai-section-label">Code Agent</div>
      <div className="zorai-context-block">
        <strong>Agent</strong>
        <span>
          Code-aware agent context will render here once a repository is open.
        </span>
      </div>
    </div>
  );
}