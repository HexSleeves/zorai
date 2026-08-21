import { describe, expect, it } from "vitest";
import { formatTaskStatus, isTaskActive, isTaskTerminal, taskStatusColor } from "./agentTaskQueue";

describe("agentTaskQueue budget exceeded", () => {
  it("treats budget_exceeded as a visible terminal failure, not live work", () => {
    const task = { status: "budget_exceeded" as const };

    expect(isTaskTerminal(task)).toBe(true);
    expect(isTaskActive(task)).toBe(false);
    expect(formatTaskStatus(task)).toBe("Budget exceeded");
    expect(taskStatusColor(task.status)).toBe("var(--danger)");
  });
});
