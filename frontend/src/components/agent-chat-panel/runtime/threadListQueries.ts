import { buildHydratedRemoteThread, type AgentThread } from "@/lib/agentStore";

type AgentListThreads = (options?: {
    agentFilter?: string | null;
    includeInternal?: boolean;
}) => Promise<unknown[]>;

function asRemoteThreadArray(value: unknown): unknown[] {
    if (Array.isArray(value)) {
        return value;
    }
    if (value && typeof value === "object") {
        const record = value as { data?: unknown; threads?: unknown };
        if (Array.isArray(record.data)) {
            return record.data;
        }
        if (Array.isArray(record.threads)) {
            return record.threads;
        }
    }
    return [];
}

export async function fetchHydratedRemoteThreads(params: {
    agentListThreads: AgentListThreads;
    fallbackAgentName: string;
    agentFilter?: string | null;
    includeInternal?: boolean;
    existingThreads?: AgentThread[];
}): Promise<AgentThread[]> {
    const remoteThreads = asRemoteThreadArray(await params.agentListThreads({
        agentFilter: params.agentFilter ?? null,
        includeInternal: params.includeInternal === true,
    }).catch(() => []));

    const existingByDaemonThreadId = new Map(
        (params.existingThreads ?? [])
            .filter((thread) => typeof thread.daemonThreadId === "string" && thread.daemonThreadId)
            .map((thread) => [thread.daemonThreadId as string, thread]),
    );
    const dedupedThreads = new Map<string, AgentThread>();
    for (const remoteThread of remoteThreads) {
        const hydrated = buildHydratedRemoteThread(remoteThread ?? {}, params.fallbackAgentName);
        const daemonThreadId = hydrated?.thread.daemonThreadId;
        if (!hydrated || !daemonThreadId || dedupedThreads.has(daemonThreadId)) {
            continue;
        }
        const existing = existingByDaemonThreadId.get(daemonThreadId);
        dedupedThreads.set(daemonThreadId, existing
            ? {
                ...hydrated.thread,
                id: existing.id,
                workspaceId: existing.workspaceId,
                surfaceId: existing.surfaceId,
                paneId: existing.paneId,
            }
            : hydrated.thread);
    }

    return Array.from(dedupedThreads.values()).sort((left, right) => right.updatedAt - left.updatedAt);
}
