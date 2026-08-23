import { threadReasoningEfforts, type ThreadReasoningEffort } from "./threadRuntimeActions";

export function effortTickIndex(effort: string): number {
  const ticks = threadReasoningEfforts();
  const index = ticks.indexOf(effort as ThreadReasoningEffort);
  return index >= 0 ? index : Math.max(0, ticks.indexOf("medium"));
}

export function effortFillRatio(effort: string): number {
  const last = threadReasoningEfforts().length - 1;
  return last <= 0 ? 0 : effortTickIndex(effort) / last;
}

export function effortNeedleAngle(effort: string): number {
  return -90 + effortFillRatio(effort) * 180;
}

export const EFFORT_POPOVER_WIDTH = 196;

export function effortPopoverPosition(
  button: { left: number; top: number },
  viewport: { width: number; height: number },
  popoverWidth = EFFORT_POPOVER_WIDTH,
): { left: number; bottom: number } {
  return {
    left: Math.min(Math.max(8, button.left), Math.max(8, viewport.width - popoverWidth - 8)),
    bottom: Math.max(8, viewport.height - button.top + 6),
  };
}
