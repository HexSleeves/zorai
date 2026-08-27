import { useMemo, useState } from "react";
import { useAgentChatPanelRuntime } from "@/components/agent-chat-panel/runtime/context";
import { useAuditStore } from "@/lib/auditStore";
import { useNotificationStore } from "@/lib/notificationStore";
import { UsagePanel } from "./ActivityUsagePanel";
import { ActivityInbox } from "./ActivityInbox";
import { buildUsageStats, formatCount } from "./ActivityUsageStats";
import { openThreadTarget } from "../threads/openThreadTarget";
import { navigateZorai } from "../../shell/zoraiNavigationEvents";

type ActivityTab = "inbox" | "timeline" | "reasoning" | "planner" | "usage";

export function ActivityRail() {
  const notifications = useNotificationStore((state) => state.notifications);
  const unreadCount = useNotificationStore((state) => state.unreadCount);
  const auditEntries = useAuditStore((state) => state.entries);
  const { pendingApprovals, scopedOperationalEvents } = useAgentChatPanelRuntime();

  return (
    <div className="zorai-rail-stack">
      <Metric label="Approvals" value={pendingApprovals.length} />
      <Metric label="Ops events" value={scopedOperationalEvents.length} />
      <Metric label="Notifications" value={unreadCount} />
      <Metric label="Inbox" value={notifications.filter((notification) => notification.archivedAt == null && notification.deletedAt == null).length} />
      <Metric label="Audit entries" value={auditEntries.length} />
    </div>
  );
}

export function ActivityView() {
  const runtime = useAgentChatPanelRuntime();
  const [tab, setTab] = useState<ActivityTab>("timeline");
  const [query, setQuery] = useState("");
  const normalizedQuery = query.trim().toLowerCase();

  const operationalEvents = useMemo(() => {
    return runtime.scopedOperationalEvents.filter((event) => {
      if (!normalizedQuery) return true;
      return [event.kind, event.command ?? "", event.message ?? "", event.blastRadius ?? ""]
        .join(" ")
        .toLowerCase()
        .includes(normalizedQuery);
    });
  }, [normalizedQuery, runtime.scopedOperationalEvents]);

  const cognitiveEvents = useMemo(() => {
    return runtime.scopedCognitiveEvents.filter((event) => {
      if (!normalizedQuery) return true;
      return [event.source, event.content].join(" ").toLowerCase().includes(normalizedQuery);
    });
  }, [normalizedQuery, runtime.scopedCognitiveEvents]);

  const todoThreads = useMemo(() => {
    return Object.entries(runtime.daemonTodosByThread).filter(([, todos]) => todos.length > 0);
  }, [runtime.daemonTodosByThread]);

  const usageStats = useMemo(() => {
    return buildUsageStats(runtime.threads, runtime.allMessagesByThread, runtime.goalRunsForTrace);
  }, [runtime.allMessagesByThread, runtime.goalRunsForTrace, runtime.threads]);

  const openThread = async (threadId: string) => {
    if (await openThreadTarget(runtime, threadId)) navigateZorai({ view: "threads" });
  };
  const openGoal = (goalRunId: string) => navigateZorai({ view: "goals", goalRunId });
  const relatedThreadId = (...candidates: Array<string | null | undefined>) => {
    for (const candidate of candidates) {
      if (!candidate) continue;
      const thread = runtime.threads.find((entry) => entry.id === candidate || entry.daemonThreadId === candidate);
      if (thread) return thread.daemonThreadId || thread.id;
    }
    return null;
  };

  return (
    <section className="zorai-feature-surface zorai-activity-surface">
      <div className="zorai-view-header">
        <div>
          <div className="zorai-kicker">Activity</div>
          <h1>Follow approvals, events, and planner state.</h1>
          <p>Activity is the operational timeline for Zorai runs: what happened, what is pending, and what agents are planning next.</p>
        </div>
      </div>

      <div className="zorai-metric-grid">
        <Metric label="Pending approvals" value={runtime.pendingApprovals.length} />
        <Metric label="Operational events" value={runtime.scopedOperationalEvents.length} />
        <Metric label="Reasoning events" value={runtime.scopedCognitiveEvents.length} />
        <Metric label="Usage tokens" value={formatCount(usageStats.totals.totalTokens)} />
      </div>

      <div className="zorai-toolbar">
        <input
          className="zorai-input"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder="Search activity..."
        />
        {(["inbox", "timeline", "reasoning", "planner", "usage"] as const).map((nextTab) => (
          <button
            type="button"
            key={nextTab}
            className={["zorai-ghost-button", tab === nextTab ? "zorai-button--active" : ""].filter(Boolean).join(" ")}
            onClick={() => setTab(nextTab)}
          >
            {nextTab}
          </button>
        ))}
      </div>

      {tab === "inbox" ? <ActivityInbox /> : null}

      {tab === "timeline" ? (
        <div className="zorai-activity-grid">
          <ActivityColumn title="Pending Approvals">
            {runtime.pendingApprovals.length === 0 ? <EmptyActivity text="No approvals are waiting." /> : (
              runtime.pendingApprovals.slice(0, 8).map((approval) => (
                <ActivityItem
                  key={approval.id}
                  title={approval.command || approval.id}
                  meta={approval.status}
                  body={approval.reasons.join("\n") || approval.blastRadius || "Approval request"}
                  provenance={activityProvenance(approval)}
                  actionLabel={relatedThreadId(approval.sessionId, approval.surfaceId) ? "Open related thread" : undefined}
                  onAction={relatedThreadId(approval.sessionId, approval.surfaceId) ? () => void openThread(relatedThreadId(approval.sessionId, approval.surfaceId)!) : undefined}
                />
              ))
            )}
          </ActivityColumn>
          <ActivityColumn title="Operational Timeline">
            {operationalEvents.length === 0 ? <EmptyActivity text="No operational events match." /> : (
              operationalEvents.slice(0, 16).map((event) => (
                <ActivityItem
                  key={event.id}
                  title={event.kind}
                  meta={formatTime(event.timestamp)}
                  body={event.command || event.message || event.blastRadius || "Runtime event"}
                  provenance={activityProvenance(event)}
                  actionLabel={relatedThreadId(event.sessionId, event.surfaceId) ? "Open related thread" : undefined}
                  onAction={relatedThreadId(event.sessionId, event.surfaceId) ? () => void openThread(relatedThreadId(event.sessionId, event.surfaceId)!) : undefined}
                />
              ))
            )}
          </ActivityColumn>
        </div>
      ) : null}

      {tab === "reasoning" ? (
        <div className="zorai-panel">
          <div className="zorai-section-label">Reasoning Trace</div>
          {cognitiveEvents.length === 0 ? <EmptyActivity text="No reasoning events match." /> : (
            cognitiveEvents.slice(0, 20).map((event) => (
              <ActivityItem
                key={event.id}
                title={event.source}
                meta={formatTime(event.timestamp)}
                body={event.content}
                provenance={activityProvenance(event)}
                actionLabel={relatedThreadId(event.sessionId, event.surfaceId) ? "Open related thread" : undefined}
                onAction={relatedThreadId(event.sessionId, event.surfaceId) ? () => void openThread(relatedThreadId(event.sessionId, event.surfaceId)!) : undefined}
              />
            ))
          )}
        </div>
      ) : null}

      {tab === "planner" ? (
        <div className="zorai-activity-grid">
          <ActivityColumn title="Planner Todos">
            {todoThreads.length === 0 ? <EmptyActivity text="No active planner todos." /> : (
              todoThreads.map(([threadId, todos]) => (
                <ActivityItem
                  key={threadId}
                  title={`Thread ${threadId}`}
                  meta={`${todos.length} items`}
                  body={todos.map((todo) => `${todo.status}: ${todo.content}`).join("\n")}
                  provenance={`thread: ${threadId}`}
                  actionLabel="Open in Threads"
                  onAction={() => void openThread(threadId)}
                />
              ))
            )}
          </ActivityColumn>
          <ActivityColumn title="Goal Events">
            {runtime.goalRunsForTrace.length === 0 ? <EmptyActivity text="No goal events are loaded." /> : (
              runtime.goalRunsForTrace.slice(0, 10).map((goal) => (
                <ActivityItem
                  key={goal.id}
                  title={goal.title || goal.goal}
                  meta={goal.status}
                  body={(goal.events ?? []).slice(-3).map((event) => event.message).join("\n") || goal.goal}
                  provenance={[`goal: ${goal.id}`, goal.thread_id ? `thread: ${goal.thread_id}` : ""].filter(Boolean).join(" · ")}
                  actionLabel="Open goal"
                  onAction={() => openGoal(goal.id)}
                />
              ))
            )}
          </ActivityColumn>
        </div>
      ) : null}

      {tab === "usage" ? <UsagePanel stats={usageStats} /> : null}
    </section>
  );
}

function Metric({ label, value }: { label: string; value: number | string }) {
  return (
    <div className="zorai-metric-card">
      <strong>{value}</strong>
      <span>{label}</span>
    </div>
  );
}

function ActivityColumn({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="zorai-panel">
      <div className="zorai-section-label">{title}</div>
      <div className="zorai-activity-list">{children}</div>
    </div>
  );
}

function ActivityItem({
  title,
  meta,
  body,
  provenance,
  actionLabel,
  onAction,
}: {
  title: string;
  meta: string;
  body: string;
  provenance?: string;
  actionLabel?: string;
  onAction?: () => void;
}) {
  return (
    <article className="zorai-activity-item">
      <div>
        <strong>{title}</strong>
        <span>{meta}</span>
      </div>
      <p>{body}</p>
      {provenance ? <code className="zorai-activity-provenance">{provenance}</code> : null}
      {actionLabel && onAction ? <button type="button" className="zorai-ghost-button" onClick={onAction}>{actionLabel}</button> : null}
    </article>
  );
}

function EmptyActivity({ text }: { text: string }) {
  return <div className="zorai-empty-state">{text}</div>;
}

function activityProvenance(item: { id: string; paneId?: string | null; workspaceId?: string | null; surfaceId?: string | null; sessionId?: string | null }): string {
  return [
    `event: ${item.id}`,
    item.sessionId ? `session: ${item.sessionId}` : "",
    item.paneId ? `pane: ${item.paneId}` : "",
    item.surfaceId ? `surface: ${item.surfaceId}` : "",
    item.workspaceId ? `workspace: ${item.workspaceId}` : "",
  ].filter(Boolean).join(" · ");
}

function formatTime(timestamp: number): string {
  return Number.isFinite(timestamp) ? new Date(timestamp).toLocaleTimeString() : "pending";
}
