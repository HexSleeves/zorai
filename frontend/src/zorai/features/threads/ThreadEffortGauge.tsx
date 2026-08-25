import { useEffect, useLayoutEffect, useMemo, useRef, useState, type CSSProperties } from "react";
import { createPortal } from "react-dom";
import { useAgentStore, type AgentThread } from "@/lib/agentStore";
import {
  EFFORT_POPOVER_WIDTH,
  effortFillRatio,
  effortNeedleAngle,
  effortPopoverPosition,
  effortTickIndex,
} from "./threadEffortModel";
import { resolveThreadOwnerRuntimeProfile } from "./threadOwnerRuntime";
import { applyThreadReasoningEffort, threadReasoningEfforts } from "./threadRuntimeActions";

export function ThreadEffortGauge({ thread }: { thread: AgentThread }) {
  const agentSettings = useAgentStore((state) => state.agentSettings);
  const conciergeConfig = useAgentStore((state) => state.conciergeConfig);
  const subAgents = useAgentStore((state) => state.subAgents);
  const profile = resolveThreadOwnerRuntimeProfile(thread, subAgents, agentSettings, conciergeConfig);
  const effort = profile.effort || "medium";
  const ticks = threadReasoningEfforts();
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [popoverStyle, setPopoverStyle] = useState<CSSProperties>({});
  const rootRef = useRef<HTMLDivElement>(null);
  const buttonRef = useRef<HTMLButtonElement>(null);
  const popoverRef = useRef<HTMLDivElement>(null);
  const angle = effortNeedleAngle(effort);
  const fill = effortFillRatio(effort);
  const needle = useMemo(() => {
    const radians = (angle * Math.PI) / 180;
    return { x: 12 + 8 * Math.sin(radians), y: 17 - 8 * Math.cos(radians) };
  }, [angle]);

  useLayoutEffect(() => {
    if (!open || !buttonRef.current) return;
    const update = () => {
      if (!buttonRef.current) return;
      const rect = buttonRef.current.getBoundingClientRect();
      const position = effortPopoverPosition(rect, {
        width: window.innerWidth,
        height: window.innerHeight,
      });
      setPopoverStyle({
        position: "fixed",
        left: position.left,
        right: "auto",
        top: "auto",
        bottom: position.bottom,
        zIndex: 90,
        width: EFFORT_POPOVER_WIDTH,
        minWidth: EFFORT_POPOVER_WIDTH,
      });
    };
    update();
    window.addEventListener("resize", update);
    window.addEventListener("scroll", update, true);
    return () => {
      window.removeEventListener("resize", update);
      window.removeEventListener("scroll", update, true);
    };
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const onPointerDown = (event: PointerEvent) => {
      const target = event.target as Node;
      if (rootRef.current?.contains(target) || popoverRef.current?.contains(target)) return;
      setOpen(false);
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") setOpen(false);
    };
    window.addEventListener("pointerdown", onPointerDown);
    window.addEventListener("keydown", onKeyDown);
    return () => {
      window.removeEventListener("pointerdown", onPointerDown);
      window.removeEventListener("keydown", onKeyDown);
    };
  }, [open]);

  const select = async (next: string) => {
    if (busy || next === effort) {
      setOpen(false);
      return;
    }
    setBusy(true);
    try {
      await applyThreadReasoningEffort(thread, next);
      setOpen(false);
    } finally {
      setBusy(false);
    }
  };

  const popover =
    open && typeof document !== "undefined"
      ? createPortal(
          <div
            ref={popoverRef}
            className="zorai-effort-gauge__popover"
            role="dialog"
            aria-label="Reasoning effort"
            style={popoverStyle}
          >
            <div className="zorai-effort-gauge__label">{effort}</div>
            <div
              className="zorai-effort-gauge__meter"
              role="slider"
              aria-valuemin={0}
              aria-valuemax={ticks.length - 1}
              aria-valuenow={effortTickIndex(effort)}
              aria-valuetext={effort}
            >
              <div className="zorai-effort-gauge__track">
                <div className="zorai-effort-gauge__fill" style={{ width: `${fill * 100}%` }} />
              </div>
              {ticks.map((tick, index) => (
                <button
                  type="button"
                  key={tick}
                  className={["zorai-effort-gauge__tick", tick === effort ? "is-active" : ""].filter(Boolean).join(" ")}
                  style={{ left: `${(index / Math.max(1, ticks.length - 1)) * 100}%` }}
                  title={tick}
                  aria-label={tick}
                  disabled={busy}
                  onClick={() => void select(tick)}
                />
              ))}
            </div>
            <div className="zorai-effort-gauge__scale">
              <span>{ticks[0]}</span>
              <span>{ticks[ticks.length - 1]}</span>
            </div>
          </div>,
          document.body,
        )
      : null;

  return (
    <div ref={rootRef} className="zorai-effort-gauge">
      <button
        ref={buttonRef}
        type="button"
        className="zorai-composer-icon-button"
        title={`Reasoning effort: ${effort}`}
        aria-label={`Reasoning effort: ${effort}`}
        aria-haspopup="dialog"
        aria-expanded={open}
        disabled={busy}
        onClick={() => setOpen((current) => !current)}
      >
        <svg viewBox="0 0 24 24" width="20" height="20" aria-hidden="true">
          <path d="M4 17a8 8 0 0 1 20 0" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" />
          <line x1="12" y1="17" x2={needle.x} y2={needle.y} stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" />
          <circle cx="12" cy="17" r="1.3" fill="currentColor" />
        </svg>
      </button>
      {popover}
    </div>
  );
}
