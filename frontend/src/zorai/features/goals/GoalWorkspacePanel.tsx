import { useEffect, useMemo, useState, type ReactNode } from "react";
import { getDataDir, listPersistedDir } from "@/lib/persistence";
import { useThreadFilePreview } from "../threads/ThreadFilePreviewContext";
import {
  controlGoalRun,
  formatGoalRunStatus,
  summarizeGoalRunStep,
  type GoalRun,
  type GoalRunControlAction,
} from "@/lib/goalRuns";
import {
  buildGoalWorkspaceModel,
  type GoalProjectionFile,
  type GoalWorkspaceAction,
  type GoalWorkspaceMode,
  type GoalWorkspaceRow,
  type GoalWorkspaceSection,
} from "./goalWorkspaceModel";

export function GoalWorkspacePanel({
  run,
  onRefresh,
  onMessage,
  onOpenThread,
}: {
  run: GoalRun | null;
  onRefresh: () => Promise<void>;
  onMessage: (message: string) => void;
  onOpenThread?: (threadId: string) => void | Promise<void>;
}) {
  const [mode, setMode] = useState<GoalWorkspaceMode>("dossier");
  const [selectedStepId, setSelectedStepId] = useState<string | null>(null);
  const [selectedCenterIndex, setSelectedCenterIndex] = useState(0);
  const [promptExpanded, setPromptExpanded] = useState(false);
  const [expandedStepIds, setExpandedStepIds] = useState<Set<string>>(() => new Set());
  const [projectionFiles, setProjectionFiles] = useState<GoalProjectionFile[]>([]);
  const { openThreadFilePreview } = useThreadFilePreview();

  useEffect(() => {
    let cancelled = false;
    if (!run?.id) {
      setProjectionFiles((current) => (current.length === 0 ? current : []));
      return () => {
        cancelled = true;
      };
    }

    loadGoalProjectionFiles(run.id).then((files) => {
      if (!cancelled) setProjectionFiles(files);
    });
    return () => {
      cancelled = true;
    };
  }, [run?.id]);

  const model = useMemo(() => run ? buildGoalWorkspaceModel(run, {
    mode,
    selectedStepId,
    selectedCenterIndex,
    promptExpanded,
    expandedStepIds,
    projectionFiles,
  }) : null, [expandedStepIds, mode, projectionFiles, promptExpanded, run, selectedCenterIndex, selectedStepId]);

  const control = async (action: GoalRunControlAction) => {
    if (!run || !model) return;
    if (action === "cancel" && !window.confirm("Stop this goal run?")) return;
    if (action === "retry_step" && !window.confirm("Retry the selected step?")) return;
    if (action === "rerun_from_step" && !window.confirm("Rerun from the selected step?")) return;
    const ok = await controlGoalRun(run.id, action, model.selectedStepIndex);
    onMessage(ok ? `Goal ${action.replace(/_/g, " ")} requested.` : "Goal action failed.");
    await onRefresh();
  };

  const runFooterAction = async (action: GoalWorkspaceAction) => {
    if (action.id === "refresh") {
      await onRefresh();
      return;
    }
    if (action.id === "toggle") {
      await control(run?.status === "paused" ? "resume" : "pause");
      return;
    }
    if (action.id === "cancel") await control("cancel");
    if (action.id === "retry") await control("retry_step");
    if (action.id === "rerun") await control("rerun_from_step");
  };

  if (!run || !model) {
    return (
      <div className="zorai-goal-workspace-shell">
        <div className="zorai-panel zorai-empty-state">Select a goal run to inspect its plan, timeline, and actions.</div>
      </div>
    );
  }

  const handlePlanRowClick = (row: GoalWorkspaceRow) => {
    if (handleTargetRow(row)) return;
    if (row.id === "goal-prompt") {
      setPromptExpanded((current) => !current);
      return;
    }
    if (row.id.startsWith("step-")) {
      const stepId = row.id.slice("step-".length);
      setSelectedStepId(stepId);
      setExpandedStepIds((current) => {
        const next = new Set(current);
        if (next.has(stepId)) next.delete(stepId);
        else next.add(stepId);
        return next;
      });
    }
  };

  const handleTargetRow = (row: GoalWorkspaceRow) => {
    if (row.targetThreadId) {
      void onOpenThread?.(row.targetThreadId);
      return true;
    }
    if (row.targetFilePath) {
      openThreadFilePreview({
        path: row.targetFilePath,
        kind: "artifact",
        source: "goal",
        goalRunId: run?.id ?? null,
        isText: true,
        updatedAt: Date.now(),
      });
      return true;
    }
    return false;
  };

  return (
    <div className="zorai-goal-workspace-shell" aria-label="Goal workspace">
      <nav className="zorai-goal-tabs" aria-label="Goal workspace modes">
        {model.tabs.map((tab) => (
          <button
            type="button"
            key={tab.id}
            className={["zorai-goal-tab", tab.active ? "zorai-goal-tab--active" : ""].filter(Boolean).join(" ")}
            onClick={() => {
              setMode(tab.id);
              setSelectedCenterIndex(0);
            }}
          >
            {tab.label}
          </button>
        ))}
      </nav>

      <div className="zorai-goal-workspace-grid">
        <Pane title={model.planTitle} className="zorai-goal-plan-pane">
          <RowList rows={model.planRows} onRowClick={handlePlanRowClick} />
        </Pane>

        <Pane title={model.centerTitle}>
          <RowList
            rows={model.centerRows}
            onRowClick={(row, index) => {
              setSelectedCenterIndex(index);
              handleTargetRow(row);
            }}
          />
        </Pane>

        <Pane title={model.detailTitle}>
          <SectionList sections={model.detailSections} onRowClick={handleTargetRow} />
        </Pane>
      </div>

      <section className="zorai-panel zorai-goal-toolbar">
        <div>
          <div className="zorai-section-label">{model.footerTitle}</div>
          <strong>{model.selectedStepLabel}</strong>
        </div>
        <div className="zorai-card-actions">
          {model.footerActions.map((action) => (
            <button
              key={action.id}
              type="button"
              className={action.id === "toggle" && action.label === "Resume" ? "zorai-primary-button" : "zorai-ghost-button"}
              onClick={() => void runFooterAction(action)}
              disabled={!action.enabled}
            >
              {action.label}
            </button>
          ))}
        </div>
      </section>

      <div className="zorai-goal-workspace-status">
        <span className="zorai-status-pill">{formatGoalRunStatus(run.status)}</span>
        <span>{summarizeGoalRunStep(run)}</span>
      </div>
    </div>
  );
}

function Pane({
  title,
  className,
  children,
}: {
  title: string;
  className?: string;
  children: ReactNode;
}) {
  return (
    <section className={["zorai-panel zorai-goal-pane", className ?? ""].filter(Boolean).join(" ")}>
      <div className="zorai-section-label">{title}</div>
      <div className="zorai-goal-pane__body">{children}</div>
    </section>
  );
}

function RowList({
  rows,
  onRowClick,
}: {
  rows: GoalWorkspaceRow[];
  onRowClick?: (row: GoalWorkspaceRow, index: number) => void;
}) {
  return (
    <div className="zorai-goal-item-list">
      {rows.map((row, index) => (
        <button
          key={`${row.id}-${index}`}
          type="button"
          className={[
            "zorai-goal-item",
            `zorai-row-tone--${row.tone ?? "normal"}`,
            row.selected ? "zorai-goal-item--selected" : "",
          ].filter(Boolean).join(" ")}
          style={{ paddingLeft: `${10 + (row.depth ?? 0) * 16}px` }}
          onClick={() => onRowClick?.(row, index)}
        >
          <span className="zorai-goal-item__body">
            <span className="zorai-goal-item__text">{row.text}</span>
            {row.meta ? <span className="zorai-goal-item__meta">{row.meta}</span> : null}
          </span>
        </button>
      ))}
    </div>
  );
}

function SectionList({
  sections,
  onRowClick,
}: {
  sections: GoalWorkspaceSection[];
  onRowClick?: (row: GoalWorkspaceRow, index: number) => void;
}) {
  return (
    <div className="zorai-goal-detail-sections">
      {sections.map((section) => (
        <section key={section.title} className="zorai-goal-detail-section">
          <h3>{section.title}</h3>
          <RowList rows={section.rows} onRowClick={onRowClick} />
        </section>
      ))}
    </div>
  );
}

async function loadGoalProjectionFiles(goalRunId: string): Promise<GoalProjectionFile[]> {
  const dataDir = await getDataDir();
  if (!dataDir) return [];
  const root = `goals/${goalRunId}`;
  const files: GoalProjectionFile[] = [];
  const visit = async (relativeDir: string) => {
    const entries = await listPersistedDir(relativeDir);
    for (const entry of entries) {
      if (entry.isDirectory) {
        await visit(entry.path);
      } else {
        files.push({
          relativePath: entry.path.startsWith(`${root}/`) ? entry.path.slice(root.length + 1) : entry.path,
          absolutePath: `${dataDir.replace(/\/$/, "")}/${entry.path}`,
          sizeBytes: null,
        });
      }
    }
  };
  await visit(root);
  return files.sort((a, b) => a.relativePath.localeCompare(b.relativePath));
}
