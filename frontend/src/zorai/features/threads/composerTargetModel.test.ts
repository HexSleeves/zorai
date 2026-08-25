import { describe, expect, it } from "vitest";
import {
  canAssignComposerOwnerDirectly,
  composerTargetValue,
  parseComposerTarget,
  resolveComposerSendRoute,
  shouldPreserveTargetAfterFailure,
  targetAfterAcceptedDispatch,
  type ComposerTarget,
} from "./composerTargetModel";

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

  it("assigns owner on empty local threads instead of handing off or spawning", () => {
    expect(canAssignComposerOwnerDirectly({ daemonThreadId: null, messageCount: 0 })).toBe(true);
    expect(canAssignComposerOwnerDirectly({ daemonThreadId: "", messageCount: 0 })).toBe(true);
    expect(canAssignComposerOwnerDirectly({ daemonThreadId: null, messageCount: 0 }, 2)).toBe(false);
    expect(canAssignComposerOwnerDirectly({ daemonThreadId: "daemon-1", messageCount: 0 })).toBe(false);
    expect(canAssignComposerOwnerDirectly({ daemonThreadId: null, messageCount: 1 })).toBe(false);
    expect(resolveComposerSendRoute(targets[1], true)).toEqual({
      action: "assign-owner",
      agentId: "rarog",
      agentName: "Rarog",
    });
    expect(resolveComposerSendRoute(targets[2], true)).toEqual({
      action: "assign-owner",
      agentId: "reviewer",
      agentName: "Reviewer",
    });
    expect(resolveComposerSendRoute(targets[1], false).action).toBe("handoff-agent");
    expect(resolveComposerSendRoute(targets[2], false).action).toBe("spawn-subagent");
    expect(resolveComposerSendRoute(targets[0], true).action).toBe("send");
  });
});
