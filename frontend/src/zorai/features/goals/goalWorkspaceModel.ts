import type { AgentQueueTask } from "@/lib/agentTaskQueue";
import {
  formatGoalRunDuration,
  formatGoalRunStatus,
  isGoalRunActive,
  type GoalAgentAssignment,
  type GoalRun,
  type GoalRunEvent,
  type GoalRunStep,
  type TodoStatus,
} from "@/lib/goalRuns";

export type GoalWorkspaceMode =
  | "dossier"
  | "files"
  | "progress"
  | "usage"
  | "active-agent"
  | "threads"
  | "needs-attention";

export type GoalWorkspaceTone = "normal" | "muted" | "active" | "success" | "warning" | "danger" | "accent";

export interface GoalWorkspaceRow {
  id: string;
  text: string;
  tone?: GoalWorkspaceTone;
  depth?: number;
  selected?: boolean;
  /** Owning event for flattened dossier timeline rows. */
  eventId?: string;
  targetThreadId?: string;
  targetFilePath?: string;
  progress?: number;
  working?: boolean;
  indicatorLabel?: string;
  meta?: string;
}

export interface GoalWorkspaceAction {
  id: "toggle" | "cancel" | "accept" | "soft_reject" | "hard_reject" | "refresh";
  label: string;
  enabled: boolean;
}

export interface GoalWorkspaceSection {
  title: string;
  rows: GoalWorkspaceRow[];
}

export interface GoalWorkspaceModel {
  summaryTitle: string;
  tabs: Array<{ id: GoalWorkspaceMode; label: string; active: boolean }>;
  planTitle: string;
  planRows: GoalWorkspaceRow[];
  centerTitle: string;
  centerRows: GoalWorkspaceRow[];
  detailTitle: string;
  detailSections: GoalWorkspaceSection[];
  footerTitle: string;
  selectedStepLabel: string;
  selectedStepIndex: number | null;
  footerActions: GoalWorkspaceAction[];
}

export interface GoalWorkspaceOptions {
  mode?: GoalWorkspaceMode;
  expandedStepIds?: Set<string>;
  promptExpanded?: boolean;
  selectedStepId?: string | null;
  selectedCenterIndex?: number;
  projectionFiles?: GoalProjectionFile[];
  tasks?: AgentQueueTask[];
  detailsExpanded?: boolean;
}

export interface GoalProjectionFile {
  relativePath: string;
  absolutePath: string;
  sizeBytes?: number | null;
}

const modeTabs: Array<{ id: GoalWorkspaceMode; label: string; center: string; detail: string }> = [
  { id: "dossier", label: "Dossier", center: "Run timeline", detail: "Dossier" },
  { id: "files", label: "Files", center: "Files", detail: "File details" },
  { id: "progress", label: "Progress", center: "Progress", detail: "Progress details" },
  { id: "usage", label: "Usage", center: "Usage", detail: "Usage details" },
  { id: "active-agent", label: "Active agent", center: "Active agent", detail: "Runtime details" },
  { id: "threads", label: "Threads", center: "Threads", detail: "Thread details" },
  { id: "needs-attention", label: "Needs attention", center: "Needs attention", detail: "Attention details" },
];

export function splitGoalStepTitle(title: string): { confidence: "low" | "medium" | "high" | null; title: string } {
  if (title.startsWith("[LOW]")) return { confidence: "low", title: title.slice(5).trimStart() };
  if (title.startsWith("[MEDIUM]")) return { confidence: "medium", title: title.slice(8).trimStart() };
  if (title.startsWith("[HIGH]")) return { confidence: "high", title: title.slice(6).trimStart() };
  return { confidence: null, title };
}

export function buildGoalWorkspaceModel(run: GoalRun, options: GoalWorkspaceOptions = {}): GoalWorkspaceModel {
  const mode = options.mode ?? "dossier";
  const selectedStep = selectedStepForRun(run, options.selectedStepId);
  const modeMeta = modeTabs.find((tab) => tab.id === mode) ?? modeTabs[0];
  const tasks = options.tasks ?? [];
  const detailsExpanded = Boolean(options.detailsExpanded);
  const centerRows = detailsExpanded
    ? buildCenterRows(run, mode, options.selectedCenterIndex ?? 0, options.projectionFiles ?? [], tasks)
    : [];

  return {
    summaryTitle: "Goal Mission Control",
    tabs: modeTabs.map((tab) => ({ id: tab.id, label: tab.label, active: tab.id === mode })),
    planTitle: "Plan",
    planRows: buildPlanRows(run, options.expandedStepIds ?? new Set(), Boolean(options.promptExpanded), selectedStep?.id ?? null, tasks),
    centerTitle: modeMeta.center,
    centerRows,
    detailTitle: modeMeta.detail,
    detailSections: detailsExpanded
      ? buildDetailSections(run, mode, selectedStep, options.selectedCenterIndex ?? 0, options.projectionFiles ?? [], tasks)
      : [],
    footerTitle: "Goal actions",
    selectedStepLabel: selectedStep
      ? `${stepPosition(run, selectedStep) + 1}. ${splitGoalStepTitle(selectedStep.title).title}`
      : "Goal prompt",
    selectedStepIndex: selectedStep ? stepPosition(run, selectedStep) : null,
    footerActions: buildFooterActions(run),
  };
}

function buildPlanRows(run: GoalRun, expandedStepIds: Set<string>, promptExpanded: boolean, selectedStepId: string | null, tasks: AgentQueueTask[]): GoalWorkspaceRow[] {
  const rows: GoalWorkspaceRow[] = [
    {
      id: "goal-prompt",
      text: "Goal prompt",
      meta: promptExpanded ? "Hide" : "Show",
      tone: "accent",
    },
  ];

  if (promptExpanded) {
    rows.push({ id: "goal-prompt-body", text: run.goal || "No goal prompt available.", tone: "muted", depth: 1 });
  }

  const mainThread = mainAgentThread(run);
  rows.push(mainThread
    ? { id: "main-thread", text: mainThread.label, meta: "Open thread", tone: "active", targetThreadId: mainThread.threadId }
    : { id: "main-thread-empty", text: "No main agent thread yet.", tone: "muted" });

  const steps = sortedSteps(run);
  const tasksByStep = indexTasksByStep(steps, tasks);
  const todosByStep = indexTodosByStep(run);
  if (steps.length > 0) {
    rows.push({ id: "steps-label", text: "Steps:", tone: "accent" });
  }

  for (const [index, step] of steps.entries()) {
    const expanded = expandedStepIds.has(step.id);
    const parsed = splitGoalStepTitle(step.title);
    const status = stepMarkerState(run, step, index);
    const stepTasks = tasksByStep.get(step.id) ?? [];
    rows.push({
      id: `step-${step.id}`,
      text: `${index + 1}. ${parsed.title}`,
      meta: [stepStatusLabel(status), confidenceLabel(parsed.confidence)].filter(Boolean).join(" · ") || undefined,
      tone: markerTone(status),
      selected: step.id === selectedStepId,
      working: status === "running",
      indicatorLabel: status === "running" ? "Working" : stepStatusLabel(status),
      progress: stepProgress(stepTasks, status),
    });

    if (expanded) {
      for (const task of stepTasks) {
        rows.push({
          id: `task-${task.id}`,
          text: task.title,
          meta: taskActivityLabel(task),
          tone: taskTone(task),
          depth: 1,
          targetThreadId: task.thread_id ?? undefined,
          working: task.status === "in_progress",
          indicatorLabel: task.status === "in_progress" ? "Working" : task.status.replace(/_/g, " "),
          progress: task.progress,
        });
      }
      for (const todo of todosByStep.get(index) ?? []) {
        rows.push({
          id: `todo-${todo.id}`,
          text: todo.content,
          meta: todoStatusLabel(todo.status),
          tone: todo.status === "completed" ? "success" : todo.status === "blocked" ? "danger" : "muted",
          depth: 1,
          indicatorLabel: todoStatusLabel(todo.status),
          progress: todo.status === "completed" ? 100 : todo.status === "in_progress" ? 50 : 0,
        });
      }
      if (step.instructions?.trim()) {
        rows.push({ id: `detail-${step.id}-instructions`, text: step.instructions, meta: "Instructions", tone: "muted", depth: 1 });
      }
      if (step.summary?.trim()) {
        rows.push({ id: `detail-${step.id}-summary`, text: step.summary, meta: "Latest outcome", tone: "active", depth: 1 });
      }
      if (step.error?.trim()) {
        rows.push({ id: `detail-${step.id}-error`, text: step.error, meta: "Error", tone: "danger", depth: 1 });
      }
    }
  }

  return rows;
}

function buildCenterRows(run: GoalRun, mode: GoalWorkspaceMode, selectedIndex: number, projectionFiles: GoalProjectionFile[], tasks: AgentQueueTask[]): GoalWorkspaceRow[] {
  switch (mode) {
    case "dossier":
      return timelineRows(run, selectedIndex);
    case "files":
      return fileRows(run, selectedIndex, projectionFiles);
    case "progress":
      return progressRows(run, selectedIndex, tasks);
    case "usage":
      return usageRows(run, selectedIndex);
    case "active-agent":
      return activeAgentRows(run, selectedIndex, tasks);
    case "threads":
      return threadRows(run, selectedIndex, tasks);
    case "needs-attention":
      return attentionRows(run, selectedIndex);
  }
}

function buildDetailSections(run: GoalRun, mode: GoalWorkspaceMode, selectedStep: GoalRunStep | null, selectedCenterIndex: number, projectionFiles: GoalProjectionFile[], tasks: AgentQueueTask[]): GoalWorkspaceSection[] {
  if (mode === "dossier") return dossierDetails(run, selectedStep, selectedCenterIndex, tasks);
  if (mode === "files") return fileDetails(run, selectedCenterIndex, projectionFiles);
  if (mode === "progress") return progressDetails(run, selectedCenterIndex, tasks);
  if (mode === "usage") return usageDetails(run, selectedCenterIndex);
  if (mode === "active-agent") return activeAgentDetails(run, selectedCenterIndex, tasks);
  if (mode === "threads") return threadDetails(run, selectedCenterIndex, tasks);
  return attentionDetails(run, selectedCenterIndex);
}

function dossierDetails(run: GoalRun, selectedStep: GoalRunStep | null, selectedCenterIndex: number, tasks: AgentQueueTask[]): GoalWorkspaceSection[] {
  const sections: GoalWorkspaceSection[] = [];
  if (selectedStep) {
    const parsed = splitGoalStepTitle(selectedStep.title);
    const rows: GoalWorkspaceRow[] = [
      { id: "selected-title", text: `${stepPosition(run, selectedStep) + 1}. ${parsed.title}`, meta: confidenceLabel(parsed.confidence) || undefined, tone: "active" },
    ];
    if (selectedStep.instructions) rows.push({ id: "instructions", text: selectedStep.instructions, tone: "muted" });
    if (selectedStep.summary) rows.push({ id: "summary", text: selectedStep.summary, tone: "active" });
    if (selectedStep.error) rows.push({ id: "error", text: selectedStep.error, tone: "danger" });
    sections.push({ title: "Selected Step", rows });
  }

  if (run.dossier) {
    const matchingUnit = selectedStep ? run.dossier.units.find((unit) => unit.id === selectedStep.id) : null;
    const rows: GoalWorkspaceRow[] = [
      { id: "projection", text: `Projection ${matchingUnit?.status || run.dossier.projection_state}`, tone: "active" },
    ];
    const summary = matchingUnit?.summary || run.dossier.summary;
    if (summary) rows.push({ id: "dossier-summary", text: summary, tone: "active" });
    if (run.dossier.projection_error) rows.push({ id: "projection-error", text: run.dossier.projection_error, tone: "danger" });
    sections.push({ title: "Execution Dossier", rows });
  }

  const taskRows = relatedTaskRows(run, selectedStep, tasks);
  sections.push({ title: "Related Tasks", rows: taskRows.length ? taskRows : [{ id: "no-tasks", text: "No related tasks.", tone: "muted" }] });

  const selectedRow = timelineRows(run, selectedCenterIndex)[selectedCenterIndex];
  const selectedEvent = selectedRow?.eventId
    ? (run.events ?? []).find((event) => event.id === selectedRow.eventId)
    : undefined;
  if (selectedEvent) {
    const rows: GoalWorkspaceRow[] = [{ id: selectedEvent.id, text: selectedEvent.message, tone: "active" }];
    if (selectedEvent.details) rows.push({ id: `${selectedEvent.id}-details`, text: selectedEvent.details, tone: "muted" });
    for (const todo of selectedEvent.todo_snapshot ?? []) {
      rows.push({ id: `${selectedEvent.id}-${todo.id}`, text: todo.content, meta: todoStatusLabel(todo.status), tone: "muted" });
    }
    sections.push({ title: "Selected Timeline Item", rows });
  }

  return sections;
}

function progressDetails(run: GoalRun, selectedIndex: number, tasks: AgentQueueTask[]): GoalWorkspaceSection[] {
  const rows = progressRows(run, selectedIndex, tasks);
  const selected = rows[selectedIndex] ?? rows[0];
  const details: GoalWorkspaceRow[] = selected ? [selected] : [{ id: "empty", text: "No progress data available.", tone: "muted" }];
  if (run.dossier?.latest_resume_decision) {
    details.push({ id: "resume", text: `${run.dossier.latest_resume_decision.action} via ${run.dossier.latest_resume_decision.reason_code}`, tone: "active" });
    if (run.dossier.latest_resume_decision.reason) details.push({ id: "resume-reason", text: run.dossier.latest_resume_decision.reason, tone: "muted" });
  }
  return [{ title: selected?.text.includes("Resume") ? "Resume Decision" : "Execution Dossier", rows: details }];
}

function usageDetails(run: GoalRun, selectedIndex: number): GoalWorkspaceSection[] {
  const rows = usageRows(run, selectedIndex);
  return [{ title: selectedIndex <= 0 ? "Goal Usage" : "Model Usage", rows: rows.length ? rows : [{ id: "empty", text: "No usage data available.", tone: "muted" }] }];
}

function activeAgentDetails(run: GoalRun, selectedIndex: number, tasks: AgentQueueTask[]): GoalWorkspaceSection[] {
  const rows = activeAgentRows(run, selectedIndex, tasks);
  return [{ title: selectedIndex === 0 ? "Current Owner" : "Runtime Assignment", rows: rows.length ? rows : [{ id: "empty", text: "No runtime owner metadata.", tone: "muted" }] }];
}

function threadDetails(run: GoalRun, selectedIndex: number, tasks: AgentQueueTask[]): GoalWorkspaceSection[] {
  const rows = threadRows(run, selectedIndex, tasks);
  const selected = rows[selectedIndex] ?? rows[0];
  return [{ title: "Thread", rows: selected ? [selected, { id: `${selected.id}-open`, text: "Open linked thread", tone: "accent", targetThreadId: selected.targetThreadId }] : [{ id: "empty", text: "No linked threads available.", tone: "muted" }] }];
}

function attentionDetails(run: GoalRun, selectedIndex: number): GoalWorkspaceSection[] {
  const rows = attentionRows(run, selectedIndex);
  return [{ title: "Status", rows: rows.length ? rows : [{ id: "empty", text: "No blockers or review items.", tone: "muted" }] }];
}

const MAX_TIMELINE_EVENTS = 40;
const MAX_EVENT_TODOS = 12;

function timelineRows(run: GoalRun, selectedIndex: number): GoalWorkspaceRow[] {
  const events = (run.events ?? []).slice(-MAX_TIMELINE_EVENTS).reverse();
  if (events.length === 0) return [{ id: "empty", text: "Waiting for run events.", tone: "muted" }];
  return events.flatMap((event) => eventRows(event)).map((row, index) => ({
    ...row,
    selected: index === selectedIndex,
  }));
}

function eventRows(event: GoalRunEvent): GoalWorkspaceRow[] {
  const rows: GoalWorkspaceRow[] = [{ id: event.id, eventId: event.id, text: event.message || "event", tone: eventTone(event) }];
  if (event.details) rows.push({ id: `${event.id}-details`, eventId: event.id, text: event.details, tone: "muted", depth: 1 });
  for (const todo of (event.todo_snapshot ?? []).slice(0, MAX_EVENT_TODOS)) {
    rows.push({ id: `${event.id}-${todo.id}`, eventId: event.id, text: todo.content, meta: todoStatusLabel(todo.status), tone: "muted", depth: 1 });
  }
  return rows;
}

function fileRows(run: GoalRun, selectedIndex: number, projectionFiles: GoalProjectionFile[]): GoalWorkspaceRow[] {
  if (projectionFiles.length > 0) {
    return projectionFiles.map((file, index) => ({
      id: `file-${file.relativePath}`,
      text: file.relativePath,
      selected: index === selectedIndex,
      targetFilePath: file.absolutePath,
      tone: index === selectedIndex ? "accent" : "normal",
    }));
  }
  const entries: GoalWorkspaceRow[] = [
    ...(run.generated_skill_path ? [{
      id: "generated-skill",
      text: `Generated skill: ${run.generated_skill_path}`,
      targetFilePath: run.generated_skill_path,
    }] : []),
    ...((run.memory_updates ?? []).map((entry, index) => ({ id: `memory-${index}`, text: `Memory update: ${entry}`, tone: "muted" as const }))),
  ];
  return entries.length ? markSelected(entries, selectedIndex) : [{ id: "empty", text: "No goal files yet.", tone: "muted" }];
}

function fileDetails(run: GoalRun, selectedIndex: number, projectionFiles: GoalProjectionFile[]): GoalWorkspaceSection[] {
  const rows = fileRows(run, selectedIndex, projectionFiles);
  const selected = rows[selectedIndex] ?? rows[0];
  if (!selected || selected.id === "empty") return [{ title: "Selected File", rows }];
  const metadata: GoalWorkspaceRow[] = [selected];
  if (selected.targetFilePath) metadata.push({ id: `${selected.id}-path`, text: `Path ${selected.targetFilePath}`, tone: "muted" });
  const projection = projectionFiles.find((file) => file.absolutePath === selected.targetFilePath);
  if (typeof projection?.sizeBytes === "number") metadata.push({ id: `${selected.id}-size`, text: `Size ${projection.sizeBytes} bytes`, tone: "muted" });
  if (selected.targetFilePath) metadata.push({ id: `${selected.id}-open`, text: "Open preview", tone: "accent", targetFilePath: selected.targetFilePath });
  return [{ title: "Selected File", rows: metadata }];
}

function progressRows(run: GoalRun, selectedIndex: number, tasks: AgentQueueTask[]): GoalWorkspaceRow[] {
  const rows: GoalWorkspaceRow[] = [];
  for (const task of tasks.filter((entry) => isTaskWorking(entry))) {
    rows.push({
      id: `live-${task.id}`,
      text: task.title,
      meta: taskActivityLabel(task),
      tone: taskTone(task),
      targetThreadId: task.thread_id ?? undefined,
    });
  }
  if (run.dossier) rows.push({ id: "dossier", text: "Execution dossier", tone: "active" });
  if (run.dossier?.latest_resume_decision) rows.push({ id: "resume", text: "Resume decision", tone: "active" });
  for (const unit of run.dossier?.units ?? []) rows.push({ id: unit.id, text: unit.title, meta: unit.status, tone: unit.status === "completed" ? "success" : "active" });
  return markSelected(rows.length ? rows : [{ id: "empty", text: "No progress data available.", tone: "muted" }], selectedIndex);
}

function usageRows(run: GoalRun, selectedIndex: number): GoalWorkspaceRow[] {
  const rows: GoalWorkspaceRow[] = [];
  if ((run.total_prompt_tokens ?? 0) > 0 || (run.total_completion_tokens ?? 0) > 0 || run.estimated_cost_usd != null) {
    rows.push({ id: "total", text: `Goal total · prompt ${formatCount(run.total_prompt_tokens ?? 0)} · completion ${formatCount(run.total_completion_tokens ?? 0)}${run.estimated_cost_usd != null ? ` · cost ${formatCost(run.estimated_cost_usd)}` : ""}`, tone: "active" });
  }
  for (const usage of run.model_usage ?? []) rows.push({ id: `${usage.provider}-${usage.model}`, text: `${usage.provider}/${usage.model}`, meta: `${usage.request_count} req · in ${formatCount(usage.prompt_tokens)} · out ${formatCount(usage.completion_tokens)}${usage.duration_ms ? ` · ${formatGoalRunDuration(usage.duration_ms)}` : ""}` });
  for (const assignment of runtimeAssignments(run)) rows.push({ id: `role-${assignment.role_id}`, text: `Role ${assignment.role_id}`, meta: assignment.inherit_from_main ? "inherits main" : `${assignment.provider}/${assignment.model}` });
  return markSelected(rows.length ? rows : [{ id: "empty", text: "No usage data available.", tone: "muted" }], selectedIndex);
}

function activeAgentRows(run: GoalRun, selectedIndex: number, tasks: AgentQueueTask[]): GoalWorkspaceRow[] {
  const rows: GoalWorkspaceRow[] = [];
  if (run.current_step_owner_profile) rows.push({ id: "current", text: run.current_step_owner_profile.agent_label, meta: "Current owner", tone: "active" });
  if (run.planner_owner_profile) rows.push({ id: "planner", text: run.planner_owner_profile.agent_label, meta: "Planner", tone: "active" });
  for (const assignment of runtimeAssignments(run)) rows.push({ id: `assignment-${assignment.role_id}`, text: assignment.model, meta: assignment.role_id, tone: assignment.enabled ? "active" : "muted" });
  for (const task of tasks.filter((entry) => isTaskWorking(entry))) rows.push({ id: `active-${task.id}`, text: task.title, meta: taskActivityLabel(task), tone: taskTone(task), targetThreadId: task.thread_id ?? undefined });
  for (const threadId of goalThreadTargets(run)) rows.push({ id: `thread-${threadId}`, text: threadId, meta: "Open thread", tone: "accent", targetThreadId: threadId });
  return markSelected(rows.length ? rows : [{ id: "empty", text: "No runtime owner metadata.", tone: "muted" }], selectedIndex);
}

function threadRows(run: GoalRun, selectedIndex: number, tasks: AgentQueueTask[]): GoalWorkspaceRow[] {
  const entries = goalThreadEntries(run, tasks);
  return markSelected(entries.length
    ? entries.map((entry) => ({ id: entry.threadId, text: entry.label, meta: "Open thread", tone: "accent" as const, targetThreadId: entry.threadId }))
    : [{ id: "empty", text: "No linked threads available.", tone: "muted" }], selectedIndex);
}

function attentionRows(run: GoalRun, selectedIndex: number): GoalWorkspaceRow[] {
  const rows: GoalWorkspaceRow[] = [];
  if (run.last_error) rows.push({ id: "last-error", text: "Last error available", tone: "danger" });
  if (run.dossier?.projection_error) rows.push({ id: "projection-error", text: "Projection error available", tone: "danger" });
  rows.push({ id: "approvals", text: `${run.approval_count ?? 0} approvals`, tone: "active" });
  rows.push({ id: "status", text: formatGoalRunStatus(run.status), meta: "Status", tone: "active" });
  return markSelected(rows, selectedIndex);
}

function buildFooterActions(run: GoalRun): GoalWorkspaceAction[] {
  const actions: GoalWorkspaceAction[] = [];
  if (isGoalRunActive(run)) {
    actions.push({
      id: "toggle",
      label: run.status === "paused" ? "Resume" : "Pause",
      enabled: true,
    });
    if (run.status !== "paused") {
      actions.push({ id: "cancel", label: "Stop", enabled: true });
    }
  }
  if (run.status === "awaiting_review") {
    actions.push({ id: "accept", label: "Accept", enabled: true });
    actions.push({ id: "soft_reject", label: "Soft reject", enabled: true });
    actions.push({ id: "hard_reject", label: "Hard reject", enabled: true });
  }
  actions.push({ id: "refresh", label: "Refresh", enabled: true });
  return actions;
}

function selectedStepForRun(run: GoalRun, selectedStepId?: string | null): GoalRunStep | null {
  const steps = sortedSteps(run);
  return steps.find((step) => step.id === selectedStepId)
    ?? (typeof run.current_step_index === "number" ? steps[run.current_step_index] : null)
    ?? steps[0]
    ?? null;
}

function sortedSteps(run: GoalRun): GoalRunStep[] {
  return [...(run.steps ?? [])].sort((a, b) => (a.position ?? 0) - (b.position ?? 0));
}

function stepPosition(run: GoalRun, step: GoalRunStep): number {
  const index = sortedSteps(run).findIndex((entry) => entry.id === step.id);
  return index >= 0 ? index : 0;
}

function indexTasksByStep(steps: GoalRunStep[], tasks: AgentQueueTask[]): Map<string, AgentQueueTask[]> {
  const result = new Map<string, AgentQueueTask[]>();
  const stepIdByTaskId = new Map(steps.filter((step) => step.task_id).map((step) => [step.task_id as string, step.id]));
  const stepIdByTitle = new Map(steps.map((step) => [step.title, step.id]));
  const validStepIds = new Set(steps.map((step) => step.id));
  for (const task of tasks) {
    const stepId = task.goal_step_id && validStepIds.has(task.goal_step_id)
      ? task.goal_step_id
      : stepIdByTaskId.get(task.id) ?? (task.goal_step_title ? stepIdByTitle.get(task.goal_step_title) : undefined);
    if (!stepId) continue;
    const bucket = result.get(stepId) ?? [];
    bucket.push(task);
    result.set(stepId, bucket);
  }
  return result;
}

function indexTodosByStep(run: GoalRun): Map<number, NonNullable<GoalRunEvent["todo_snapshot"]>> {
  const result = new Map<number, NonNullable<GoalRunEvent["todo_snapshot"]>>();
  const claimed = new Set<number>();
  for (let index = (run.events ?? []).length - 1; index >= 0; index -= 1) {
    const event = run.events?.[index];
    if (!event) continue;
    const byStep = new Map<number, NonNullable<GoalRunEvent["todo_snapshot"]>>();
    for (const todo of event.todo_snapshot ?? []) {
      const stepIndex = todo.step_index ?? event.step_index;
      if (stepIndex == null || claimed.has(stepIndex)) continue;
      const bucket = byStep.get(stepIndex) ?? [];
      bucket.push(todo);
      byStep.set(stepIndex, bucket);
    }
    for (const [stepIndex, todos] of byStep) {
      result.set(stepIndex, todos);
      claimed.add(stepIndex);
    }
  }
  return result;
}

function mainAgentThread(run: GoalRun): { label: string; threadId: string } | null {
  if (run.thread_id) return { label: "Worker", threadId: run.thread_id };
  if (run.active_thread_id) return { label: "Worker", threadId: run.active_thread_id };
  const firstExecution = run.execution_thread_ids?.[0];
  return firstExecution ? { label: "Worker", threadId: firstExecution } : null;
}

function goalThreadTargets(run: GoalRun): string[] {
  return [run.thread_id, run.supervision_thread_id, run.active_thread_id]
    .filter((entry): entry is string => Boolean(entry && entry.trim()))
    .filter((entry, index, list) => list.indexOf(entry) === index);
}

function goalThreadEntries(run: GoalRun, tasks: AgentQueueTask[] = []): Array<{ label: string; threadId: string }> {
  const entries: Array<{ label: string; threadId: string }> = [];
  const push = (label: string, threadId?: string | null) => {
    if (threadId && !entries.some((entry) => entry.threadId === threadId)) entries.push({ label, threadId });
  };
  push("Worker", run.thread_id);
  if (run.supervision_thread_id && run.supervision_thread_id !== run.thread_id) {
    push("Owner", run.supervision_thread_id);
  }
  for (const task of tasks) {
    if (!task.thread_id || task.thread_id === run.thread_id || task.thread_id === run.supervision_thread_id) continue;
    push(task.title || "Spawned helper", task.thread_id);
  }
  return entries;
}

function runtimeAssignments(run: GoalRun): GoalAgentAssignment[] {
  return (run.runtime_assignment_list?.length ? run.runtime_assignment_list : run.launch_assignment_snapshot) ?? [];
}

function relatedTaskRows(run: GoalRun, selectedStep: GoalRunStep | null, tasks: AgentQueueTask[]): GoalWorkspaceRow[] {
  const matching = selectedStep
    ? tasksForStep(tasks, selectedStep)
    : tasks;
  if (matching.length > 0) {
    return matching.map((task) => ({
      id: task.id,
      text: task.title,
      meta: taskActivityLabel(task),
      tone: taskTone(task),
      targetThreadId: task.thread_id ?? undefined,
    }));
  }
  const ids = selectedStep?.task_id ? [selectedStep.task_id] : run.child_task_ids ?? [];
  return ids.map((id) => ({ id, text: id, meta: "Task", tone: "accent" }));
}

function tasksForStep(tasks: AgentQueueTask[], step: GoalRunStep): AgentQueueTask[] {
  return tasks.filter((task) => task.goal_step_id === step.id || task.id === step.task_id || task.goal_step_title === step.title);
}

function isTaskWorking(task: AgentQueueTask): boolean {
  return task.status === "queued" || task.status === "in_progress" || task.status === "blocked" || task.status === "failed_analyzing" || task.status === "awaiting_approval";
}

function taskActivityLabel(task: AgentQueueTask): string {
  const status = task.status === "in_progress" ? `Working ${Math.max(0, Math.min(100, task.progress))}%` : task.status.replace(/_/g, " ");
  const activity = [...(task.logs ?? [])].reverse().find((entry) => entry.message.trim())?.message;
  return activity ? `${status} · ${activity}` : status;
}

function taskTone(task: AgentQueueTask): GoalWorkspaceTone {
  if (task.status === "failed" || task.status === "budget_exceeded") return "danger";
  if (task.status === "blocked" || task.status === "awaiting_approval" || task.status === "failed_analyzing") return "warning";
  if (task.status === "completed") return "success";
  if (task.status === "in_progress") return "active";
  return "muted";
}

function stepProgress(tasks: AgentQueueTask[], status: ReturnType<typeof stepMarkerState>): number {
  if (status === "completed") return 100;
  if (status === "pending") return 0;
  const active = tasks.filter((task) => task.status === "in_progress" || task.status === "completed");
  if (active.length === 0) return status === "running" ? 8 : 0;
  return Math.round(active.reduce((sum, task) => sum + Math.max(0, Math.min(100, task.progress)), 0) / active.length);
}

function stepMarkerState(run: GoalRun, step: GoalRunStep, index: number): "pending" | "completed" | "running" | "error" {
  if (step.status === "completed") return "completed";
  if (step.status === "failed" || Boolean(step.error?.trim())) return "error";
  if (run.current_step_index === index || step.status === "running" || step.status === "planning" || step.status === "awaiting_approval") return "running";
  return "pending";
}

function markerTone(state: ReturnType<typeof stepMarkerState>): GoalWorkspaceTone {
  if (state === "completed") return "success";
  if (state === "running") return "accent";
  if (state === "error") return "danger";
  return "normal";
}

function confidenceLabel(confidence: ReturnType<typeof splitGoalStepTitle>["confidence"]): string {
  if (confidence === "low") return "Low confidence";
  if (confidence === "medium") return "Medium confidence";
  if (confidence === "high") return "High confidence";
  return "";
}

function todoStatusLabel(status: TodoStatus): string {
  if (status === "in_progress") return "In progress";
  if (status === "completed") return "Done";
  if (status === "blocked") return "Blocked";
  return "Todo";
}

function stepStatusLabel(state: ReturnType<typeof stepMarkerState>): string {
  if (state === "completed") return "Completed";
  if (state === "running") return "Running";
  if (state === "error") return "Failed";
  return "Pending";
}

function eventTone(event: GoalRunEvent): GoalWorkspaceTone {
  if (event.phase.includes("error") || event.message.toLowerCase().includes("failed")) return "danger";
  if (event.phase.includes("todo")) return "warning";
  return "normal";
}

function markSelected(rows: GoalWorkspaceRow[], selectedIndex: number): GoalWorkspaceRow[] {
  return rows.map((row, index) => ({ ...row, selected: index === selectedIndex }));
}

function formatCount(value: number): string {
  return Math.round(value).toLocaleString();
}

function formatCost(value: number): string {
  return Math.abs(value) >= 1 ? `$${value.toFixed(2)}` : `$${value.toFixed(4)}`;
}
