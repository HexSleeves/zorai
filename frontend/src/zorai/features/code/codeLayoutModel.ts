/**
 * Pure layout model for Code's resizable Explorer and Agent panels.
 *
 * No React or browser dependencies: every function here is deterministic and
 * testable in isolation. The Code shell composes this model with the persisted
 * preferred widths from `codeLayoutStore` to derive the effective per-panel
 * widths that are applied as CSS variables.
 */

export const CODE_EXPLORER_DEFAULT_WIDTH = 280;
export const CODE_EXPLORER_MIN_WIDTH = 180;
export const CODE_EXPLORER_MAX_WIDTH = 520;
export const CODE_AGENT_DEFAULT_WIDTH = 320;
export const CODE_AGENT_MIN_WIDTH = 260;
export const CODE_AGENT_MAX_WIDTH = 640;
export const CODE_EDITOR_MIN_WIDTH = 380;
export const CODE_RESIZE_HANDLE_WIDTH = 5;
export const CODE_GLOBAL_RAIL_WIDTH = 68;
export const CODE_COLLAPSED_EXPLORER_WIDTH = 48;
export const CODE_COLLAPSED_AGENT_WIDTH = 40;

/** Amount of chrome that never belongs to a panel for the current open state. */
export function codeFixedChromeWidth(explorerOpen: boolean, agentOpen: boolean): number {
  return CODE_GLOBAL_RAIL_WIDTH
    + (explorerOpen ? CODE_RESIZE_HANDLE_WIDTH : 0)
    + (agentOpen ? CODE_RESIZE_HANDLE_WIDTH : 0);
}

export type CodePanelName = "explorer" | "agent";

export type CodePanelWidths = {
  explorer: number;
  agent: number;
  editor: number;
};

export type CodePanelWidthInput = {
  viewportWidth: number;
  explorerPreferred: number;
  agentPreferred: number;
  explorerOpen: boolean;
  agentOpen: boolean;
};

export type MaxCodePanelWidthInput = {
  panel: CodePanelName;
  viewportWidth: number;
  /** Effective width of the sibling side panel (collapsed width when closed). */
  otherWidth: number;
  /** Current global rail + visible resize handles; defaults to both handles. */
  fixedChromeWidth?: number;
};

export type ResizeKey =
  | "ArrowRight"
  | "ArrowLeft"
  | "ArrowUp"
  | "ArrowDown"
  | "Home"
  | "End";

export function codePanelMinWidth(panel: CodePanelName): number {
  return panel === "explorer" ? CODE_EXPLORER_MIN_WIDTH : CODE_AGENT_MIN_WIDTH;
}

export function codePanelMaxWidth(panel: CodePanelName): number {
  return panel === "explorer" ? CODE_EXPLORER_MAX_WIDTH : CODE_AGENT_MAX_WIDTH;
}

export function codePanelDefaultWidth(panel: CodePanelName): number {
  return panel === "explorer" ? CODE_EXPLORER_DEFAULT_WIDTH : CODE_AGENT_DEFAULT_WIDTH;
}

export function codePanelCollapsedWidth(panel: CodePanelName): number {
  return panel === "explorer" ? CODE_COLLAPSED_EXPLORER_WIDTH : CODE_COLLAPSED_AGENT_WIDTH;
}

/** Round to an integer and clamp into the panel's valid range. Non-finite input falls back to the default. */
export function clampCodePanelWidth(panel: CodePanelName, value: number): number {
  if (!Number.isFinite(value)) return codePanelDefaultWidth(panel);
  const clamped = Math.max(codePanelMinWidth(panel), Math.min(codePanelMaxWidth(panel), value));
  return Math.round(clamped);
}

/**
 * Largest width a panel may take while the editor keeps at least
 * `CODE_EDITOR_MIN_WIDTH` and the sibling side panel keeps its current
 * effective width. Used as the drag/keyboard bound for resize handles.
 */
export function maxCodePanelWidth(input: MaxCodePanelWidthInput): number {
  const fixedChromeWidth = input.fixedChromeWidth
    ?? (CODE_GLOBAL_RAIL_WIDTH + (2 * CODE_RESIZE_HANDLE_WIDTH));
  const remaining = Math.floor(input.viewportWidth - fixedChromeWidth - CODE_EDITOR_MIN_WIDTH - input.otherWidth);
  return Math.max(codePanelMinWidth(input.panel), Math.min(codePanelMaxWidth(input.panel), remaining));
}

/**
 * Derive the effective Explorer/Agent/Editor widths for a viewport from the
 * persisted preferred widths. Preferences are clamped into the panel ranges;
 * closed panels collapse to their rail width; and when the editor would drop
 * below its minimum the open panels shrink (Agent first, then Explorer) until
 * the editor is protected or every panel sits at its minimum.
 */
export function resolveCodePanelWidths(input: CodePanelWidthInput): CodePanelWidths {
  const explorerPreferred = clampCodePanelWidth("explorer", input.explorerPreferred);
  const agentPreferred = clampCodePanelWidth("agent", input.agentPreferred);

  let explorer = input.explorerOpen ? explorerPreferred : CODE_COLLAPSED_EXPLORER_WIDTH;
  let agent = input.agentOpen ? agentPreferred : CODE_COLLAPSED_AGENT_WIDTH;
  let editor = input.viewportWidth - codeFixedChromeWidth(input.explorerOpen, input.agentOpen) - explorer - agent;

  if (editor < CODE_EDITOR_MIN_WIDTH) {
    let overflow = CODE_EDITOR_MIN_WIDTH - editor;

    const agentReduction = input.agentOpen
      ? Math.min(overflow, agent - CODE_AGENT_MIN_WIDTH)
      : 0;
    agent -= agentReduction;
    overflow -= agentReduction;

    const explorerReduction = input.explorerOpen
      ? Math.min(overflow, explorer - CODE_EXPLORER_MIN_WIDTH)
      : 0;
    explorer -= explorerReduction;
    overflow -= explorerReduction;

    editor = input.viewportWidth - codeFixedChromeWidth(input.explorerOpen, input.agentOpen) - explorer - agent;
  }

  return { explorer, agent, editor };
}

/**
 * Adjust a panel width from a resize-handle keyboard event. Arrow keys move by
 * a base step of 10 (40 when Shift is held), Home/End snap to the panel
 * min/max, and the result is clamped into the panel range. Unknown keys return
 * the current value untouched. Explorer and Agent share the same direction
 * semantics (ArrowLeft shrinks); pointer-drag mirroring lives in the handle.
 */
export function adjustCodePanelWidth(
  panel: CodePanelName,
  value: number,
  key: ResizeKey | string,
  shift: boolean,
): number {
  const step = shift ? 40 : 10;
  let next = value;
  switch (key) {
    case "ArrowRight":
    case "ArrowUp":
      next = value + step;
      break;
    case "ArrowLeft":
    case "ArrowDown":
      next = value - step;
      break;
    case "Home":
      next = codePanelMinWidth(panel);
      break;
    case "End":
      next = codePanelMaxWidth(panel);
      break;
    default:
      return value;
  }
  return Math.max(codePanelMinWidth(panel), Math.min(codePanelMaxWidth(panel), next));
}