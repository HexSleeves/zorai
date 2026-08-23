# Code View Redesign Design

**Date:** 2026-08-23
**Branch:** `feature/code-view-redesign`
**Worktree:** `/mnt/e/gitlab/it/zorai-worktrees/code-view-redesign`
**Status:** Approved

## Objective

Turn the existing workspace/file-editor implementation into a first-class **Code** surface that follows the current VS Code information architecture while remaining native to the Zorai shell. Code must reuse the existing Threads conversation/runtime stack directly, not implement or synchronize a second chat system.

## Product contract

- Add **Code** above **Threads** in the Zorai global rail.
- Keep **Threads** as the default surface when Zorai starts.
- Move the workspace editor out of `Tools`; the old `Tools → Workspace` entry is removed or redirects to Code.
- Use the four existing shell regions for Code:
  1. global rail;
  2. contextual rail as Explorer;
  3. main area as editor;
  4. right collapsible panel as Agent.
- In Code, the collapsed right-side tab says **Agent**, not Context.
- A canonical folder or managed worktree maps to one persistent real daemon thread.
- That thread is visible and operable from Threads; Code and Threads display the same persisted messages and runtime state.

## Architecture

### Shared thread runtime

The application keeps one `AgentChatPanelProvider`. Code consumes the same `useAgentChatPanelRuntime` state used by Threads. It must not create another provider, mirrored message list, chat reducer, persistence path, or synchronization mechanism.

Extract reusable conversation primitives below `ThreadsView`:

- message timeline and history scrolling;
- tool/activity rows;
- retry and streaming status;
- shared `ThreadComposer`;
- attachment/file-preview support;
- configurable compact/full header chrome.

`ThreadsView` composes those primitives into the full conversation page. `CodeAgentPane` composes them into the narrow right pane.

All existing behavior remains daemon-authoritative: message persistence, streaming, stop/retry, tool calls, approvals, attachments, voice, queued follow-ups, compaction, pinned messages, participants, handoff state, provider/model settings, and spawned-agent reports.

### Folder-to-thread binding

Persist only this association in the renderer’s durable local store:

```text
canonical folder/worktree root → daemon thread ID
```

Opening a folder:

1. select a directory through the native Electron folder picker or optional manual path action;
2. validate/canonicalize it through the existing root-constrained workspace service;
3. restore its mapped daemon thread when valid;
4. otherwise create a normal thread titled initially `Code · <folder>`;
5. open that thread through the existing runtime;
6. persist `ThreadWorkspaceContext` with root, active file, selection, explicit attachments, open files, isolation setting, and worktree state.

The initial generated title is not permanent; renaming the thread from Threads or Code updates the same thread.

Lifecycle behavior:

- Missing folder: keep conversation accessible and show Locate/Open Another Folder.
- Missing/deleted mapped thread: create a replacement on explicit confirmation or first send, then update the mapping.
- Rejected/inaccessible root: disable filesystem operations and show the reason; do not hide or destroy conversation history.
- Different worktree paths are different Code workspaces unless explicitly rebound.
- Closing a Code workspace removes only its local mapping. It never deletes files or the daemon thread.

## Shell and navigation

Extend `ZoraiViewId` and navigation metadata with `code`. Order:

1. Code
2. Threads
3. Goals
4. Workspaces
5. Database
6. Tools
7. Activity
8. Settings

`getDefaultZoraiView()` continues returning `threads`.

For Code:

- contextual rail label is Explorer;
- main view is the Code editor surface without the Tools page header or Tools tab strip;
- right-panel title and collapsed handle are Agent;
- Agent opens by default on first Code entry, but later honors the operator’s open/collapsed preference.

## Explorer

### Open-folder flow

The empty state contains one primary **Open Folder…** button using Electron’s native directory picker. Raw path entry is not required.

A secondary `…` menu exposes **Open Path Manually** for copied WSL/terminal paths. The manual input is hidden until requested.

The selected root still passes through existing secure canonicalization and root-bound filesystem APIs; the picker does not grant unrestricted renderer filesystem access.

### Information architecture

The Code contextual rail uses a fixed header and one vertical scroll owner. Inside it:

- root/worktree heading;
- Open Editors;
- Files tree;
- Source Control;
- Problems;
- Tests;
- Outline;
- Worktrees;
- Agent Changes.

The filesystem tree is the primary content. Secondary sections are collapsible and compact. Remove the current composition of many independently height-limited, independently scrolling panels. The Explorer body owns vertical scrolling so the tree is always reachable and wheel events do not become trapped in stacked sections.

Keep lazy directory loading, Git decorations, create/rename/delete, search, diagnostics, tests, source-control operations, history, worktrees, isolated review, and operation revert. Reorganize these capabilities; do not remove them.

## Editor and tabs

Remove the Tools feature header and duplicate horizontal tool selector from Code.

The file-tab strip:

- is one row and never wraps;
- preserves active, dirty, pin, close, reorder, and persisted ordering behavior;
- lets tabs shrink to a defined minimum width;
- supports horizontal wheel/trackpad scrolling;
- exposes hidden files through a trailing overflow dropdown;
- does not consume editor vertical scroll.

The editor column and Monaco host retain `min-width: 0` and `min-height: 0`; Monaco owns editor-content scrolling.

Retain breadcrumbs, save/reload/rename/delete, conflict-safe writes, diff/external-diff mode, diagnostics, test gutter results, LSP, outline navigation, and status information.

## Code Agent pane

The right pane is a compact projection of the folder’s real daemon thread. It contains:

- compact identity/header with active responder and runtime profile;
- active workspace/file/selection/attachment chips from the same thread workspace store;
- shared message timeline and activity/tool rows;
- shared `ThreadComposer`;
- access to existing spawned-agent inspection/navigation without automatically leaving the parent conversation.

Opening the same daemon thread in Threads shows identical messages. Switching back to Code resumes the same conversation and runtime state.

## Composer agent/subagent target menu

Extend the shared composer used by both Threads and Code with a target selector.

### Agents

The Agents group lists the same routable built-in/configured agents as the existing thread handoff control. Selecting an agent performs the existing thread handoff route and sends through normal `runtime.sendMessage`. The selected agent remains the responder for later messages until changed or returned.

No provider/model configuration is duplicated into Code-specific state.

### Subagents

The Subagents group lists enabled subagent definitions. Selecting one changes the next send into a one-shot **Delegate task** operation:

- invoke a typed Electron/daemon bridge that submits the existing `spawn_subagent` contract;
- parent is the current Code daemon thread;
- pass selected definition plus current root, active file, selection, and explicit attachments as scoped context;
- use existing runtime/default budgets, depth limits, provider/model resolution, governance, and active-child capacity enforcement;
- keep the parent conversation visible;
- render existing accepted/started/completed/error activity in the parent;
- report the child outcome into the parent through existing subagent-report machinery;
- reset the composer target to the current parent responder after dispatch.

Do not navigate automatically into the child. Existing Spawned UI remains available for explicit inspection/opening.

The React layer does not create child tasks itself and does not duplicate daemon orchestration logic.

## Error and recovery behavior

- Folder-picker cancellation is a no-op.
- Workspace validation errors appear in the Code empty/Explorer state without creating a mapping.
- Agent handoff approval/rejection uses existing workflow notices and approval UI.
- Subagent rejection, approval requirement, capacity limit, or provider failure appears as existing parent-thread activity/error output. The selected draft remains available for retry when dispatch did not start.
- External file conflicts retain current compare/reload protections.
- Missing LSP or test runtime degrades existing sections without blocking editing.
- If the Agent pane has no mapped thread yet, it offers Create Code Thread and creates through the normal runtime.

## Accessibility and responsive behavior

- Global Code item has an accessible label and selected state.
- Explorer sections, overflow tabs, and Agent target menu are keyboard navigable.
- Open Folder and manual path actions have distinct labels.
- At constrained widths, preserve the editor first: Explorer and Agent collapse through existing shell controls rather than overlaying Monaco unpredictably.
- Tab overflow remains keyboard accessible and indicates dirty files.

## Verification

### Automated frontend coverage

- Code appears above Threads; Threads remains startup default.
- Code is not nested under Tools; old Workspace selection redirects or is absent.
- Open Folder is primary; manual path input is hidden until requested.
- Folder-to-thread mapping restores the real daemon thread and recovers missing mappings.
- Code and Threads resolve the same daemon thread and messages.
- Code compact conversation uses shared timeline/composer primitives under one provider.
- Agent target invokes existing handoff and persists as responder.
- Subagent target dispatches once, keeps parent visible, supplies workspace context, and resets after accepted dispatch.
- Rejected delegation preserves draft/target for retry.
- Explorer has one vertical scroll owner with all sections populated.
- File tabs never wrap, expose overflow, and preserve active/dirty/pinned state.
- Right collapsed handle says Agent for Code and Context for other views.

### Commands

```bash
cd frontend
npm test -- --run <focused Code/Threads suites>
npm test -- --run
npm run lint
npm run build
```

Run focused Electron workspace tests for the directory picker and root validation. If the typed subagent bridge changes Rust/protocol code, also run the narrow relevant Rust tests and:

```bash
cargo check -p zorai-daemon -p zorai-protocol
```

### Manual Electron smoke

- Launch starts in Threads.
- Code appears above Threads.
- Open Folder invokes native directory chooser and opens the Explorer without typing a path.
- Populate secondary Explorer sections and verify the files tree remains scrollable/reachable.
- Open enough files to force tab overflow; verify no wrapping and usable editor scrolling.
- Send from Code, open the mapped thread in Threads, and verify identical history.
- Select another agent and verify real handoff behavior.
- Delegate one message to a subagent; remain on parent, observe lifecycle, and verify final report.
- Collapse/reopen the right Agent pane and restart the UI to verify mapping and preference restoration.

## Non-goals

- No remote Git push or new remote-side-effect path.
- No second Code-specific message database or chat store.
- No child-thread auto-navigation for delegation.
- No multi-root workspace in this slice.
- No replacement of Monaco, the secure workspace service, or existing daemon thread persistence.
