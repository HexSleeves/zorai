import { useMemo, useState } from "react";
import { ModelSelector } from "@/components/settings-panel/shared";
import { useAgentStore, type AgentProviderId, type AgentThread } from "@/lib/agentStore";
import { getBridge } from "@/lib/bridge";
import { pushToast } from "@/lib/toastStore";
import { threadProviderIds } from "../threads/threadRuntimeActions";
import { resolveThreadOwnerRuntimeProfile } from "../threads/threadOwnerRuntime";

type Props = { thread: AgentThread | null };

function patchLocalProfile(threadId: string, patch: Partial<Pick<AgentThread, "profileProvider" | "profileModel" | "profileReasoningEffort" | "profileContextWindowTokens">>) {
  useAgentStore.setState((state) => ({
    threads: state.threads.map((thread) => (thread.id === threadId ? { ...thread, ...patch } : thread)),
  }));
}

export function CodeThreadRuntimeSwitcher({ thread }: Props) {
  const agentSettings = useAgentStore((state) => state.agentSettings);
  const conciergeConfig = useAgentStore((state) => state.conciergeConfig);
  const subAgents = useAgentStore((state) => state.subAgents);
  const [busy, setBusy] = useState(false);

  const providers = useMemo(() => threadProviderIds(), [agentSettings]);

  if (!thread) {
    return <span className="zorai-code-runtime-switcher__empty">No thread — open or create one to switch runtime.</span>;
  }

  const profile = resolveThreadOwnerRuntimeProfile(thread, subAgents, agentSettings, conciergeConfig);
  const providerId = (profile.provider || providers[0] || "") as AgentProviderId;
  const providerConfig = agentSettings[providerId] as {
    model?: string;
    custom_model_name?: string;
    context_window_tokens?: number | null;
    base_url?: string;
    api_key?: string;
    auth_source?: "api_key" | "chatgpt_subscription" | "github_copilot";
  } | undefined;
  const model = profile.model || "";
  const isThreadScoped = Boolean(thread.daemonThreadId);

  const apply = async (nextProvider: string, nextModel: string) => {
    if (!nextProvider) return;
    setBusy(true);
    const daemonId = thread.daemonThreadId?.trim();
    try {
      // Optimistic local mirror
      patchLocalProfile(thread.id, { profileProvider: nextProvider, profileModel: nextModel });
      if (daemonId) {
        const bridge = getBridge();
        const existing = await bridge?.agentGetThreadExecutionProfile?.(daemonId).catch(() => null) as { profile?: Record<string, unknown> | null } | null | unknown;
        const prev = (existing && typeof existing === "object" && "profile" in (existing as Record<string, unknown>)) ? ((existing as Record<string, unknown>).profile as Record<string, unknown> | null) : null;
        const nextProfile: Record<string, unknown> = {
          ...(prev && typeof prev === "object" ? prev : {}),
          provider: nextProvider,
          model: nextModel,
        };
        const result = await bridge?.agentSetThreadExecutionProfile?.(daemonId, nextProfile) as { error?: string } | unknown;
        const err = result && typeof result === "object" && "error" in (result as Record<string, unknown>) ? String((result as Record<string, unknown>).error ?? "") : "";
        if (err) throw new Error(err);
      }
      pushToast(`Thread runtime set to ${nextProvider}/${nextModel} for this thread only.`, "info");
    } catch (error) {
      pushToast(error instanceof Error ? error.message : "Could not switch thread runtime.", "error");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="zorai-code-runtime-switcher" aria-label={`Thread runtime — ${profile.ownerId}`}>
      <label className="zorai-code-runtime-switcher__field">
        <span>Provider</span>
        <select
          className="zorai-input zorai-code-runtime-switcher__select"
          value={providerId}
          disabled={busy || providers.length === 0}
          onChange={(event) => void apply(event.target.value, providerConfig?.model || model)}
        >
          {providers.map((id) => <option key={id} value={id}>{id}</option>)}
        </select>
      </label>
      <label className="zorai-code-runtime-switcher__field zorai-code-runtime-switcher__field--model">
        <span>Model</span>
        {providerId ? (
          <ModelSelector
            providerId={providerId}
            value={model}
            customName={model}
            disabled={busy}
            base_url={providerConfig?.base_url}
            api_key={providerConfig?.api_key}
            auth_source={providerConfig?.auth_source}
            onChange={(nextModel) => void apply(providerId, nextModel)}
          />
        ) : <span className="zorai-empty-state">Select provider</span>}
      </label>
      <span className="zorai-code-runtime-switcher__hint" title="Without daemon link the switch stays local until the thread is promoted">
        {isThreadScoped ? "Thread-scoped (no global change)" : "Local only (daemon link pending)"}
      </span>
    </div>
  );
}
