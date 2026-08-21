import { describe, expect, it } from "vitest";
import {
  applyDaemonRetryStatusEvent,
  clearThreadRetryStatus,
  formatThreadRetrySummary,
  getThreadRetryStatus,
  parseRetryStatusEvent,
} from "./threadRetryStatus";

describe("threadRetryStatus", () => {
  it("surfaces a durable weekly quota 429 the same way TUI retry rows do", () => {
    clearThreadRetryStatus("thread-quota");
    const message = "z.ai-coding-plan API returned 429: Weekly/Monthly Limit Exhausted. Your limit will reset at 2026-08-28 10:03:27";
    applyDaemonRetryStatusEvent({
      type: "retry_status",
      thread_id: "thread-quota",
      phase: "retrying",
      attempt: 1,
      max_retries: 0,
      delay_ms: 5000,
      failure_class: "rate_limit",
      message,
    });

    const status = getThreadRetryStatus("thread-quota");
    expect(status?.failureClass).toBe("rate_limit");
    expect(status?.message).toContain("Weekly/Monthly Limit Exhausted");
    expect(formatThreadRetrySummary(status!, status!.receivedAt)).toBe(
      "retry 1/∞ in 5s · rate limit",
    );
  });

  it("clears the banner when the daemon says the retry finished", () => {
    applyDaemonRetryStatusEvent({
      thread_id: "thread-quota",
      phase: "retrying",
      attempt: 2,
      max_retries: 3,
      delay_ms: 1000,
      failure_class: "rate_limit",
      message: "429",
    });
    applyDaemonRetryStatusEvent({ thread_id: "thread-quota", phase: "cleared" });
    expect(getThreadRetryStatus("thread-quota")).toBeNull();
  });

  it("parses waiting copy for automatic retry", () => {
    const parsed = parseRetryStatusEvent({
      thread_id: "thread-wait",
      phase: "waiting",
      attempt: 3,
      max_retries: 3,
      delay_ms: 30_000,
      failure_class: "rate_limit",
      message: "429 Too Many Requests",
    });
    expect(parsed && "phase" in parsed && parsed.phase === "waiting").toBe(true);
    if (parsed && parsed.phase !== "cleared") {
      expect(formatThreadRetrySummary(parsed, parsed.receivedAt)).toBe(
        "retrying automatically in 30s · rate limit",
      );
    }
  });
});
