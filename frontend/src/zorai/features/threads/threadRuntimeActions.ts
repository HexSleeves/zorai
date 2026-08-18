import { getDefaultModelForProvider } from "@/lib/agentStore/providers";
import { useAgentStore } from "@/lib/agentStore";
import type { AgentProviderId, AgentThread } from "@/lib/agentStore";
import { getBridge } from "@/lib/bridge";
import { isSvarogOwner, RAROG_AGENT_ID, resolveThreadOwnerAgentId } from "./threadOwner";

export const MIN_CONTEXT_WINDOW_TOKENS = 1_000;
export const MAX_CONTEXT_WINDOW_TOKENS = 2_000_000;
const REASONING_EFFORTS = ["none", "minimal", "low", "medium", "high", "xhigh", "max"] as const;

export type ThreadReasoningEffort = (typeof REASONING_EFFORTS)[number];

export function clampContextWindowTokens(tokens: number): number {
  if (!Number.isFinite(tokens)) return MIN_CONTEXT_WINDOW_TOKENS;
  return Math.min(MAX_CONTEXT_WINDOW_TOKENS, Math.max(MIN_CONTEXT_WINDOW_TOKENS, Math.trunc(tokens)));
}

export function threadProviderIds(): string[] {
  const settings = useAgentStore.getState().agentSettings;
  return Object.keys(settings)
    .filter((key) => {
      const value = settings[key];
      return value && typeof value === "object" && "model" in value && "base_url" in value;
    })
    .sort();
}

export function threadReasoningEfforts(): readonly ThreadReasoningEffort[] {
  return REASONING_EFFORTS;
}

function ownerAgentId(thread: AgentThread): string {
  return resolveThreadOwnerAgentId(thread, useAgentStore.getState().subAgents);
}

export function patchThreadProfile(
  threadId: string,
  patch: Partial<Pick<AgentThread, "profileProvider" | "profileModel" | "profileReasoningEffort" | "profileContextWindowTokens">>,
): void {
  useAgentStore.setState((state) => ({
    threads: state.threads.map((thread) => (thread.id === threadId ? { ...thread, ...patch } : thread)),
  }));
}

function daemonEffortValue(effort: string): string {
  return effort === "none" ? "" : effort;
}

export async function applyThreadProviderModel(
  thread: AgentThread,
  providerId: string,
  model: string,
): Promise<void> {
  const bridge = getBridge();
  const ownerId = ownerAgentId(thread);
  const nextModel = model.trim() || getDefaultModelForProvider(providerId as AgentProviderId);
  if (isSvarogOwner(ownerId)) {
    await bridge?.agentSetProviderModel?.(providerId, nextModel);
    const updateAgentSetting = useAgentStore.getState().updateAgentSetting;
    const current = useAgentStore.getState().agentSettings[providerId as AgentProviderId] as Record<string, unknown> | undefined;
    updateAgentSetting("active_provider", providerId as never);
    updateAgentSetting(providerId as never, { ...(current ?? {}), model: nextModel } as never);
  } else {
    await bridge?.agentSetTargetAgentProviderModel?.(ownerId, providerId, nextModel);
    if (ownerId === RAROG_AGENT_ID) {
      await useAgentStore.getState().refreshConciergeConfig();
    } else {
      await useAgentStore.getState().refreshSubAgents();
    }
  }
  patchThreadProfile(thread.id, { profileProvider: providerId, profileModel: nextModel });
}

export async function applyThreadReasoningEffort(thread: AgentThread, effort: string): Promise<void> {
  const bridge = getBridge();
  const ownerId = ownerAgentId(thread);
  const daemonEffort = daemonEffortValue(effort);
  if (isSvarogOwner(ownerId)) {
    const provider = useAgentStore.getState().agentSettings.active_provider;
    await bridge?.agentSetConfigItem?.("/reasoning_effort", daemonEffort);
    await bridge?.agentSetConfigItem?.(`/providers/${provider}/reasoning_effort`, daemonEffort);
    await bridge?.agentSetConfigItem?.(`/${provider}/reasoning_effort`, daemonEffort);
    useAgentStore.getState().updateAgentSetting("reasoning_effort", (effort || "none") as never);
  } else {
    await bridge?.agentSetTargetAgentReasoningEffort?.(ownerId, daemonEffort);
    if (ownerId === RAROG_AGENT_ID) {
      await useAgentStore.getState().refreshConciergeConfig();
    } else {
      await useAgentStore.getState().refreshSubAgents();
    }
  }
  patchThreadProfile(thread.id, { profileReasoningEffort: daemonEffort || null });
}

export async function applyThreadContextWindow(thread: AgentThread, tokens: number): Promise<void> {
  const clamped = clampContextWindowTokens(tokens);
  const ownerId = ownerAgentId(thread);
  const bridge = getBridge();
  if (isSvarogOwner(ownerId)) {
    const provider = useAgentStore.getState().agentSettings.active_provider;
    await bridge?.agentSetConfigItem?.("/context_window_tokens", clamped);
    await bridge?.agentSetConfigItem?.(`/providers/${provider}/context_window_tokens`, clamped);
    await bridge?.agentSetConfigItem?.(`/${provider}/context_window_tokens`, clamped);
    const updateAgentSetting = useAgentStore.getState().updateAgentSetting;
    const current = useAgentStore.getState().agentSettings[provider] as Record<string, unknown> | undefined;
    updateAgentSetting("context_window_tokens", clamped);
    updateAgentSetting(provider as never, { ...(current ?? {}), context_window_tokens: clamped } as never);
  } else {
    await bridge?.agentSetTargetAgentContextWindow?.(ownerId, clamped);
    if (ownerId === RAROG_AGENT_ID) {
      await useAgentStore.getState().refreshConciergeConfig();
    } else {
      await useAgentStore.getState().refreshSubAgents();
    }
  }
  patchThreadProfile(thread.id, { profileContextWindowTokens: clamped });
}

export async function applyRarogContextWindow(tokens: number): Promise<void> {
  const clamped = clampContextWindowTokens(tokens);
  await getBridge()?.agentSetTargetAgentContextWindow?.(RAROG_AGENT_ID, clamped);
}
