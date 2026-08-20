import { startTransition, useEffect, useMemo, useRef, useState } from "react";
import { useAgentChatPanelRuntime } from "@/components/agent-chat-panel/runtime/context";
import { useAgentStore, type AgentThread } from "@/lib/agentStore";
import {
  buildThreadFilterTabs,
  daemonAgentFilterForThreadTab,
  dateFilters,
  DEFAULT_THREAD_DATE_FILTER,
  filterThreads,
  fixedThreadTabs,
  overlayStoreThreadTitles,
  resolveThreadCreationAgent,
  resolveThreadListSource,
  type DateFilterId,
  type ThreadFilterTab,
} from "./threadFilterModel";
import { openThreadTarget } from "./openThreadTarget";
import { ZORAI_FOCUS_SEARCH_EVENT, consumePendingFocusSearch } from "../../shell/zoraiNavigationEvents";

const THREAD_FILTER_FETCH_DEBOUNCE_MS = 1000;

export function ThreadsRail() {
  const runtime = useAgentChatPanelRuntime();
  const subAgents = useAgentStore((state) => state.subAgents);
  const storeThreads = useAgentStore((state) => state.threads);
  const refreshSubAgents = useAgentStore((state) => state.refreshSubAgents);
  const [tab, setTab] = useState<ThreadFilterTab>("svarog");
  const [dateFilter, setDateFilter] = useState<DateFilterId>(DEFAULT_THREAD_DATE_FILTER);
  const [fromDate, setFromDate] = useState("");
  const [toDate, setToDate] = useState("");
  const [daemonFilteredThreads, setDaemonFilteredThreads] = useState<AgentThread[] | null>(null);
  const [loadingTab, setLoadingTab] = useState<ThreadFilterTab | null>(null);
  const pendingFetchIdRef = useRef(0);
  const loadedAgentFilterRef = useRef<string | null>(null);
  const searchInputRef = useRef<HTMLInputElement | null>(null);
  const goalThreadIdSet = useMemo(() => goalThreadIds(runtime.goalRunsForTrace), [runtime.goalRunsForTrace]);
  const daemonAgentFilter = useMemo(() => daemonAgentFilterForThreadTab(tab), [tab]);
  const fetchKey = daemonAgentFilter ?? "__all__";
  const fetchThreadList = runtime.fetchThreadList;
  const sourceThreads = useMemo(() => {
    const baseThreads = overlayStoreThreadTitles(
      resolveThreadListSource(daemonFilteredThreads, runtime.filteredThreads),
      storeThreads,
    );
    return filterThreadsForSearchQuery(baseThreads, runtime.searchQuery);
  }, [daemonFilteredThreads, runtime.filteredThreads, runtime.searchQuery, storeThreads]);
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
  ), [goalThreadIdSet, runtime.filteredThreads, subAgents]);
  const agentFilterOptions = useMemo(
    () => threadTabs.filter((item) => item.id.startsWith("agent:")),
    [threadTabs],
  );
  const threadCreationAgent = useMemo(
    () => resolveThreadCreationAgent(tab, subAgents),
    [subAgents, tab],
  );

  useEffect(() => {
    void refreshSubAgents();
  }, [refreshSubAgents]);

  useEffect(() => {
    const focusSearch = () => {
      searchInputRef.current?.focus();
      searchInputRef.current?.select();
    };
    if (consumePendingFocusSearch()) focusSearch();
    const onFocusSearch = () => {
      if (consumePendingFocusSearch()) focusSearch();
    };
    window.addEventListener(ZORAI_FOCUS_SEARCH_EVENT, onFocusSearch);
    return () => window.removeEventListener(ZORAI_FOCUS_SEARCH_EVENT, onFocusSearch);
  }, []);

  useEffect(() => {
    pendingFetchIdRef.current += 1;
    const fetchId = pendingFetchIdRef.current;
    if (loadedAgentFilterRef.current !== fetchKey) setDaemonFilteredThreads(null);
    setLoadingTab(tab);

    const timeoutId = window.setTimeout(() => {
      void fetchThreadList({ agentFilter: daemonAgentFilter, includeInternal: true })
        .then((threads) => {
          if (pendingFetchIdRef.current !== fetchId) return;
          startTransition(() => {
            loadedAgentFilterRef.current = fetchKey;
            setDaemonFilteredThreads(threads);
            setLoadingTab(null);
          });
        })
        .catch(() => {
          if (pendingFetchIdRef.current !== fetchId) return;
          setDaemonFilteredThreads(null);
          setLoadingTab(null);
        });
    }, loadedAgentFilterRef.current == null ? 0 : THREAD_FILTER_FETCH_DEBOUNCE_MS);
    return () => window.clearTimeout(timeoutId);
  }, [daemonAgentFilter, fetchKey, fetchThreadList, tab]);

  const refreshSelectedTab = () => {
    pendingFetchIdRef.current += 1;
    const fetchId = pendingFetchIdRef.current;
    setLoadingTab(tab);
    void fetchThreadList({ agentFilter: daemonAgentFilter, includeInternal: true })
      .then((threads) => {
        if (pendingFetchIdRef.current !== fetchId) return;
        startTransition(() => {
          loadedAgentFilterRef.current = fetchKey;
          setDaemonFilteredThreads(threads);
          setLoadingTab(null);
        });
      })
      .catch(() => {
        if (pendingFetchIdRef.current === fetchId) setLoadingTab(null);
      });
  };

  return (
    <div className="zorai-rail-stack">
      <div className="zorai-rail-actions">
        <button
          type="button"
          className="zorai-primary-button"
          onClick={() => {
            runtime.createThread({
              workspaceId: runtime.activeWorkspace?.id ?? null,
              agentId: threadCreationAgent?.id ?? null,
              agentName: threadCreationAgent?.name ?? null,
            });
            runtime.setChatBackView("threads");
            runtime.setView("chat");
          }}
        >
          New Thread
        </button>
        <button type="button" className="zorai-ghost-button" onClick={refreshSelectedTab}>Refresh</button>
      </div>
      <input ref={searchInputRef} className="zorai-search-input" value={runtime.searchQuery} onChange={(event) => runtime.setSearchQuery(event.target.value)} placeholder="Search threads" />
      <div className="zorai-thread-filter-tabs" aria-label="Thread source filters">
        {fixedThreadTabs.map((item) => (
          <button
            type="button"
            key={item.id}
            className={["zorai-thread-filter-tab", tab === item.id ? "zorai-thread-filter-tab--active" : "", loadingTab === item.id ? "zorai-thread-filter-tab--loading" : ""].filter(Boolean).join(" ")}
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
            onChange={(event) => setTab((event.target.value || "svarog") as ThreadFilterTab)}
          >
            <option value="">Agents & subagents</option>
            {agentFilterOptions.map((item) => <option key={item.id} value={item.id}>{item.label}</option>)}
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
        ) : displayedThreads.map((thread) => (
          <button
            type="button"
            key={thread.daemonThreadId ?? thread.id}
            className={["zorai-thread-item", thread.id === runtime.activeThreadId || thread.daemonThreadId === runtime.activeThread?.daemonThreadId ? "zorai-thread-item--active" : ""].filter(Boolean).join(" ")}
            onClick={() => void openThreadTarget(runtime, thread.daemonThreadId || thread.id)}
          >
            <span className="zorai-thread-title">{thread.title}</span>
            {thread.lastMessagePreview ? <span className="zorai-thread-preview">{thread.lastMessagePreview}</span> : null}
            <span className="zorai-thread-meta">{threadHistoryLabel(thread)} - {new Date(thread.updatedAt).toLocaleDateString()}</span>
          </button>
        ))}
      </div>
    </div>
  );
}

function filterThreadsForSearchQuery(threads: AgentThread[], searchQuery: string): AgentThread[] {
  const lower = searchQuery.trim().toLowerCase();
  return lower
    ? threads.filter((thread) => thread.title.toLowerCase().includes(lower) || thread.lastMessagePreview.toLowerCase().includes(lower))
    : threads;
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
  if (thread.messageCount > 0) return `${thread.messageCount} msgs`;
  if ((thread.totalInputTokens ?? 0) > 0 || (thread.totalOutputTokens ?? 0) > 0 || (thread.totalTokens ?? 0) > 0) return "history";
  return "0 msgs";
}
