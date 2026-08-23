import { describe, expect, it } from "vitest";
import { composerTargetValue, parseComposerTarget, shouldPreserveTargetAfterFailure, targetAfterAcceptedDispatch, type ComposerTarget } from "./composerTargetModel";

const targets: ComposerTarget[] = [
  { kind: "current", id: "current", label: "Svarog" },
  { kind: "agent", id: "rarog", label: "Rarog" },
  { kind: "subagent", id: "reviewer", label: "Reviewer" },
];

describe("composer target model", () => {
  it("round-trips selected targets", () => {
    expect(parseComposerTarget("agent:rarog", targets)).toEqual(targets[1]);
    expect(composerTargetValue(targets[2])).toBe("subagent:reviewer");
  });

  it("keeps agent targets persistent and resets accepted subagent delegation", () => {
    expect(targetAfterAcceptedDispatch(targets[1])).toEqual(targets[1]);
    expect(targetAfterAcceptedDispatch(targets[2]).kind).toBe("current");
  });

  it("preserves one-shot subagent target after pre-acceptance failure", () => {
    expect(shouldPreserveTargetAfterFailure(targets[2])).toBe(true);
    expect(shouldPreserveTargetAfterFailure(targets[1])).toBe(false);
  });
});
