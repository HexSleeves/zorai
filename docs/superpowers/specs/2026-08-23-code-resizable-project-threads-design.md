# Code Resizable Panels and Project Thread History Design

**Date:** 2026-08-23
**Branch:** `design/code-resizable-project-threads`
**Worktree:** `/mnt/e/gitlab/it/zorai-worktrees/code-resizable-project-threads`
**Status:** Approved in conversation; pending written-spec review

## Objective

Extend the first-class Code workspace with horizontally resizable Explorer and Agent panels and a project-scoped thread control in the Code Agent header. The header uses the approved **Option A** arrangement: compact current-thread identity on the left and rounded **+** and clock/history buttons at the top right.

The feature must reuse daemon-authoritative threads and the existing Threads runtime. It must not introduce a Code-only conversation store, duplicate message state, mutate global agent/provider/model settings, or rebuild thread switching outside the existing runtime path.

## Approved product decisions

- The rounded **+** creates a normal daemon thread for the currently opened canonical project root, inherits the current thread's actual responder/owner, and switches Code to the new thread immediately.
- The clock opens a searchable dropdown of threads associated with the current canonical root/CWD.
- Thread status uses one dot with precedence: **needs operator action > working > done-unread > no dot**.
- Done-unread state clears when the thread is opened in either Code or normal Threads.
- The Code composer agent selector remains provisional until the next send. On send, it changes only that thread's responder through the existing handoff route.
- Explorer and Agent widths use one shared persisted Code-layout preference across projects and application restarts.
- Layout approach: shell-native CSS grid handles, not a `react-resizable-panels` refactor.

## Visual and interaction design

### Shell geometry

At desktop widths, Code renders these columns:

```text
global rail | Explorer | resize handle | editor | resize handle | Agent
```

The global rail remains fixed at its current Zorai width. The two resize handles are five-pixel visual separators with a larger pointer hit area where possible without stealing editor content.

Persisted width constraints:

| Region | Default | Minimum | Maximum |
|---|---:|---:|---:|
| Explorer | 280px | 180px | 520px |
| Editor | remaining | 380px | remaining |
| Agent | 320px | 260px | 640px |

Dragging a handle clamps the resized panel against its own limits and the width needed to preserve the editor minimum after accounting for the global rail, other panel, handles, and borders. A window resize reclamps in memory without corrupting the persisted preferred widths; expanding the window restores as much of the preferred widths as constraints permit.

Handles support:

- pointer drag with pointer capture;
- Arrow Left/Right in ten-pixel increments;
- Shift+Arrow in forty-pixel increments;
- Home sets that panel to its minimum;
- End sets it to the largest value permitted by the current viewport and editor minimum;
- double-click resets that panel to its default;
- `role="separator"`, horizontal orientation, focusability, current/min/max ARIA values, and descriptive labels.

Existing collapse behavior remains authoritative. Collapsing Explorer or Agent hides its resize handle and preserves the last expanded preferred width. Reopening restores that width subject to current constraints. At the existing narrow breakpoint where side panels are hidden, handles are also hidden and the editor remains primary.

### Code Agent header — approved Option A

The current compact thread identity stays on the left:

```text
<thread title>
Responder · <actual responder>
```

The top-right corner contains two neutral, rounded icon buttons:

1. **+ — New project thread**
2. **Clock — Project thread history**

Both buttons are keyboard accessible and expose explicit accessible names/tooltips. The controls use the neutral Code palette and do not add another permanent toolbar row.

The clock opens an anchored dropdown below the controls. The dropdown contains:

- autofocus search input;
- project threads sorted by `updatedAt` descending;
- current thread highlighted;
- each thread's title, actual responder, updated time, textual status, and optional status dot;
- Arrow Up/Down navigation, Enter selection, and Escape close;
- click-outside close;
- empty state: `No other threads for this project.`;
- retry affordance if refreshing daemon threads fails.

The menu is bounded to the Agent panel and flips or clamps vertically if needed. It never widens the Agent panel or editor.

## Project-thread identity and switching

### Association model

A thread belongs to the current Code project when its persisted `ThreadWorkspaceContext.root` exactly equals the project's validated canonical root. The main process remains responsible for filesystem canonicalization; the renderer compares already validated canonical strings.

This creates a one-project-to-many-threads relationship without replacing the existing binding store:

- `ThreadWorkspaceContext.root` is the authoritative per-thread project association.
- `CodeWorkspaceBindingStore.threadByRoot[root]` stores the **last active daemon thread** for project restoration.
- A new Code thread receives the current canonical root immediately through `bindRoot(localThreadId, root)`.
- When its daemon ID becomes available, the last-active mapping is updated to that daemon thread ID.
- Switching history entries also updates the root's last-active mapping after the selected daemon thread is confirmed.

Hydration occurs before filtering. The menu overlays locally known thread titles/runtime details onto daemon-fetched thread records by daemon thread ID, following the same identity approach as the normal Threads rail.

### Thread switching

Selecting a history entry invokes `openThreadTarget(runtime, daemonThreadId)`, the same daemon-authoritative path used by normal Threads. Switching must preserve each thread's independent:

- messages and loaded pagination window;
- streaming and retry state;
- responder/handoff stack;
- thread provider/model/reasoning profile;
- operations and tool activity;
- approvals, operator questions, tasks, goals, and spawned-agent reports;
- attachments, active file, selection, and other thread workspace context.

The feature must not copy messages, reuse a React key that destroys another thread's state, or write global provider/model settings when switching.

If a listed daemon thread is confirmed deleted/not found, the stale local project association is removed for that thread only. The current thread remains visible, other thread contexts remain intact, and the menu reports that the thread is unavailable.

## New project thread

The rounded **+** is enabled only when Code has a validated canonical root.

On click:

1. read the current thread's actual responder from the responder stack, falling back to `thread.agent_name`;
2. call the existing normal `runtime.createThread` with title `Code · <project>` and that responder's ID/name;
3. immediately call `runtime.openThread(localThreadId)`;
4. bind the new local thread's workspace context to the current canonical root;
5. preserve the project's filesystem/editor state independently for that new thread;
6. update the root's last-active daemon mapping once daemon linkage exists.

The button does not create a subagent, task, workspace card, goal, or provider/model override. An unsent provisional composer agent choice is ignored; the new thread inherits the current thread's actual persisted responder.

If creation fails before daemon acceptance, Code remains on the previous thread and displays a compact error in the Agent header/menu. No root association is removed.

## Thread status model

### Status contract and precedence

Each project history entry has one derived state:

```ts
type CodeProjectThreadStatus =
  | "needs_operator_action"
  | "working"
  | "done_unread"
  | "idle";
```

Precedence is fixed:

1. `needs_operator_action`
2. `working`
3. `done_unread`
4. `idle`

A higher-priority state suppresses lower-priority dots but the menu may include supporting textual details.

### Evidence sources

Status derives only from structured daemon/runtime evidence associated with the candidate daemon/local thread ID. It must not parse thread titles or arbitrary message prose.

**Needs operator action** when any of these are true:

- an open `OperatorQuestion` has the same local/daemon thread identity;
- an agent task associated through `thread_id` or `parent_thread_id` is `awaiting_approval` or explicitly blocked for operator input;
- a goal associated through `thread_id`, `root_thread_id`, `active_thread_id`, or `execution_thread_ids` is `awaiting_approval`;
- a daemon approval projection includes that thread identity and is pending.

The current legacy approval shape lacks thread identity for some terminal approvals. Those unscoped approvals must not mark every project thread. If thread-scoped approval evidence is unavailable, the status model omits that signal rather than guessing. Implementation may add a narrow thread identity field to the renderer projection when the daemon event already supplies it; it must not infer association from pane alone.

**Working** when any of these are true:

- the candidate is the active thread and `runtime.isStreamingResponse` is true;
- structured operation activity for that thread contains `accepted` or `started` operations;
- an associated task has `queued`, `in_progress`, or `failed_analyzing` status;
- an associated goal is `queued`, `planning`, `running`, or another documented active execution status;
- an associated spawned agent run is non-terminal.

**Done-unread** when:

- a terminal completion/result event or assistant result has a timestamp newer than the thread's persisted `lastReadAt`;
- and neither attention nor working evidence is present.

Ordinary user messages do not create a done-unread state. Failed/budget-exceeded terminal events may be treated as completion results only when they no longer require operator input; otherwise the attention state wins.

**Idle** otherwise.

### Dot presentation

- Amber: needs operator action.
- Blue: working.
- Green: done, unread.
- No dot: idle/read.

Every marked row also includes visible status text and an accessible label/tooltip, so color is not the sole communication channel.

## Shared read state

A small persisted read-state store tracks `lastReadAt` by stable thread identity, preferring daemon thread ID and temporarily falling back to local thread ID before daemon linkage.

Opening a thread in either Code or normal Threads marks it read only after its latest loaded message/activity is rendered. The timestamp written is the newest displayed message/activity timestamp, not blindly `Date.now()`, preventing a race from marking a concurrently arriving completion as read.

When a local thread later receives a daemon ID, its local read timestamp migrates to the daemon key using the maximum timestamp and removes the obsolete local key.

Read-state retention is bounded. Entries absent from all known threads may be pruned during hydration or periodic maintenance; pruning never alters daemon threads or messages.

## Composer owner isolation

The Code-only agent selector remains provisional until message send:

- selecting an agent updates only local composer state;
- submitting the next message calls the existing thread `pushHandoff` route;
- only after successful handoff is the message sent;
- failed/rejected handoff preserves the draft and provisional target;
- successful handoff updates the selected daemon thread's responder stack;
- switching threads resets stale provisional selection and reflects the newly active thread's actual responder.

This path must not call or mutate:

- `updateAgentSetting`;
- global default agent/provider/model/reasoning settings;
- another thread's profile;
- subagent definitions.

The normal Threads composer remains unchanged and does not render the Code target selector.

## Components and ownership

### `codeLayoutStore.ts`

Persisted Code layout preferences and pure clamping logic:

- preferred Explorer and Agent widths;
- defaults/min/max constants;
- viewport-aware effective widths preserving the editor minimum;
- hydration/version migration;
- reset actions.

Persistence uses the repository's existing renderer JSON persistence conventions or a versioned Zustand persist store, with no per-project keys.

### `CodeResizeHandle.tsx`

Reusable left/right separator:

- pointer capture and drag calculation;
- keyboard controls;
- double-click reset;
- ARIA values/labels;
- no knowledge of threads or workspace contents.

### `codeProjectThreads.ts`

Pure domain logic:

- stable thread identity;
- canonical-root filtering;
- daemon/local overlay;
- search and newest-first sorting;
- actual responder resolution;
- status precedence and evidence reduction;
- latest completion timestamp/read comparison.

### `threadReadStateStore.ts`

Shared persisted read timestamps and local-to-daemon key migration. It is consumed by both full Threads and compact Code when an active thread's latest loaded content is displayed.

### `CodeThreadHistoryMenu.tsx`

Accessible rounded clock button and anchored searchable menu. It receives already-derived entries and invokes create/switch/retry callbacks; it does not directly mutate global settings or daemon state.

### `CodeAgentPane.tsx`

Extracted from `CodeView.tsx` to keep responsibilities focused. It owns:

- current project root and project-thread projection;
- compact identity header plus rounded +/clock controls;
- create/switch orchestration through existing runtime methods;
- current project context chips;
- shared compact `ThreadsView`.

`CodeView.tsx` remains responsible for folder selection and root/thread activation. `ZoraiShell.tsx` remains responsible for shell regions, panel collapse state, and Code resize handles/layout variables.

## Error and recovery behavior

- No opened root: + disabled with tooltip `Open a project first`; history shows no project threads.
- Thread refresh failure: keep cached/local project entries, display retry, and never leave the current thread.
- Thread switch failure: menu remains open with an inline error; current conversation stays visible.
- Confirmed deleted thread: remove only the stale local association and refresh the menu.
- Width persistence failure: keep in-memory widths for the session; editing and conversation continue.
- Viewport too narrow for configured widths: clamp effective widths while preserving preferred persisted values for restoration.
- Handoff failure: preserve draft and target; do not mutate global or thread runtime profiles.

## Accessibility

- Resize handles use horizontal separator semantics and report current/min/max width.
- + and clock controls have accessible names and visible focus states.
- History menu supports full keyboard operation and returns focus to the clock when closed.
- Status has both color and textual labels.
- Search input has an explicit label.
- Current history entry exposes `aria-current`.
- Menu and controls remain reachable at constrained heights without overflowing the Agent panel.

## Verification matrix

### Layout tests

- width defaults, hydration, and migration;
- Explorer/Agent min and max clamps;
- editor minimum preserved when both preferred widths are large;
- pointer drag direction and bounds;
- keyboard 10px/40px increments;
- Home/End and double-click reset;
- collapsed and narrow-breakpoint handles hidden;
- persisted preferred widths restored after viewport expansion.

### Project-thread tests

- exact canonical-root filtering;
- exclusion of other roots and unbound threads;
- daemon/local identity overlay;
- search across title/responder and newest-first order;
- last-active root mapping update on switch;
- stale thread recovery without collateral deletion;
- switching uses `openThreadTarget`.

### Status/read tests

- attention beats working and unread;
- working beats unread;
- completed unread appears only after structured completion evidence;
- no guessed status from titles/prose/unscoped approvals;
- shared read clearing from both Code and Threads;
- read timestamp uses latest displayed content;
- local-to-daemon identity migration;
- accessible status labels.

### Creation/owner tests

- + disabled without root;
- current actual responder inherited;
- unsent provisional target ignored;
- title and root binding correct;
- new thread immediately opened;
- daemon mapping updated after linkage;
- no `updateAgentSetting` or global provider/model mutation.

### Composer tests

- selector only in compact Code;
- provisional selection changes nothing before send;
- successful send performs thread handoff then message send;
- failed handoff preserves draft/target;
- switching threads resets stale provisional target;
- normal Threads remains selector-free.

### Real UI verification

At normal and constrained desktop sizes:

1. drag each handle to min, max, and an intermediate width;
2. reload and confirm shared persisted widths;
3. collapse/reopen both panels and confirm width restoration;
4. create two + threads in one project and one thread in another project;
5. confirm history includes only current-root threads;
6. search, switch, and round-trip between project threads;
7. confirm independent messages, owners, provider/model profiles, streaming, and operations remain intact;
8. produce attention, working, done-unread, and idle entries and verify precedence/read clearing;
9. choose an agent provisionally, switch threads, and verify no global setting changes;
10. capture the final Code surface for operator inspection.

## Non-goals

- Replacing the normal Threads rail or its global filters.
- Creating Code-specific message persistence.
- Changing global provider/model settings from Code.
- Project-specific panel width preferences.
- Multiple simultaneous status dots.
- Adding another permanent Agent toolbar row.
- Inferring status from arbitrary message text or thread titles.
