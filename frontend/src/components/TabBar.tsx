import { allLeafIds } from "../lib/bspTree";
import { useLayoutStore } from "../lib/layoutStore";

export function TabBar() {
  const tree = useLayoutStore((s) => s.tree);
  const activePaneId = useLayoutStore((s) => s.activePaneId);
  const setActivePaneId = useLayoutStore((s) => s.setActivePaneId);
  const closePane = useLayoutStore((s) => s.closePane);
  const addPane = useLayoutStore((s) => s.addPane);

  const paneIds = allLeafIds(tree);

  return (
    <div
      style={{
        display: "flex",
        alignItems: "center",
        background: "var(--bg-secondary)",
        borderBottom: "1px solid var(--border)",
        height: "var(--tab-height)",
        paddingLeft: 8,
        gap: 2,
        overflow: "hidden",
      }}
    >
      {paneIds.map((id) => (
        <div
          key={id}
          onClick={() => setActivePaneId(id)}
          style={{
            display: "flex",
            alignItems: "center",
            gap: 6,
            padding: "0 12px",
            height: "100%",
            fontSize: "var(--text-sm)",
            cursor: "pointer",
            background:
              id === activePaneId
                ? "var(--zorai-bg)"
                : "transparent",
            color:
              id === activePaneId
                ? "var(--text-primary)"
                : "var(--text-secondary)",
            borderBottom:
              id === activePaneId
                ? "2px solid var(--accent)"
                : "2px solid transparent",
            transition: "all 0.15s ease",
          }}
        >
          <span>{id}</span>
          <span
            onClick={(e) => {
              e.stopPropagation();
              closePane(id);
            }}
            style={{
              cursor: "pointer",
              opacity: 0.5,
              fontSize: "var(--text-base)",
              lineHeight: 1,
            }}
            title="Close pane"
          >
            ×
          </span>
        </div>
      ))}
      <button
        onClick={addPane}
        style={{
          background: "none",
          border: "none",
          color: "var(--text-secondary)",
          cursor: "pointer",
          fontSize: "var(--text-lg)",
          padding: "0 8px",
          height: "100%",
        }}
        title="New pane"
      >
        +
      </button>
    </div>
  );
}
