import { useEffect, useMemo, useRef, useState, type WheelEvent } from "react";
import { selectVisibleCodeTabs, shouldConsumeCodeTabWheel, type CodeTabDescriptor } from "./codeTabsModel";

type CodeTabsProps = {
  tabs: CodeTabDescriptor[];
  onActivate: (path: string) => void;
  onClose: (path: string) => void;
  onTogglePin: (path: string) => void;
  onMove: (path: string, direction: -1 | 1) => void;
};

export function CodeTabs({ tabs, onActivate, onClose, onTogglePin, onMove }: CodeTabsProps) {
  const hostRef = useRef<HTMLDivElement | null>(null);
  const [width, setWidth] = useState(1200);
  const [overflowOpen, setOverflowOpen] = useState(false);

  useEffect(() => {
    const host = hostRef.current;
    if (!host) return;
    setWidth(host.clientWidth || 1200);
    if (typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver((entries) => {
      setWidth(entries[0]?.contentRect.width ?? host.clientWidth);
    });
    observer.observe(host);
    return () => observer.disconnect();
  }, []);

  const { visible, hidden } = useMemo(() => selectVisibleCodeTabs(tabs, width), [tabs, width]);
  const handleWheel = (event: WheelEvent<HTMLDivElement>) => {
    const host = hostRef.current;
    if (!host || !shouldConsumeCodeTabWheel(host.scrollWidth, host.clientWidth)) return;
    event.preventDefault();
    event.stopPropagation();
    host.scrollLeft += event.deltaY || event.deltaX;
  };

  return (
    <div className="zorai-code-tabs-shell">
      <div ref={hostRef} className="zorai-workspace-tabs zorai-code-tabs" role="tablist" aria-label="Open editors" onWheel={handleWheel}>
        {visible.map((tab, index) => (
          <button type="button" role="tab" aria-selected={tab.active} key={tab.path} className={tab.active ? "active" : ""} onClick={() => onActivate(tab.path)} title={tab.path}>
            <span
              className={tab.pinned ? "zorai-workspace-tab-pin is-pinned" : "zorai-workspace-tab-pin"}
              role="button"
              aria-label={tab.pinned ? "Unpin editor" : "Pin editor"}
              aria-pressed={tab.pinned}
              onClick={(event) => { event.stopPropagation(); onTogglePin(tab.path); }}
            >
              <svg viewBox="0 0 16 16" width="12" height="12" aria-hidden="true">
                <path
                  fill="currentColor"
                  d="M9.7 1.4H6.3l-.7 1.2.9.6v3.2L4.3 8.7v1.1h3.1V15h1.2V9.8h3.1V8.7L9.5 6.4V3.2l.9-.6-.7-1.2z"
                />
              </svg>
            </span>
            <span className="zorai-code-tab-label">{tab.label}{tab.dirty ? " ●" : ""}</span>
            <span className="zorai-workspace-tab-move" onClick={(event) => { event.stopPropagation(); onMove(tab.path, index > 0 ? -1 : 1); }}>↔</span>
            {!tab.pinned ? <span onClick={(event) => { event.stopPropagation(); onClose(tab.path); }}>×</span> : null}
          </button>
        ))}
      </div>
      {hidden.length > 0 ? (
        <div className="zorai-code-tabs-overflow">
          <button type="button" aria-label={`${hidden.length} more open editors`} aria-expanded={overflowOpen} onClick={() => setOverflowOpen((open) => !open)}>⌄</button>
          {overflowOpen ? <div role="menu">{hidden.map((tab) => <button type="button" role="menuitem" key={tab.path} onClick={() => { onActivate(tab.path); setOverflowOpen(false); }}>{tab.label}{tab.dirty ? " ●" : ""}</button>)}</div> : null}
        </div>
      ) : null}
    </div>
  );
}
