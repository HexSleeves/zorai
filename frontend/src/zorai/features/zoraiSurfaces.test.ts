import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

function readFeature(path: string): string {
  return readFileSync(new URL(path, import.meta.url), "utf8");
}

function readFunctionSource(source: string, start: string, end: string): string {
  const startIndex = source.indexOf(start);
  const endIndex = source.indexOf(end, startIndex + start.length);

  expect(startIndex).toBeGreaterThanOrEqual(0);
  expect(endIndex).toBeGreaterThan(startIndex);

  return source.slice(startIndex, endIndex);
}

describe("Zorai feature surfaces", () => {
  it("keeps Goals native to the Zorai shell instead of embedding legacy task UI", () => {
    const source = readFeature("./goals/GoalsView.tsx");

    expect(source).not.toContain("TasksView");
    expect(source).toContain("zorai-goals-surface");
  });

  it("keeps TUI goal workspace modes in native Goals", () => {
    const source = readFeature("./goals/goalWorkspaceModel.ts");
    const panelSource = readFeature("./goals/GoalWorkspacePanel.tsx");

    expect(source).toContain("Dossier");
    expect(source).toContain("Files");
    expect(source).toContain("Progress");
    expect(source).toContain("Usage");
    expect(source).toContain("Active agent");
    expect(source).toContain("Threads");
    expect(source).toContain("Needs attention");
    expect(source).toContain("targetThreadId");
    expect(source).toContain("targetFilePath");
    expect(panelSource).toContain("loadGoalProjectionFiles");
    expect(panelSource).toContain("openThreadFilePreview");
  });

  it("enters a dedicated TUI-style goal view from mission control", () => {
    const source = readFeature("./goals/GoalsView.tsx");
    const openThreadSource = readFeature("./threads/openThreadTarget.ts");

    expect(source).toContain("workspaceOpen");
    expect(source).toContain("Open goal view");
    expect(source).toContain("Back to goals");
    expect(source).toContain("openThreadTarget");
    expect(source).toContain("onOpenThread={openGoalThread}");
    expect(openThreadSource).toContain("agentGetThread");
    expect(openThreadSource).not.toContain("refreshThreadList");
  });

  it("starts goals through the TUI-compatible Mission Control preflight", () => {
    const source = readFeature("./goals/GoalsView.tsx");
    const launchSource = readFeature("./goals/GoalLaunchPanel.tsx");
    const goalRunsSource = readFeature("../../lib/goalRuns.ts");
    const electronSource = readFileSync(new URL("../../../electron/main/agent-ipc-handlers.cjs", import.meta.url), "utf8");

    expect(source).toContain("GoalLaunchPanel");
    expect(source).toContain("goal-launch-overlay");
    expect(source).toContain("setLaunchOpen(true)");
    expect(source).not.toContain("Optional goal title");
    expect(launchSource).not.toContain("MISSION CONTROL");
    expect(launchSource).not.toContain("Prompt editor");
    expect(launchSource).not.toContain("Ctrl+O");
    expect(launchSource).not.toContain("Esc cancel");
    expect(launchSource).not.toContain("Thread Router");
    expect(launchSource).not.toContain("zorai-tui-pane");
    expect(launchSource).toContain("Goal prompt");
    expect(launchSource).toContain("Main Agent");
    expect(launchSource).toContain("Role Assignments");
    expect(launchSource).toContain("launchAssignments");
    expect(launchSource).toContain("Add agent");
    expect(launchSource).toContain("Remove agent");
    expect(launchSource).toContain("assignments.length <= 1");
    expect(goalRunsSource).toContain("launchAssignments?: GoalAgentAssignment[]");
    expect(electronSource).toContain("launch_assignments");
  });

  it("keeps Activity native to the Zorai shell instead of embedding legacy trace UI", () => {
    const source = readFeature("./activity/ActivityView.tsx");

    expect(source).not.toContain("TraceView");
    expect(source).toContain("zorai-activity-surface");
  });

  it("exposes a TUI-style notification inbox with read-all and archive-read", () => {
    const source = readFeature("./activity/ActivityView.tsx");
    const inboxSource = readFeature("./activity/ActivityInbox.tsx");

    expect(source).toContain('"inbox"');
    expect(source).toContain("ActivityInbox");
    expect(inboxSource).toContain("Read all");
    expect(inboxSource).toContain("Archive read");
    expect(inboxSource).toContain("markAllRead");
    expect(inboxSource).toContain("archiveRead");
  });

  it("exposes TUI-style usage statistics inside native Activity", () => {
    const source = readFeature("./activity/ActivityView.tsx");
    const usageSource = readFeature("./activity/ActivityUsagePanel.tsx");
    const surfaceCss = readFeature("../styles/zorai-surfaces.css");

    expect(source).toContain('"usage"');
    expect(source).toContain("UsagePanel");
    expect(usageSource).toContain("agentGetStatistics");
    expect(usageSource).toContain("Overview");
    expect(usageSource).toContain("Providers");
    expect(usageSource).toContain("Models");
    expect(usageSource).toContain("Rankings");
    expect(usageSource).toContain("Provider / Model");
    expect(usageSource).toContain("Top Models By Tokens");
    expect(usageSource).toContain("SessionUsageTable");
    expect(usageSource).toContain("stats.sessionRows");
    expect(usageSource).toContain("Provider models");
    expect(surfaceCss).toContain("zorai-usage-grid");
  });

  it("keeps approval requests in native Zorai modal styling", () => {
    const source = readFeature("../../components/AgentApprovalOverlay.tsx");

    expect(source).toContain("zorai-approval-overlay");
    expect(source).toContain("zorai-approval-dialog");
    expect(source).not.toContain("zorai-panel-title");
    expect(source).not.toContain("onMouseEnter");
  });

  it("keeps Settings native to the Zorai shell instead of embedding the old settings panel", () => {
    const source = readFeature("./settings/SettingsView.tsx");
    const panelSource = readFeature("./settings/SettingsPanels.tsx");
    const tabSource = readFeature("./settings/settingsTabs.ts");

    expect(source).not.toContain("components/SettingsPanel");
    expect(source).toContain("refreshAgentSettingsFromDaemon");
    expect(source).toContain("refreshConciergeConfig");
    expect(source).toContain("buildDaemonAgentConfig");
    expect(source).toContain("diffDaemonConfigEntries");
    expect(panelSource).toContain("zorai-settings-grid");
    expect(tabSource).toContain('title: "Svarog"');
    expect(tabSource).toContain('title: "Rarog"');
    expect(tabSource).toContain('title: "Chat"');
    expect(tabSource).toContain('id: "search"');
    expect(tabSource).toContain('title: "Terminal interface"');
    expect(panelSource).toContain("API Key");
    expect(panelSource).toContain("Logout");
    expect(panelSource).toContain("Svarog Provider");
    expect(panelSource).toContain("getSupportedApiTransports");
    expect(panelSource).toContain("normalizeApiTransport");
    expect(panelSource).toContain("activeProviderConfig.custom_model_name");
    expect(panelSource).not.toContain('label="Auth" description="Credential source.');
    expect(panelSource).toContain("Backend");
    expect(panelSource).toContain("daemon");
    expect(panelSource).toContain("Migrate from Hermes");
    expect(panelSource).toContain("Migrate from OpenClaw");
    expect(panelSource).toContain("agentExternalRuntimeMigrationPreview");
    expect(panelSource).toContain("agentExternalRuntimeMigrationApply");
    expect(panelSource).toContain("selectedConciergeProvider");
    expect(panelSource).toContain("RarogContextField");
    expect(panelSource).toContain("applyRarogContextWindow");
    expect(panelSource).toContain("proactive_triage");
    expect(panelSource).toContain("(use Svarog)");
    expect(panelSource).toContain("managed_security_level");
    expect(panelSource).toContain("compaction.strategy");
    expect(panelSource).toContain("Compaction Strategy Settings");
    expect(panelSource).toContain("zorai-settings-grid--full");
    expect(panelSource).toContain("Version");
    expect(panelSource).toContain("Author");
    expect(panelSource).toContain("GitHub");
    expect(panelSource).toContain("Homepage");
    expect(panelSource).toContain("Web Search");
    expect(panelSource).toContain("getSystemFonts");
    expect(panelSource).toContain('updateSetting("fontFamily"');
    expect(panelSource).toContain('updateSetting("fontSize"');
    expect(panelSource).toContain('updateSetting("lineHeight"');
    expect(panelSource).toContain("Terminal Font");
    expect(panelSource).toContain("Font Size");
    expect(panelSource).toContain("Line Height");
    expect(panelSource).toContain("SubAgentsTab");
    expect(readFeature("../../components/settings-panel/SubAgentsTab.tsx")).toContain("Edit Sub-Agent");
    expect(readFeature("../../components/settings-panel/SubAgentsTab.tsx")).toContain("Back");
    expect(readFeature("../../components/settings-panel/SubAgentsTab.tsx")).toContain("context_window_tokens");
    expect(readFeature("../../components/settings-panel/SubAgentsTab.tsx")).toContain("showForm ? null");
    expect(panelSource).toContain("selectPlugin");
    expect(panelSource).toContain("pluginUpdateSettings");
  });

  it("applies shared terminal typography to standard and infinite-canvas terminals", () => {
    const terminalRuntimeSource = readFeature("../../components/terminal-pane/useTerminalRuntime.ts");
    const layoutSource = readFeature("../../components/LayoutContainer.tsx");
    const canvasSource = readFeature("../../components/InfiniteCanvasSurface.tsx");

    expect(terminalRuntimeSource).toContain("fontFamily: settings.fontFamily");
    expect(terminalRuntimeSource).toContain("fontSize: settings.fontSize");
    expect(terminalRuntimeSource).toContain("lineHeight: settings.lineHeight");
    expect(layoutSource).toContain("<TerminalPane");
    expect(canvasSource).toContain("<TerminalPane");
  });

  it("keeps Settings scrollable inside the Zorai shell", () => {
    const shellCss = readFeature("../styles/zorai.css");
    const surfaceCss = readFeature("../styles/zorai-surfaces.css");

    expect(shellCss).toMatch(/\.zorai-main\s*{[^}]*min-height:\s*0/s);
    expect(shellCss).toMatch(/\.zorai-main\s*{[^}]*overflow:\s*hidden/s);
    expect(surfaceCss).toMatch(/\.zorai-settings-surface\s*{[^}]*overflow:\s*auto/s);
  });

  it("keeps feature provider/model controls aligned with TUI pickers", () => {
    const panelSource = readFeature("./settings/SettingsPanels.tsx");
    const featuresSource = readFunctionSource(panelSource, "function FeaturesPanel()", "function AdvancedPanel()");

    expect(featuresSource).toContain("semantic_embedding_enabled");
    expect(featuresSource).toContain("auto_thread_title");
    expect(featuresSource).toContain("semantic_embedding_provider");
    expect(featuresSource).toContain("semantic_embedding_model");
    expect(featuresSource).toContain("filterAudioProviderOptions");
    expect(featuresSource).toContain("filterEmbeddingProviderOptions");
    expect(featuresSource).toContain("filterFetchedModelsForAudio");
    expect(featuresSource).toContain("filterFetchedModelsForEmbeddings");
    expect(featuresSource).toContain("audioRemoteModelFetchOutputModalities");
    expect(featuresSource).toContain("imageRemoteModelFetchOutputModalities");
    expect(featuresSource).toContain('audioRemoteModelFetchOutputModalities("stt"');
    expect(featuresSource).toContain('audioRemoteModelFetchOutputModalities("tts"');
    expect(featuresSource).not.toContain('? "audio"');
    expect((featuresSource.match(/<ModelSelector/g) ?? []).length).toBeGreaterThanOrEqual(4);
    expect(featuresSource).not.toContain('label="STT Provider" description="Speech-to-text provider."><input');
    expect(featuresSource).not.toContain('label="TTS Provider" description="Text-to-speech provider."><input');
  });

  it("keeps advanced compaction provider/model controls aligned with TUI pickers", () => {
    const panelSource = readFeature("./settings/SettingsPanels.tsx");
    const advancedSource = readFunctionSource(panelSource, "function AdvancedPanel()", "function PluginsPanel()");

    expect(advancedSource).toContain('<option value="heuristic">Heuristic</option>');
    expect(advancedSource).toContain('<option value="weles">WELES</option>');
    expect(advancedSource).toContain('<option value="custom_model">LLM provider</option>');
    expect(advancedSource).toContain("welesProviderConfig");
    expect(advancedSource).toContain("customCompactionProviderConfig");
    expect((advancedSource.match(/<ModelSelector/g) ?? []).length).toBeGreaterThanOrEqual(2);
    expect(advancedSource).not.toContain('label="WELES Provider" description="Provider used by WELES compaction."><input');
    expect(advancedSource).not.toContain('label="Custom Provider" description="Provider used by custom-model compaction."><input');
  });

  it("keeps Tools navigation in the rail and actions in the main surface", () => {
    const source = readFeature("./tools/ToolsView.tsx");
    const shellSource = readFeature("../shell/ZoraiShell.tsx");

    expect(source).not.toContain("zorai-tool-picker");
    expect(source).toContain("New terminal surface");
    expect(source).toContain("Split right");
    expect(source).toContain("New infinite canvas");
    expect(source).toContain("LayoutContainer");
    expect(source).toContain("ToolsContext");
    expect(source).toContain("closeWorkspace");
    expect(source).toContain("Remove workspace");
    expect(shellSource).toContain("ToolsContext");
  });

  it("keeps Workspaces aligned to the TUI workspace board instead of old terminal workspaces", () => {
    const source = readFeature("./workspaces/WorkspacesView.tsx");

    expect(source).not.toContain("migration hints");
    expect(source).not.toContain("createSurface");
    expect(source).not.toContain("splitActive");
    expect(source).not.toContain("applyPresetLayout");
    expect(source).toContain("WorkspaceTaskStatus");
    expect(source).toContain("New task");
    expect(source).toContain("Toggle operator");
    expect(source).toContain("runWorkspaceTask");
    expect(source).toContain("moveWorkspaceTask");
    expect(source).toContain("zorai-workspace-modal");
    expect(source).toContain("updateWorkspaceTask");
    expect(source).toContain("openThreadTarget");
    expect(source).toContain("goalRunId");
    expect(source).toContain("WorkspaceActorPickerControl");
    expect(source).not.toContain("placeholder=\"reviewer: user, svarog\"");
  });

  it("keeps Threads native to the Zorai shell instead of embedding the old chat view", () => {
    const source = readFeature("./threads/ThreadsView.tsx");
    const composerSource = readFeature("./threads/ThreadComposer.tsx");
    const css = readFeature("../styles/zorai.css");

    expect(source).not.toContain("ChatView");
    expect(source).toContain("zorai-native-thread-surface");
    expect(source).toContain("ThreadComposer");
    expect(composerSource).toContain("zorai-thread-composer");
    expect(css).not.toContain(".zorai-thread-surface > div");
  });

  it("opens listed threads through the daemon detail loader", () => {
    const source = readFeature("../../components/agent-chat-panel/runtime/layout.tsx");
    const browserStart = source.indexOf("function AgentChatPanelThreadBrowserSurface");
    const browserEnd = source.indexOf("export function AgentChatPanelThreadsSurface");
    const browserSource = source.slice(browserStart, browserEnd);

    expect(browserSource).toContain("openThread");
    expect(browserSource).toContain("openThread(thread.id)");
    expect(browserSource).not.toContain("setActiveThread(thread.id)");
  });

  it("shows the streaming stop action in the composer action bar in native Threads", () => {
    const source = readFeature("./threads/ThreadComposer.tsx");
    const actionsStart = source.indexOf("zorai-composer-actions");
    const actionsSource = source.slice(actionsStart);

    expect(actionsSource).toContain("runtime.isStreamingResponse");
    expect(actionsSource).toContain("runtime.stopStreaming(runtime.activeThreadId)");
    expect(actionsSource.indexOf("Stop generating")).toBeGreaterThan(-1);
    expect(actionsSource.indexOf("Send message")).toBeGreaterThan(-1);
  });

  it("queues messages while the agent is streaming", () => {
    const source = readFeature("./threads/ThreadComposer.tsx");

    expect(source).toContain("queuedMessages");
    expect(source).toContain("queueCurrentInput");
    expect(source).toContain("zorai-composer-queue");
    expect(source).toContain("Queue a follow-up");
  });

  it("shows a thinking indicator while the agent streams", () => {
    const source = readFeature("./threads/ThreadsView.tsx");

    expect(source).toContain("ThinkingIndicator");
    expect(source).toContain("zorai-thinking");
    expect(source).toContain("runtime.isStreamingResponse");
    // Assistant fallback name should come from the thread's agent, not hardcoded "Zorai".
    expect(source).toContain("threadAgentName");
  });

  it("lets the current thread change provider, model, and context from the context panel", () => {
    const viewSource = readFeature("./threads/ThreadsView.tsx");
    const contextSource = readFeature("./threads/ThreadsContextPanel.tsx");
    const runtimeSource = readFeature("./threads/ThreadRuntimeBar.tsx");
    const actionsSource = readFeature("./threads/threadRuntimeActions.ts");

    // The thread header no longer embeds the runtime bar; it only summarizes it.
    expect(viewSource).not.toContain("ThreadRuntimeBar");
    expect(viewSource).toContain("ThreadRuntimeSummary");

    // The editable controls live in the context panel ("Show Context").
    expect(contextSource).toContain("ThreadRuntimeBar");
    expect(runtimeSource).toContain("Provider");
    expect(runtimeSource).toContain("Model");
    expect(runtimeSource).toContain("Effort");
    expect(runtimeSource).toContain("Context");
    expect(actionsSource).toContain("agentSetProviderModel");
    expect(actionsSource).toContain("agentSetTargetAgentProviderModel");
    expect(actionsSource).toContain("agentSetTargetAgentReasoningEffort");
    expect(actionsSource).toContain("agentSetTargetAgentContextWindow");
  });

  it("attaches files and records speech on the native thread composer", () => {
    const source = readFeature("./threads/ThreadComposer.tsx");
    const speechSource = readFeature("./threads/useThreadSpeech.ts");
    const viewSource = readFeature("./threads/ThreadsView.tsx");

    expect(source).toContain("Attach files");
    expect(source).toContain("readComposerAttachment");
    expect(source).toContain("agentSpeechToText");
    expect(source).toContain("Record voice message");
    expect(speechSource).toContain("agentTextToSpeech");
    expect(speechSource).toContain("loadingMessageId");
    expect(viewSource).toContain("onSpeak");
    expect(readFeature("./threads/NativeThreadMessageBubble.tsx")).toContain("Read aloud");
  });

  it("keeps TUI-style pinned message controls in native Threads", () => {
    const source = readFeature("./threads/ThreadsView.tsx");
    const contextSource = readFeature("./threads/ThreadsContextPanel.tsx");

    expect(source).toContain("pinMessageForCompaction");
    expect(contextSource).toContain("Pinned Messages");
    expect(source).toContain("Pin Limit Reached");
  });

  it("renders thread tool calls through collapsed tool rows instead of plain message bubbles", () => {
    const source = readFeature("./threads/ThreadsView.tsx");
    const toolSource = readFeature("../../components/agent-chat-panel/chat-view/ToolEventRow.tsx");

    expect(source).toContain("buildDisplayItems");
    expect(source).toContain("ToolEventRow");
    expect(source).toContain('item.type === "tool"');
    expect(source).not.toContain("summarizeToolMessage");
    expect(toolSource).toContain("toolStatusTone");
    expect(readFeature("../../components/agent-chat-panel/chat-view/toolStatusTone.ts")).toContain("toolStatusTone");
    expect(readFeature("../../components/agent-chat-panel/chat-view/toolStatusTone.ts")).toContain("var(--success)");
    expect(readFeature("../../components/agent-chat-panel/chat-view/toolStatusTone.ts")).toContain("var(--warning)");
  });

  it("keeps thread context aligned with TUI tabs and daemon token context windows", () => {
    const shellSource = readFeature("../shell/ZoraiShell.tsx");
    const contextSource = readFeature("./threads/ThreadsContextPanel.tsx");
    const spawnedSource = readFeature("./threads/ThreadsSpawnedContext.tsx");

    expect(shellSource).toContain("ThreadsContext");
    expect(contextSource).toContain("fetchThreadWorkContext");
    expect(readFeature("./threads/ThreadFilePreviewOverlay.tsx")).toContain("fetchGitDiff");
    expect(readFeature("./threads/ThreadFilePreviewOverlay.tsx")).toContain("fetchFilePreview");
    expect(contextSource).toContain("daemonThreadId");
    expect(contextSource).toContain("Todos");
    expect(contextSource).toContain("Files");
    expect(contextSource).toContain("Spawned");
    expect(contextSource).toContain("profileContextWindowTokens");
    expect(contextSource).toContain("activeContextWindowTokens");
    expect(contextSource).toContain("tokens");
    expect(contextSource).toContain("zorai-todo-context-list");
    expect(contextSource).toContain("zorai-todo-checkbox");
    expect(contextSource).toContain("}, [daemonThreadId]);");
    expect(contextSource).not.toContain("}, [activeThread, daemonThreadId]);");
    expect(contextSource).not.toContain("SpawnedAgentsPanel");
    expect(spawnedSource).toContain("zorai-spawned-card");
    expect(spawnedSource).not.toContain("ActionButton");
  });

  it("does not duplicate the left rail inside the right context panel", () => {
    const shellSource = readFeature("../shell/ZoraiShell.tsx");
    const contextRegion = shellSource.slice(
      shellSource.indexOf("<ZoraiContextPanel"),
      shellSource.indexOf("</ZoraiContextPanel>"),
    );

    expect(shellSource).toContain("renderContext(");
    expect(shellSource).toContain("GoalsContext");
    expect(contextRegion).not.toContain("renderRail(activeView");
  });

  it("opens thread file previews as an overlay over chat instead of inside the context sidebar", () => {
    const threadSource = readFeature("./threads/ThreadsView.tsx");
    const contextSource = readFeature("./threads/ThreadsContextPanel.tsx");
    const overlaySource = readFeature("./threads/ThreadFilePreviewOverlay.tsx");
    const css = readFeature("../styles/zorai.css");

    expect(threadSource).toContain("ThreadFilePreviewOverlay");
    expect(contextSource).toContain("openThreadFilePreview");
    expect(contextSource).not.toContain("fetchFilePreview");
    expect(contextSource).not.toContain("fetchGitDiff");
    expect(contextSource).not.toContain("zorai-file-preview");
    expect(overlaySource).toContain("zorai-file-preview-overlay");
    expect(overlaySource).toContain("Close preview");
    expect(css).toMatch(/\.zorai-file-preview-overlay\s*{[^}]*position:\s*absolute/s);
  });

  it("keeps native thread message content bounded to the card width", () => {
    const css = readFeature("../styles/zorai.css");

    expect(css).toMatch(/\.zorai-native-thread-surface\s*{[^}]*grid-template-areas:/s);
    expect(css).toMatch(/\.zorai-thread-chat-scroll\s*{[^}]*grid-area:\s*messages/s);
    expect(css).toMatch(/\.zorai-thread-composer\s*{[^}]*grid-area:\s*composer/s);
    expect(css).toMatch(/\.zorai-thread-chat-scroll\s*>\s*\*\s*{[^}]*min-width:\s*0/s);
    expect(css).toMatch(/\.zorai-message\s*{[^}]*box-sizing:\s*border-box/s);
    expect(css).toMatch(/\.zorai-message__content\s*{[^}]*overflow-wrap:\s*anywhere/s);
  });

  it("keeps assistant reasoning separate from visible message content", () => {
    const messageSource = readFeature("./threads/NativeThreadMessageBubble.tsx");
    const css = readFeature("../styles/zorai.css");

    expect(messageSource).toContain("zorai-message__reasoning-toggle");
    expect(messageSource).toContain("hasVisibleContent");
    expect(messageSource).not.toContain("reasoningPreview");
    expect(messageSource).not.toContain("zorai-message__content--preview");
    expect(messageSource).not.toContain("summarizeThreadMessageText");
    expect(messageSource).toContain("Reasoning");
    expect(messageSource).not.toContain("open={message.isStreaming ? true : undefined}");
    expect(messageSource).not.toContain("<p className=\"zorai-message__reasoning\">");
    expect(css).toMatch(/\.zorai-message__reasoning\s*{[^}]*border:\s*1px solid var\(--zorai-border\)/s);
    expect(css).toMatch(/\.zorai-message__reasoning\s*>\s*div\s*{[^}]*max-height:\s*min\(42vh, 360px\)/s);
  });

  it("renders classified system activity as collapsed rows like tool calls", () => {
    const source = readFeature("./threads/ThreadsView.tsx");
    const rowSource = readFeature("./threads/ThreadActivityRow.tsx");

    expect(source).toContain("classifyThreadActivityMessage");
    expect(source).toContain("ThreadActivityRow");
    expect(source).toContain("onRefreshOperation={runtime.getOperationStatus}");
    expect(source).toContain("onCancelOperation={runtime.cancelOperation}");
    expect(rowSource).toContain("const [expanded, setExpanded] = useState(false)");
    expect(rowSource).toContain("activity.rawText");
  });

  it("fetches latest thread pages on selection and older pages on scroll-up", () => {
    const source = readFeature("./threads/ThreadsView.tsx");
    const railSource = readFeature("./threads/ThreadsRail.tsx");
    const runtimeSource = readFeature("../../components/agent-chat-panel/runtime/useAgentChatPanelProviderValue.ts");
    const eventsSource = readFeature("../../components/agent-chat-panel/runtime/useDaemonAgentEvents.ts");

    expect(railSource).toContain("openThreadTarget");
    expect(railSource).not.toContain("runtime.openThread(thread.id)");
    expect(railSource).toContain("DEFAULT_THREAD_DATE_FILTER");
    expect(railSource).toContain("Loading threads.");
    expect(railSource).toContain("loadedAgentFilterRef.current == null ? 0");
    expect(railSource).toContain("refreshSubAgents");
    expect(source).toContain("onScroll");
    expect(source).toContain("loadOlderThreadMessages");
    expect(railSource).toContain("threadHistoryLabel");
    expect(railSource).toContain("threadTabs");
    expect(railSource).toContain("fixedThreadTabs");
    expect(railSource).toContain("agentFilterOptions");
    expect(railSource).toContain("Agents & subagents");
    expect(source).toContain("Loading messages");
    expect(railSource).not.toContain("threadTabs.map");
    expect(railSource).toContain("dateFilters");
    expect(railSource).toContain("includeInternal: true");
    expect(railSource).toContain("resolveThreadListSource(daemonFilteredThreads, runtime.filteredThreads)");
    expect(railSource).not.toContain("daemonFilteredThreads?.length");
    expect(railSource).toContain("fetchKey");
    expect(railSource).toContain("[daemonAgentFilter, fetchKey, fetchThreadList, tab]");
    expect(railSource).not.toContain("[daemonAgentFilter, runtime, tab]");
    expect(source).toContain("resolveThreadHistoryScrollAction");
    expect(runtimeSource).toContain("loadThreadPage");
    expect(runtimeSource).toContain("latestLoadedThreadIdRef");
    expect(runtimeSource).toContain("loadThreadPage(activeThreadId, \"latest\")");
    expect(runtimeSource).toContain("localThreadId: threadId");
    expect(runtimeSource).toContain("messageOffset");
    expect(runtimeSource).toContain("threadPageLoadChainRef");
    expect(eventsSource).toContain("resolveDaemonEventLocalThreadId");
    expect(eventsSource).toContain("event.thread_id");
  });

  it("hydrates concierge thread actions before navigating into Threads", () => {
    const source = readFeature("../../components/ConciergeToast.tsx");

    expect(source).toContain("useAgentChatPanelRuntime");
    expect(source).toContain("openThreadTarget");
    expect(source).toContain("navigateZorai");
  });

  it("routes the native window menu into current Zorai surfaces", () => {
    const appSource = readFeature("../ZoraiApp.tsx");
    const commandSource = readFeature("../shell/zoraiAppCommands.ts");
    const shellSource = readFeature("../shell/ZoraiShell.tsx");

    expect(appSource).toContain("useZoraiAppCommands");
    expect(appSource).toContain("CommandPalette");
    expect(commandSource).toContain("toggle-command-palette");
    expect(commandSource).toContain("onAppCommand");
    expect(shellSource).toContain("settingsTab");
    expect(shellSource).toContain("toggleContext");
  });
});
