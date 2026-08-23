import { describe, expect, it } from "vitest";
import {
  securityShieldFill,
  securityShieldMenuPosition,
  securityShieldMuted,
} from "./managedSecurityModel";

describe("security shield fill", () => {
  it("fills the shield completely at the highest managed security level", () => {
    expect(securityShieldFill("highest")).toBe(1);
    expect(securityShieldMuted("highest")).toBe(false);
  });

  it("reduces fill as security relaxes and leaves yolo as an empty muted outline", () => {
    expect(securityShieldFill("moderate")).toBeGreaterThan(securityShieldFill("lowest"));
    expect(securityShieldFill("lowest")).toBeGreaterThan(securityShieldFill("yolo"));
    expect(securityShieldFill("yolo")).toBe(0);
    expect(securityShieldMuted("yolo")).toBe(true);
  });

  it("anchors the menu to the shield so it opens above the composer instead of under the agent selector", () => {
    const position = securityShieldMenuPosition({ left: 92, top: 420 }, { width: 800, height: 500 });
    expect(position.left).toBe(92);
    expect(position.bottom).toBe(86);
  });
});
