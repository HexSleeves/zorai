import { beforeEach, describe, expect, it, vi } from "vitest";
import { fetchAgentRuns } from "./agentRuns";

const agentListRuns = vi.fn();

vi.mock("./bridge", () => ({
  getBridge: () => ({ agentListRuns }),
}));

describe("fetchAgentRuns", () => {
  beforeEach(() => {
    agentListRuns.mockReset();
  });

  it("passes the parent thread scope to the daemon bridge", async () => {
    agentListRuns.mockResolvedValue([]);

    await fetchAgentRuns("thread-parent");

    expect(agentListRuns).toHaveBeenCalledWith("thread-parent");
  });

  it("retains the unscoped form for global task and subagent views", async () => {
    agentListRuns.mockResolvedValue([]);

    await fetchAgentRuns();

    expect(agentListRuns).toHaveBeenCalledWith(undefined);
  });
});
