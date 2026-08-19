import type { CognitiveEvent, OperationalEvent } from "../../lib/agent-mission-store/types";

export type TraceActivityCategory = "all" | "metacognition" | "operations" | "handoffs" | "participants";

export function traceOperationalEventCategory(
  event: OperationalEvent,
): Exclude<TraceActivityCategory, "all" | "metacognition"> | "other" {
  const text = [event.kind, event.command ?? "", event.message ?? ""].join(" ").toLowerCase();
  if (/handoff|responder_stack/.test(text)) return "handoffs";
  if (/participant|suggestion/.test(text)) return "participants";
  if (/operation|background_task|background operation|get_operation_status|cancel_operation/.test(text)) {
    return "operations";
  }
  return "other";
}

export function filterTraceActivityEvents({
  operationalEvents,
  cognitiveEvents,
  category,
  query,
  date,
}: {
  operationalEvents: OperationalEvent[];
  cognitiveEvents: CognitiveEvent[];
  category: TraceActivityCategory;
  query: string;
  date: string;
}) {
  const normalizedQuery = query.trim().toLowerCase();
  const matchesDate = (timestamp: number) => {
    if (!date) return true;
    const value = new Date(timestamp);
    return `${value.getFullYear()}-${String(value.getMonth() + 1).padStart(2, "0")}-${String(value.getDate()).padStart(2, "0")}` === date;
  };
  return {
    cognitive: category !== "all" && category !== "metacognition"
      ? []
      : cognitiveEvents.filter((event) => matchesDate(event.timestamp)
        && (!normalizedQuery || [event.source, event.content].join(" ").toLowerCase().includes(normalizedQuery))),
    operational: category === "metacognition"
      ? []
      : operationalEvents.filter((event) => matchesDate(event.timestamp)
        && (category === "all" || traceOperationalEventCategory(event) === category)
        && (!normalizedQuery || [
          event.kind,
          event.command ?? "",
          event.message ?? "",
          event.blastRadius ?? "",
          traceOperationalEventCategory(event),
        ].join(" ").toLowerCase().includes(normalizedQuery))),
  };
}
