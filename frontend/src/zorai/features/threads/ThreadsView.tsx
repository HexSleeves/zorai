import { memo, startTransition, useCallback, useEffect, useMemo, useRef, useState, type UIEvent } from "react";
import { ToolEventRow } from "@/components/agent-chat-panel/chat-view/ToolEventRow";
import { MarkdownContent } from "@/components/agent-chat-panel/chat-view/markdown";
import { buildDisplayItems } from "@/components/agent-chat-panel/chat-view/helpers";
import { useAgentChatPanelRuntime } from "@/components/agent-chat-panel/runtime/context";
import {
  beginProgrammaticThreadHistoryScroll,
  endProgrammaticThreadHistoryScroll,
  resolveThreadHistoryScrollAction,
  shouldFollowThreadHistoryBottom,
  shouldIgnoreThreadHistoryScroll,
} from "@/components/agent-chat-panel/runtime/threadHistoryScroll";
import { useAgentStore, type AgentMessage, type AgentThread } from "@/lib/agentStore";
import { ThreadFilePreviewOverlay } from "./ThreadFilePreviewOverlay";
import { buildThreadFilterTabs, daemonAgentFilterForThreadTab, dateFilters, DEFAULT_THREAD_DATE_FILTER, filterThreads, fixedThreadTabs, resolveThreadListSource, type DateFilterId, type ThreadFilterTab } from "./threadFilterModel";
import { openThreadTarget } from "./openThreadTarget";
import { ThreadComposer } from "./ThreadComposer";
import { useThreadSpeech } from "./useThreadSpeech";

const THREAD_FILTER_FETCH_DEBOUNCE_MS = 1000;

export function ThreadsRail() {
  const runtime = useAgentChatPanelRuntime();
  const subAgents = useAgentStore((state) => state.subAgents);
  const refreshSubAgents = useAgentStore((state) => state.refreshSubAgents);
  const [tab, setTab] = useState<ThreadFilterTab>("svarog");
  const [dateFilter, setDateFilter] = useState<DateFilterId>(DEFAULT_THREAD_DATE_FILTER);
  const [fromDate, setFromDate] = useState("");
  const [toDate, setToDate] = useState("");
  const [daemonFilteredThreads, setDaemonFilteredThreads] = useState<AgentThread[] | null>(null);
  const [loadingTab, setLoadingTab] = useState<ThreadFilterTab | null>(null);
  const pendingFetchIdRef = useRef(0);
  const loadedAgentFilterRef = useRef<string | null>(null);
  const goalThreadIdSet = useMemo(() => goalThreadIds(runtime.goalRunsForTrace), [runtime.goalRunsForTrace]);
  const daemonAgentFilter = useMemo(() => daemonAgentFilterForThreadTab(tab), [tab]);
  const fetchKey = daemonAgentFilter ?? "__all__";
  const fetchThreadList = runtime.fetchThreadList;
  const sourceThreads = useMemo(() => {
    const baseThreads = resolveThreadListSource(daemonFilteredThreads, runtime.filteredThreads);
    return filterThreadsForSearchQuery(baseThreads, runtime.searchQuery);
  }, [daemonFilteredThreads, runtime.filteredThreads, runtime.searchQuery]);
  const displayedThreads = useMemo(() => filterThreads(sourceThreads, {
    tab,
    dateFilter,
    fromDate,
    toDate,
    goalThreadIds: goalThreadIdSet,
    subAgents,
  }), [dateFilter, fromDate, goalThreadIdSet, sourceThreads, subAgents, tab, toDate]);
  const threadTabs = useMemo(() => buildThreadFilterTabs(
    runtime.filteredThreads,
    subAgents,
    goalThreadIdSet,
  ), [runtime.filteredThreads, runtime.goalRunsForTrace, subAgents]);
  const agentFilterOptions = useMemo(
    () => threadTabs.filter((item) => item.id.startsWith("agent:")),
    [threadTabs],
  );

  useEffect(() => {
    void refreshSubAgents();
  }, [refreshSubAgents]);

  useEffect(() => {
    pendingFetchIdRef.current += 1;
    const fetchId = pendingFetchIdRef.current;

    if (loadedAgentFilterRef.current !== fetchKey) {
      setDaemonFilteredThreads(null);
    }
    setLoadingTab(tab);

    const timeoutId = window.setTimeout(() => {
      void fetchThreadList({ agentFilter: daemonAgentFilter, includeInternal: true })
        .then((threads) => {
          if (pendingFetchIdRef.current !== fetchId) {
            return;
          }
          startTransition(() => {
            loadedAgentFilterRef.current = fetchKey;
            setDaemonFilteredThreads(threads);
            setLoadingTab(null);
          });
        })
        .catch(() => {
          if (pendingFetchIdRef.current !== fetchId) {
            return;
          }
          setDaemonFilteredThreads(null);
          setLoadingTab(null);
        });
    }, loadedAgentFilterRef.current == null ? 0 : THREAD_FILTER_FETCH_DEBOUNCE_MS);

    return () => {
      window.clearTimeout(timeoutId);
    };
  }, [daemonAgentFilter, fetchKey, fetchThreadList, tab]);

  const refreshSelectedTab = () => {
    pendingFetchIdRef.current += 1;
    const fetchId = pendingFetchIdRef.current;

    setLoadingTab(tab);
    void fetchThreadList({ agentFilter: daemonAgentFilter, includeInternal: true })
      .then((threads) => {
        if (pendingFetchIdRef.current !== fetchId) {
          return;
        }
        startTransition(() => {
          loadedAgentFilterRef.current = fetchKey;
          setDaemonFilteredThreads(threads);
          setLoadingTab(null);
        });
      })
      .catch(() => {
        if (pendingFetchIdRef.current !== fetchId) {
          return;
        }
        setLoadingTab(null);
      });
  };

  return (
    <div className="zorai-rail-stack">
      <div className="zorai-rail-actions">
        <button
          type="button"
          className="zorai-primary-button"
          onClick={() => {
            runtime.createThread({ workspaceId: runtime.activeWorkspace?.id ?? null });
            runtime.setChatBackView("threads");
            runtime.setView("chat");
          }}
        >
          New Thread
        </button>
        <button type="button" className="zorai-ghost-button" onClick={refreshSelectedTab}>
          Refresh
        </button>
      </div>
      <input
        className="zorai-search-input"
        value={runtime.searchQuery}
        onChange={(event) => runtime.setSearchQuery(event.target.value)}
        placeholder="Search threads"
      />
      <div className="zorai-thread-filter-tabs" aria-label="Thread source filters">
        {fixedThreadTabs.map((item) => (
          <button
            type="button"
            key={item.id}
            className={[
              "zorai-thread-filter-tab",
              tab === item.id ? "zorai-thread-filter-tab--active" : "",
              loadingTab === item.id ? "zorai-thread-filter-tab--loading" : "",
            ].filter(Boolean).join(" ")}
            onClick={() => setTab(item.id)}
            aria-busy={loadingTab === item.id}
          >
            {item.label}
            {loadingTab === item.id ? <span className="zorai-thread-filter-tab__spinner" aria-hidden="true">◌</span> : null}
          </button>
        ))}
      </div>
      {agentFilterOptions.length > 0 ? (
        <div className="zorai-thread-agent-filter">
          <select
            aria-label="Agents and subagents"
            className={tab.startsWith("agent:") ? "zorai-thread-agent-filter--active" : ""}
            value={tab.startsWith("agent:") ? tab : ""}
            onChange={(event) => {
              const next = event.target.value;
              setTab((next || "svarog") as ThreadFilterTab);
            }}
          >
            <option value="">Agents & subagents</option>
            {agentFilterOptions.map((item) => (
              <option key={item.id} value={item.id}>{item.label}</option>
            ))}
          </select>
          {loadingTab?.startsWith("agent:") ? <span className="zorai-thread-filter-tab__spinner" aria-hidden="true">◌</span> : null}
        </div>
      ) : null}
      <div className="zorai-thread-date-filters" aria-label="Thread date filters">
        <select value={dateFilter} onChange={(event) => setDateFilter(event.target.value as DateFilterId)}>
          {dateFilters.map((item) => <option key={item.id} value={item.id}>{item.label}</option>)}
        </select>
        {dateFilter === "custom" ? (
          <>
            <input type="date" value={fromDate} onChange={(event) => setFromDate(event.target.value)} aria-label="From date" />
            <input type="date" value={toDate} onChange={(event) => setToDate(event.target.value)} aria-label="To date" />
          </>
        ) : null}
      </div>
      <div className="zorai-thread-list">
        {displayedThreads.length === 0 ? (
          <div className="zorai-empty">{loadingTab ? "Loading threads." : "No threads match this search."}</div>
        ) : (
          displayedThreads.map((thread) => (
            <button
              type="button"
              key={thread.daemonThreadId ?? thread.id}
              className={[
                "zorai-thread-item",
                thread.id === runtime.activeThreadId || thread.daemonThreadId === runtime.activeThread?.daemonThreadId ? "zorai-thread-item--active" : "",
              ].filter(Boolean).join(" ")}
              onClick={() => {
                void openThreadTarget(runtime, thread.daemonThreadId || thread.id);
              }}
            >
              <span className="zorai-thread-title">{thread.title}</span>
              {thread.lastMessagePreview && (
                <span className="zorai-thread-preview">{thread.lastMessagePreview}</span>
              )}
              <span className="zorai-thread-meta">
                {threadHistoryLabel(thread)} - {new Date(thread.updatedAt).toLocaleDateString()}
              </span>
            </button>
          ))
        )}
      </div>
    </div>
  );
}

function filterThreadsForSearchQuery(threads: AgentThread[], searchQuery: string): AgentThread[] {
  const lower = searchQuery.trim().toLowerCase();
  if (!lower) {
    return threads;
  }
  return threads.filter((thread) =>
    thread.title.toLowerCase().includes(lower)
    || thread.lastMessagePreview.toLowerCase().includes(lower),
  );
}

function goalThreadIds(goalRuns: ReturnType<typeof useAgentChatPanelRuntime>["goalRunsForTrace"]): Set<string> {
  const ids = new Set<string>();
  for (const goal of goalRuns) {
    for (const id of [goal.thread_id, goal.root_thread_id, goal.active_thread_id, ...(goal.execution_thread_ids ?? [])]) {
      if (id) ids.add(id);
    }
  }
  return ids;
}

function threadHistoryLabel(thread: AgentThread): string {
  if (thread.messageCount > 0) {
    return `${thread.messageCount} msgs`;
  }
  if ((thread.totalInputTokens ?? 0) > 0 || (thread.totalOutputTokens ?? 0) > 0 || (thread.totalTokens ?? 0) > 0) {
    return "history";
  }
  return "0 msgs";
}

export function ThreadsView() {
  const runtime = useAgentChatPanelRuntime();
  const [pinLimitResult, setPinLimitResult] = useState<ZoraiThreadMessagePinResult | null>(null);
  const viewMountedAtRef = useRef(Date.now());
  const scrollerRef = useRef<HTMLDivElement | null>(null);
  const previousMessageCountRef = useRef(runtime.messages.length);
  const displayItems = useMemo(() => buildDisplayItems(runtime.messages), [runtime.messages]);
  const latestUserMessage = useMemo(
    () => [...runtime.messages].reverse().find((message) => message.role === "user" && message.content.trim()),
    [runtime.messages],
  );
  const retryLastMessage = useCallback(() => {
    if (!latestUserMessage) return;
    runtime.sendMessage({
      text: latestUserMessage.content,
      localContentBlocks: latestUserMessage.contentBlocks,
    });
  }, [latestUserMessage, runtime.sendMessage]);
  const speech = useThreadSpeech(runtime.messages);

  // Global shortcuts for the thread surface:
  //   Ctrl+L — speak/stop the latest assistant message
  useEffect(() => {
    const onKeyDown = (event: globalThis.KeyboardEvent) => {
      if (!event.ctrlKey || event.shiftKey || event.metaKey || event.altKey) return;
      if (event.code !== "KeyL") return;
      const target = event.target as HTMLElement | null;
      if (target && (target.tagName === "TEXTAREA" || target.tagName === "INPUT" || target.isContentEditable)) {
        return;
      }
      if (!speech.ttsEnabled) return;
      event.preventDefault();
      speech.speakLatestAssistantMessage();
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [speech]);

  const activeThreadId = runtime.activeThread?.id ?? null;

  useEffect(() => {
    const previousCount = previousMessageCountRef.current;
    previousMessageCountRef.current = runtime.messages.length;
    const scroller = scrollerRef.current;
    if (!scroller || !activeThreadId || !shouldFollowThreadHistoryBottom()) return;

    beginProgrammaticThreadHistoryScroll();
    scroller.scrollTop = scroller.scrollHeight;
    endProgrammaticThreadHistoryScroll();

    if (runtime.messages.length > previousCount) {
      runtime.trimThreadMessagesToLatestWindow(activeThreadId);
    }
  }, [activeThreadId, runtime.messages, runtime.trimThreadMessagesToLatestWindow]);

  if (!runtime.activeThread) {
    return (
      <div className="zorai-empty-main">
        <div className="zorai-empty-kicker">Zorai</div>
        <h1>Start with a thread.</h1>
        <p>
          Threads are the default Zorai surface. Create a conversation, bring in an agent,
          then promote durable work into goals or workspace cards when needed.
        </p>
        <button
          type="button"
          className="zorai-primary-button"
          onClick={() => runtime.createThread({ workspaceId: runtime.activeWorkspace?.id ?? null })}
        >
          New Thread
        </button>
      </div>
    );
  }

  const activeThread = runtime.activeThread;

  const handleThreadScroll = async (event: UIEvent<HTMLDivElement>) => {
    if (shouldIgnoreThreadHistoryScroll()) return;
    const scroller = event.currentTarget;
    const action = resolveThreadHistoryScrollAction({
      scrollTop: scroller.scrollTop,
      scrollHeight: scroller.scrollHeight,
      clientHeight: scroller.clientHeight,
    });
    if (action === "load-older") {
      const previousHeight = scroller.scrollHeight;
      const previousTop = scroller.scrollTop;
      const loaded = await runtime.loadOlderThreadMessages();
      if (loaded) {
        requestAnimationFrame(() => {
          scroller.scrollTop = scroller.scrollHeight - previousHeight + previousTop;
        });
      }
      return;
    }
    if (action === "trim-latest" && runtime.trimThreadMessagesToLatestWindow(activeThread.id)) {
      requestAnimationFrame(() => {
        runtime.messagesEndRef.current?.scrollIntoView({ block: "end" });
      });
    }
  };
  return (
    <section className="zorai-thread-surface zorai-native-thread-surface">
      <ThreadHeader
        thread={runtime.activeThread}
        messageCount={runtime.messages.length}
      />
      <ParticipantStrip thread={runtime.activeThread} />

      <div ref={scrollerRef} className="zorai-thread-chat-scroll" onScroll={(event) => void handleThreadScroll(event)}>
        {runtime.messages.length === 0 ? (
          <div className="zorai-thread-empty-state">
            {activeThread.messageCount > 0 || activeThread.lastMessagePreview ? (
              <>
                <strong>Loading messages</strong>
                <span>Fetching the latest history for this thread.</span>
              </>
            ) : (
              <>
                <div className="zorai-brand-mark"><span>Z</span></div>
                <strong>Start a Zorai thread</strong>
                <span>Ask for a plan, delegate work, or turn a request into a goal.</span>
              </>
            )}
          </div>
        ) : displayItems.map((item) => {
          if (item.type === "tool") {
            return <ToolEventRow key={`tool_${item.group.key}`} group={item.group} />;
          }

          const message = item.message;
          if (isMetacognitionSystemMessage(message)) {
            return <MetacognitionEventRow key={message.id} message={message} />;
          }

          return (
            <MessageBubble
              key={message.id}
              message={message}
              threadAgentName={runtime.activeThread?.agent_name}
              ttsEnabled={speech.ttsEnabled}
              speaking={speech.speakingMessageId === message.id}
              speechLoading={speech.loadingMessageId === message.id}
              speechQueued={speech.queuedMessageIds.includes(message.id)}
              onSpeak={() => void speech.speakMessage(message)}
              onRetry={isRetryableErrorMessage(message)
                && isMessageFromCurrentViewSession(message, viewMountedAtRef.current)
                && latestUserMessage
                ? retryLastMessage
                : undefined}
              onPin={async () => {
                const result = await runtime.pinMessageForCompaction(runtime.activeThread?.id ?? message.threadId, message.id);
                if (result && result.ok === false && result.error === "pinned_budget_exceeded") {
                  setPinLimitResult(result);
                }
              }}
              onUnpin={() => void runtime.unpinMessageForCompaction(runtime.activeThread?.id ?? message.threadId, message.id)}
            />
          );
        })}
        {runtime.isStreamingResponse ? (
          <ThinkingIndicator agentName={runtime.activeThread.agent_name} />
        ) : null}
        <div ref={runtime.messagesEndRef} />
      </div>

      <ThreadComposer />

      {pinLimitResult ? (
        <PinLimitModal result={pinLimitResult} onClose={() => setPinLimitResult(null)} />
      ) : null}
      <ThreadFilePreviewOverlay />
    </section>
  );
}

function ThreadHeader({
  thread,
  messageCount,
}: {
  thread: AgentThread;
  messageCount: number;
}) {
  return (
    <header className="zorai-thread-header">
      <div>
        <div className="zorai-kicker">Thread</div>
        <h2>{thread.title}</h2>
        <span>{messageCount} messages / {thread.agent_name}</span>
      </div>
      <ThreadRuntimeSummary thread={thread} />
    </header>
  );
}

function ThreadRuntimeSummary({ thread }: { thread: AgentThread }) {
  const provider = thread.profileProvider || "default provider";
  const model = thread.profileModel || "default model";
  return (
    <div className="zorai-thread-runtime-summary" title="Provider, model, effort and context settings live in the Show Context panel">
      <span className="zorai-thread-runtime-summary__model" title="Model">{model}</span>
      <span className="zorai-thread-runtime-summary__provider" title="Provider">{provider}</span>
    </div>
  );
}

function ThinkingIndicator({ agentName }: { agentName: string }) {
  return (
    <div className="zorai-thinking" role="status" aria-live="polite">
      <div className="zorai-brand-mark zorai-thinking__avatar" aria-hidden="true" />
      <div className="zorai-thinking__body">
        <div className="zorai-thinking__label">
          <strong>{agentName}</strong>
          <span className="zorai-thinking__dots" aria-hidden="true">
            <span />
            <span />
            <span />
          </span>
        </div>
        <div className="zorai-thinking__phase">Thinking…</div>
      </div>
    </div>
  );
}

function ParticipantStrip({ thread }: { thread: AgentThread }) {
  const participants = thread.threadParticipants ?? [];
  const queued = thread.queuedParticipantSuggestions ?? [];
  if (participants.length === 0 && queued.length === 0) return null;

  return (
    <div className="zorai-thread-participants">
      {participants.map((participant) => (
        <span key={participant.agentId} className="zorai-status-pill">
          {participant.agentName} / {participant.status}
        </span>
      ))}
      {queued.map((suggestion) => (
        <span key={suggestion.id} className="zorai-status-pill">
          queued: {suggestion.targetAgentName}
        </span>
      ))}
    </div>
  );
}

const MessageBubble = memo(function MessageBubble({
  message,
  threadAgentName,
  onPin,
  onUnpin,
  ttsEnabled,
  speaking,
  speechLoading,
  speechQueued,
  onSpeak,
  onRetry,
}: {
  message: AgentMessage;
  threadAgentName?: string;
  onPin: () => void | Promise<void>;
  onUnpin: () => void | Promise<void>;
  ttsEnabled: boolean;
  speaking: boolean;
  speechLoading: boolean;
  speechQueued: boolean;
  onSpeak: () => void;
  onRetry?: () => void;
}) {
  const [retryDismissed, setRetryDismissed] = useState(false);
  const fromUser = message.role === "user";
  const author = message.authorAgentName ?? (fromUser ? "You" : message.role === "assistant" ? (threadAgentName ?? "Zorai") : message.role);
  const tokenText = message.totalTokens > 0 ? `${message.totalTokens.toLocaleString()} tokens` : null;
  const hasVisibleContent = message.content.trim().length > 0;
  const shouldRenderContent = hasVisibleContent || !message.reasoning;

  return (
    <article id={`zorai-message-${message.id}`} className={["zorai-message", fromUser ? "zorai-message--user" : "", message.pinnedForCompaction ? "zorai-message--pinned" : ""].filter(Boolean).join(" ")}>
      <div className="zorai-message__meta">
        <strong>{author}</strong>
        <span>{formatTime(message.createdAt)}{tokenText ? ` / ${tokenText}` : ""}</span>
      </div>
      {message.reasoning ? (
        <details className="zorai-message__reasoning">
          <summary className="zorai-message__reasoning-toggle">Reasoning</summary>
          <div>
            <MarkdownContent content={message.reasoning} />
          </div>
        </details>
      ) : null}
      {shouldRenderContent ? (
        <div className="zorai-message__content">
          {hasVisibleContent ? <MarkdownContent content={message.content} /> : null}
        </div>
      ) : null}
      {message.toolCalls && message.toolCalls.length > 0 ? (
        <div className="zorai-message__tools">{message.toolCalls.length} tool calls</div>
      ) : null}
      {onRetry && !retryDismissed ? (
        <div className="zorai-message-retry" role="alert">
          <div>
            <strong>{isRateLimitError(message.content) ? "Provider rate limit" : "Agent request failed"}</strong>
            <span>Retry the last message?</span>
          </div>
          <div className="zorai-message-retry__actions">
            <button type="button" className="zorai-primary-button" onClick={onRetry}>Yes, retry</button>
            <button type="button" className="zorai-ghost-button" onClick={() => setRetryDismissed(true)}>No</button>
          </div>
        </div>
      ) : null}
      <div className="zorai-message__actions">
        {ttsEnabled && message.content.trim() ? (
          <button
            type="button"
            className={["zorai-ghost-button zorai-message-action", speaking ? "zorai-button--active" : ""].filter(Boolean).join(" ")}
            disabled={speechLoading}
            title={speechLoading ? "Synthesizing speech…" : speechQueued ? "Queued for playback" : speaking ? "Stop speech (Ctrl+L)" : "Read aloud (Ctrl+L plays latest)"}
            aria-label={speechLoading ? "Synthesizing speech" : speechQueued ? "Queued for playback" : speaking ? "Stop speech" : "Read aloud"}
            onClick={onSpeak}
          >
            <MessageActionIcon kind="speak" animated={speechLoading || speaking || speechQueued} />
          </button>
        ) : null}
        {message.pinnedForCompaction ? (
          <button
            type="button"
            className="zorai-ghost-button zorai-message-action zorai-button--active"
            title="Unpin from compaction"
            aria-label="Unpin from compaction"
            onClick={() => void onUnpin()}
          >
            <MessageActionIcon kind="pin" filled />
          </button>
        ) : (
          <button
            type="button"
            className="zorai-ghost-button zorai-message-action"
            title="Pin for compaction"
            aria-label="Pin for compaction"
            onClick={() => void onPin()}
          >
            <MessageActionIcon kind="pin" />
          </button>
        )}
      </div>
    </article>
  );
}, (previous, next) => (
  previous.message === next.message
  && previous.threadAgentName === next.threadAgentName
  && previous.ttsEnabled === next.ttsEnabled
  && previous.speaking === next.speaking
  && previous.speechLoading === next.speechLoading
  && previous.speechQueued === next.speechQueued
  && previous.onRetry === next.onRetry
));

function MessageActionIcon({ kind, filled = false, animated = false }: { kind: "speak" | "pin"; filled?: boolean; animated?: boolean }) {
  if (kind === "speak") {
    return (
      <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
        <polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5" fill={filled ? "currentColor" : "none"} />
        <path className={animated ? "zorai-speak-wave zorai-speak-wave--1" : undefined} d="M15.54 8.46a5 5 0 0 1 0 7.07" />
        <path className={animated ? "zorai-speak-wave zorai-speak-wave--2" : undefined} d="M19.07 4.93a10 10 0 0 1 0 14.14" />
      </svg>
    );
  }
  return (
    <svg width="15" height="15" viewBox="0 0 24 24" fill={filled ? "currentColor" : "none"} stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M12 17v5" />
      <path d="M9 3h6l-1 7 3 3v2H7v-2l3-3-1-7z" />
    </svg>
  );
}

function isMessageFromCurrentViewSession(message: AgentMessage, mountedAt: number): boolean {
  // Persisted history is rehydrated after the component mounts. Retry actions
  // are operational UI state, not durable message state, so only errors born
  // during this mounted view may expose Yes/No controls. Normalize seconds in
  // case an older backend supplied Unix-second timestamps.
  const createdAt = message.createdAt < 10_000_000_000
    ? message.createdAt * 1000
    : message.createdAt;
  return createdAt >= mountedAt;
}

function isRetryableErrorMessage(message: AgentMessage): boolean {
  if (message.role !== "assistant" || message.isStreaming) return false;
  const content = message.content.trim();
  return /^error\s*:/i.test(content)
    || /\b429\b|rate[ -]?limit|quota|temporar(?:y|ily) unavailable|timeout|timed out|connection (?:reset|closed)/i.test(content);
}

function isRateLimitError(content: string): boolean {
  return /\b429\b|rate[ -]?limit|quota/i.test(content);
}

function isMetacognitionSystemMessage(message: AgentMessage): boolean {
  return message.role === "system"
    && message.content.trimStart().startsWith("Meta-cognitive intervention");
}

function MetacognitionEventRow({ message }: { message: AgentMessage }) {
  const [collapsed, setCollapsed] = useState(true);
  const content = message.content;

  return (
    <div style={{ border: "1px solid rgba(255,255,255,0.1)", padding: 8, fontFamily: "var(--font-mono)", whiteSpace: "pre-wrap", wordBreak: "break-word", overflowWrap: "anywhere", display: "flex", flexDirection: "column", gap: 6, borderRadius: "var(--radius-sm)", background: "rgba(255,255,255,0.01)", minWidth: 0, maxWidth: "100%", boxSizing: "border-box" }}>
      <button
        type="button"
        onClick={() => setCollapsed((prev) => !prev)}
        style={{
          border: "none",
          background: "transparent",
          padding: 0,
          color: "var(--text-primary)",
          cursor: "pointer",
          fontFamily: "var(--font-mono)",
          fontSize: "var(--text-sm)",
          display: "flex",
          alignItems: "center",
          width: "100%",
          gap: 8,
          minWidth: 0,
        }}
      >
        <span style={{ color: "#DE600A" }}>{collapsed ? "▸" : "▾"}</span>
        <span style={{ minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>Metacognition</span>
      </button>

      {!collapsed && (
        <div className="zorai-message__metacognition">
          <MarkdownContent content={content} />
        </div>
      )}
    </div>
  );
}

function PinLimitModal({
  result,
  onClose,
}: {
  result: ZoraiThreadMessagePinResult;
  onClose: () => void;
}) {
  const attempted = Math.max(0, (result.candidate_pinned_chars ?? 0) - result.current_pinned_chars);

  return (
    <div className="zorai-pin-limit-overlay" role="presentation">
      <section className="zorai-pin-limit-dialog" role="dialog" aria-modal="true" aria-labelledby="zorai-pin-limit-title">
        <div className="zorai-section-label">Pin Limit Reached</div>
        <h2 id="zorai-pin-limit-title">This message cannot be pinned for compaction.</h2>
        <p>
          Pinned messages are injected after the owner compaction artifact and are capped
          at 25% of the active model context window.
        </p>
        <div className="zorai-pin-limit-stats">
          <span>Current pinned chars: {result.current_pinned_chars.toLocaleString()}</span>
          <span>Pinned budget chars: {result.pinned_budget_chars.toLocaleString()}</span>
          <span>Attempted total chars: {(result.candidate_pinned_chars ?? 0).toLocaleString()}</span>
          <span>Attempted message size: {attempted.toLocaleString()}</span>
        </div>
        <div className="zorai-card-actions">
          <button type="button" className="zorai-primary-button" onClick={onClose}>Close</button>
        </div>
      </section>
    </div>
  );
}

function formatTime(timestamp: number): string {
  return Number.isFinite(timestamp)
    ? new Date(timestamp).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })
    : "pending";
}
