import { describe, expect, it, vi } from "vitest";
import { fetchHydratedRemoteThreads } from "./threadListQueries";

describe("fetchHydratedRemoteThreads", () => {
    it("passes the daemon agent filter through and hydrates lightweight threads", async () => {
        const agentListThreads = vi.fn(async (options?: { agentFilter?: string | null }) => {
            expect(options).toEqual({ agentFilter: "rarog", includeInternal: false });
            return [
                {
                    id: "daemon-rarog-thread",
                    title: "Rarog conversation",
                    agent_name: "Rarog",
                    created_at: 1,
                    updated_at: 10,
                    messages: [],
                    total_message_count: 0,
                },
            ];
        });

        const threads = await fetchHydratedRemoteThreads({
            agentListThreads,
            fallbackAgentName: "Svarog",
            agentFilter: "rarog",
        });

        expect(agentListThreads).toHaveBeenCalledTimes(1);
        expect(threads).toHaveLength(1);
        expect(threads[0].daemonThreadId).toBe("daemon-rarog-thread");
        expect(threads[0].agent_name).toBe("Rarog");
    });

    it("asks the daemon for internal threads when the picker needs them", async () => {
        const agentListThreads = vi.fn(async (options?: { agentFilter?: string | null; includeInternal?: boolean }) => {
            expect(options).toEqual({ agentFilter: null, includeInternal: true });
            return [{
                id: "dm:svarog:weles",
                title: "Internal DM · Swarog ↔ WELES",
                agent_name: "Svarog",
                created_at: Date.now(),
                updated_at: Date.now(),
                messages: [],
            }];
        });

        const threads = await fetchHydratedRemoteThreads({
            agentListThreads,
            fallbackAgentName: "Svarog",
            includeInternal: true,
        });

        expect(threads).toHaveLength(1);
        expect(threads[0].daemonThreadId).toBe("dm:svarog:weles");
    });

    it("unwraps a thread-list payload object instead of treating it as empty", async () => {
        const agentListThreads = vi.fn(async () => ({
            threads: [{
                id: "goal:run-1",
                title: "Goal thread",
                agent_name: "Svarog",
                created_at: Date.now(),
                updated_at: Date.now(),
                messages: [],
            }],
        }) as unknown as unknown[]);

        const threads = await fetchHydratedRemoteThreads({
            agentListThreads,
            fallbackAgentName: "Svarog",
            includeInternal: true,
        });

        expect(threads).toHaveLength(1);
        expect(threads[0].daemonThreadId).toBe("goal:run-1");
    });

    it("falls back to the provided agent name when the daemon omits ownership", async () => {
        const agentListThreads = vi.fn(async () => [
            {
                id: "daemon-svarog-thread",
                title: "Main conversation",
                created_at: 1,
                updated_at: 20,
                messages: [],
                total_message_count: 0,
            },
        ]);

        const threads = await fetchHydratedRemoteThreads({
            agentListThreads,
            fallbackAgentName: "Svarog",
        });

        expect(threads).toHaveLength(1);
        expect(threads[0].agent_name).toBe("Svarog");
    });

    it("reuses the local store id so clicking a listed thread opens it instead of refetching", async () => {
        const agentListThreads = vi.fn(async () => [
            {
                id: "daemon-svarog-thread",
                title: "Main conversation",
                created_at: 1,
                updated_at: 20,
                messages: [],
                total_message_count: 0,
            },
        ]);

        const threads = await fetchHydratedRemoteThreads({
            agentListThreads,
            fallbackAgentName: "Svarog",
            existingThreads: [{
                id: "local-already-loaded",
                daemonThreadId: "daemon-svarog-thread",
                workspaceId: "workspace-1",
                surfaceId: "surface-1",
                paneId: "pane-1",
                agent_name: "Svarog",
                title: "stale title",
                createdAt: 1,
                updatedAt: 1,
                messageCount: 0,
                totalInputTokens: 0,
                totalOutputTokens: 0,
                totalTokens: 0,
                compactionCount: 0,
                lastMessagePreview: "",
            }],
        });

        expect(threads).toHaveLength(1);
        expect(threads[0].id).toBe("local-already-loaded");
        expect(threads[0].daemonThreadId).toBe("daemon-svarog-thread");
        expect(threads[0].title).toBe("Main conversation");
        expect(threads[0].workspaceId).toBe("workspace-1");
    });

    it("keeps an existing thread execution profile when the list payload omits it", async () => {
        const agentListThreads = vi.fn(async () => [
            {
                id: "daemon-svarog-thread",
                title: "Main conversation",
                created_at: 1,
                updated_at: 20,
                messages: [],
                total_message_count: 0,
            },
        ]);

        const threads = await fetchHydratedRemoteThreads({
            agentListThreads,
            fallbackAgentName: "Svarog",
            existingThreads: [{
                id: "local-already-loaded",
                daemonThreadId: "daemon-svarog-thread",
                workspaceId: "workspace-1",
                surfaceId: "surface-1",
                paneId: "pane-1",
                agent_name: "Svarog",
                title: "stale title",
                createdAt: 1,
                updatedAt: 1,
                messageCount: 0,
                totalInputTokens: 0,
                totalOutputTokens: 0,
                totalTokens: 0,
                compactionCount: 0,
                lastMessagePreview: "",
                profileProvider: "z.ai-coding-plan",
                profileModel: "glm-5.3",
            }],
        });

        expect(threads[0].profileProvider).toBe("z.ai-coding-plan");
        expect(threads[0].profileModel).toBe("glm-5.3");
    });
});