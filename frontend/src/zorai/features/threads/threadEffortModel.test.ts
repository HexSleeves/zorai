import { describe, expect, it } from "vitest";
import {
  effortFillRatio,
  effortNeedleAngle,
  effortPopoverPosition,
  effortTickIndex,
} from "./threadEffortModel";

describe("thread effort gauge", () => {
  it("places none at rest and max at the far tick so the meter encodes reasoning budget", () => {
    expect(effortTickIndex("none")).toBe(0);
    expect(effortFillRatio("none")).toBe(0);
    expect(effortNeedleAngle("none")).toBe(-90);
    expect(effortFillRatio("max")).toBe(1);
    expect(effortNeedleAngle("max")).toBe(90);
  });

  it("falls back to medium when a thread has no explicit effort yet", () => {
    expect(effortTickIndex("medium")).toBeGreaterThan(0);
    expect(effortTickIndex("not-a-level")).toBe(effortTickIndex("medium"));
  });

  it("opens the meter above the composer gauge instead of sliding under the agent selector", () => {
    const position = effortPopoverPosition({ left: 120, top: 420 }, { width: 800, height: 500 });
    expect(position.left).toBe(120);
    expect(position.bottom).toBe(86);
  });
});
