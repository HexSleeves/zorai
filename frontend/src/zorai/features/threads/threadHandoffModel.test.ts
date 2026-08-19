import { describe, expect, it } from "vitest";
import {
  buildHandoffDefaults,
  buildThreadAgentOptions,
  canReturnHandoff,
} from "./threadHandoffModel";

describe("threadHandoffModel", () => {
  it("builds concise generated defaults", () => {
    expect(buildHandoffDefaults("Weles")).toEqual({
      reason: "Operator requested handoff to Weles",
      summary: "Continue this thread as Weles",
    });
  });

  it("allows return only for a nested responder stack", () => {
    expect(canReturnHandoff({ responderStack: [{ agentId: "swarog" } as never] })).toBe(false);
    expect(canReturnHandoff({
      responderStack: [
        { agentId: "swarog" } as never,
        { agentId: "weles" } as never,
      ],
    })).toBe(true);
  });

  it("deduplicates canonical IDs and excludes the current responder", () => {
    expect(buildThreadAgentOptions(
      [
        { id: "swarog", name: "Svarog" },
        { id: "weles", name: "Weles" },
      ],
      [
        { id: "weles_builtin", name: "Weles duplicate" },
        { id: "reviewer", name: "Reviewer" },
      ],
      "svarog",
    )).toEqual([
      { id: "weles", name: "Weles" },
      { id: "reviewer", name: "Reviewer" },
    ]);
  });
});
