import { describe, expect, it } from "vitest";
import type { CognitiveEvent, OperationalEvent } from "../../lib/agent-mission-store/types";
import { filterTraceActivityEvents } from "./traceActivityFilters";

function operational(id: string, message: string): OperationalEvent {
  return {
    id,
    timestamp: 1_700_000_000_000,
    paneId: "pane-1",
    workspaceId: null,
    surfaceId: null,
    sessionId: null,
    kind: "tool-call",
    command: null,
    message,
    exitCode: null,
    durationMs: null,
    riskLevel: null,
    blastRadius: null,
  };
}

const cognitive: CognitiveEvent = {
  id: "cognitive-1",
  timestamp: 1_700_000_000_000,
  paneId: "pane-1",
  workspaceId: null,
  surfaceId: null,
  sessionId: null,
  source: "inner-monologue",
  content: "Metacognitive warning about the plan",
};

const events = [
  operational("operation", "Background operation op-1 started"),
  operational("handoff", "Thread handoff from Svarog to Weles"),
  operational("participant", "Participant suggestion queued"),
  operational("other", "Regular terminal command"),
];

describe("filterTraceActivityEvents", () => {
  it.each([
    ["operations", ["operation"]],
    ["handoffs", ["handoff"]],
    ["participants", ["participant"]],
  ] as const)("filters the %s category", (category, expectedIds) => {
    const result = filterTraceActivityEvents({
      operationalEvents: events,
      cognitiveEvents: [cognitive],
      category,
      query: "",
      date: "",
    });
    expect(result.operational.map((event) => event.id)).toEqual(expectedIds);
    expect(result.cognitive).toEqual([]);
  });

  it("filters metacognition separately", () => {
    const result = filterTraceActivityEvents({
      operationalEvents: events,
      cognitiveEvents: [cognitive],
      category: "metacognition",
      query: "warning",
      date: "",
    });
    expect(result.cognitive.map((event) => event.id)).toEqual(["cognitive-1"]);
    expect(result.operational).toEqual([]);
  });

  it("preserves text search in all mode", () => {
    const result = filterTraceActivityEvents({
      operationalEvents: events,
      cognitiveEvents: [cognitive],
      category: "all",
      query: "weles",
      date: "",
    });
    expect(result.operational.map((event) => event.id)).toEqual(["handoff"]);
    expect(result.cognitive).toEqual([]);
  });
});
