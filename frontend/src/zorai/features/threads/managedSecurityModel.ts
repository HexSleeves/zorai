import type { ThreadManagedSecurityLevel } from "./threadRuntimeActions";

const SHIELD_FILL: Record<ThreadManagedSecurityLevel, number> = {
  highest: 1,
  moderate: 0.64,
  lowest: 0.3,
  yolo: 0,
};

export function securityShieldFill(level: ThreadManagedSecurityLevel): number {
  return SHIELD_FILL[level];
}

export function securityShieldMuted(level: ThreadManagedSecurityLevel): boolean {
  return level === "yolo";
}

export const SECURITY_SHIELD_MENU_WIDTH = 168;

export function securityShieldMenuPosition(
  button: { left: number; top: number },
  viewport: { width: number; height: number },
  menuWidth = SECURITY_SHIELD_MENU_WIDTH,
): { left: number; bottom: number } {
  return {
    left: Math.min(Math.max(8, button.left), Math.max(8, viewport.width - menuWidth - 8)),
    bottom: Math.max(8, viewport.height - button.top + 6),
  };
}
