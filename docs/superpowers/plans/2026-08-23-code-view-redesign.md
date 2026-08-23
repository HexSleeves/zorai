# Code View Redesign Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a first-class Zorai Code surface that visually matches the approved mockup, reuses the real Threads runtime directly, opens folders natively, keeps the Explorer and editor usable, and supports agent handoff plus one-shot subagent delegation from the shared composer.

**Architecture:** Preserve one global `AgentChatPanelProvider` and one daemon thread per canonical Code root. Split the current monolithic `WorkspaceWorkbench` into a Code controller, Explorer rail, editor surface, and persistent root/thread binding store; split `ThreadsView` into reusable conversation primitives consumed by both Threads and the compact Code Agent pane. Add only narrow typed Electron/daemon bridges for native folder selection and operator-triggered subagent spawning, with the daemon reusing its existing `execute_spawn_subagent` implementation.

**Tech Stack:** React 19, TypeScript, Zustand, Vitest, Electron IPC, Monaco Editor, Rust (`zorai-daemon`, `zorai-protocol`), existing Zorai CSS tokens.

**Normative references:**
- Functional specification: `docs/superpowers/specs/2026-08-23-code-view-redesign-design.md`
- Visual acceptance baseline: `docs/superpowers/specs/assets/code-layout-v1.html`

---

## File structure and responsibility map

### New frontend files

- `frontend/src/zorai/features/code/CodeView.tsx` — Code feature coordinator; binds the active canonical root to its real daemon thread and renders the editor main surface.
- `frontend/src/zorai/features/code/CodeRail.tsx` — Explorer contextual rail with one scroll owner and compact collapsible sections.
- `frontend/src/zorai/features/code/CodeAgentPane.tsx` — narrow right-pane composition of the shared thread conversation primitives.
- `frontend/src/zorai/features/code/CodeEmptyState.tsx` — native Open Folder primary action and optional manual-path disclosure.
- `frontend/src/zorai/features/code/CodeTabs.tsx` — constrained single-row tab strip and overflow menu.
- `frontend/src/zorai/features/code/codeWorkspaceBindingStore.ts` — durable canonical-root to daemon-thread mapping and last-opened Code root.
- `frontend/src/zorai/features/code/codeWorkspaceBindingStore.test.ts` — mapping, restore, stale-thread, and close semantics.
- `frontend/src/zorai/features/code/codeNavigation.test.ts` — Code rail ordering and Threads default contract.
- `frontend/src/zorai/features/code/CodeTabs.test.tsx` — tab overflow, dirty, pinned, and active-file behavior.
- `frontend/src/zorai/features/code/CodeEmptyState.test.tsx` — native picker primary flow and hidden manual input.
- `frontend/src/zorai/features/code/CodeAgentPane.test.tsx` — same-thread runtime projection and Agent-pane chrome.
- `frontend/src/zorai/features/threads/ThreadConversation.tsx` — reusable timeline, scrolling, tool/activity rows, retry/stream status, and shared composer mounting point.
- `frontend/src/zorai/features/threads/ThreadConversation.test.tsx` — shared conversation rendering contract.
- `frontend/src/zorai/features/threads/composerTargetModel.ts` — pure agent/subagent target option and dispatch-state model.
- `frontend/src/zorai/features/threads/composerTargetModel.test.ts` — persistent agent and one-shot subagent target semantics.

### Modified frontend/Electron files

- `frontend/src/zorai/shell/navigation.ts` — add Code before Threads without changing startup default.
- `frontend/src/zorai/shell/ZoraiIcons.tsx` — add Code/files icon using current global-rail stroke language.
- `frontend/src/zorai/shell/ZoraiShell.tsx` — route Code rail/main/right Agent panel and preserve per-view context/agent open state.
- `frontend/src/zorai/shell/ZoraiContextPanel.tsx` — configurable collapsed label and accessible title.
- `frontend/src/zorai/features/tools/tools.ts` — remove the duplicate Workspace tool entry; default Tools selection becomes Terminal.
- `frontend/src/zorai/features/tools/ToolsView.tsx` — remove `WorkspaceWorkbench` routing.
- `frontend/src/components/WorkspaceWorkbench.tsx` — reduce to shared workspace controller/editor behavior or replace with focused Code components; do not leave a duplicate two-column workbench.
- `frontend/src/zorai/features/threads/ThreadsView.tsx` — compose `ThreadConversation` rather than owning a second copy of timeline behavior.
- `frontend/src/zorai/features/threads/ThreadComposer.tsx` — add shared agent/subagent target menu and delegate-and-stay dispatch.
- `frontend/src/components/agent-chat-panel/runtime/types.ts` — expose typed `spawnSubagent` runtime operation.
- `frontend/src/components/agent-chat-panel/runtime/useAgentChatPanelProviderValue.ts` — implement runtime wrapper over the new typed bridge and existing handoff action.
- `frontend/src/lib/workspaceContextStore.ts` — support binding a Code root to an explicitly restored/opened thread without changing context semantics.
- `frontend/src/types/zorai-bridge.d.ts` — native folder picker and typed spawn request/response APIs.
- `frontend/electron/main/core-ipc-handlers.cjs` — native `dialog.showOpenDialog({ properties: ["openDirectory"] })` handler followed by normal workspace validation.
- `frontend/electron/main/agent-ipc-handlers.cjs` — typed subagent spawn IPC/query handler.
- `frontend/electron/preload.cjs` — expose both narrow bridges.
- `frontend/electron/main/workspace-service.test.cjs` or a new adjacent picker test — cancellation, selected directory, and validation behavior.
- `frontend/electron/agent-send-message-target-ipc.test.cjs` plus a new spawn IPC test — request shape and parent-thread preservation.
- `frontend/src/zorai/styles/zorai.css` — exact mockup-aligned Code grid, Explorer density/scrolling, tabs, editor, status bar, and compact Agent pane using existing tokens.

### Modified Rust files

- `crates/zorai-protocol/src/messages/client.rs` — add `AgentSpawnSubagent { thread_id, args_json }`.
- `crates/zorai-protocol/src/messages/daemon.rs` — add a typed spawn response carrying accepted task/thread IDs or error.
- `crates/zorai-daemon/src/server/dispatch_part*.rs` — route the client command and return the typed response.
- `crates/zorai-daemon/src/agent/tool_executor/subagents.rs` — expose a narrow engine method that calls the existing `execute_spawn_subagent`; do not duplicate task creation, budgets, provider validation, limits, session allocation, or reporting.
- Existing focused protocol/server/subagent test modules — direct client spawn succeeds from a normal parent thread and preserves existing validation failures.

---

## Task 1: Lock navigation and visual shell contracts

**Files:**
- Modify: `frontend/src/zorai/shell/navigation.ts`
- Modify: `frontend/src/zorai/shell/ZoraiIcons.tsx`
- Modify: `frontend/src/zorai/shell/ZoraiShell.tsx`
- Modify: `frontend/src/zorai/shell/ZoraiContextPanel.tsx`
- Modify: `frontend/src/zorai/features/tools/tools.ts`
- Modify: `frontend/src/zorai/features/tools/ToolsView.tsx`
- Create: `frontend/src/zorai/features/code/codeNavigation.test.ts`

- [ ] **Step 1: Write the failing navigation test**

Create a pure test that asserts:

```ts
expect(zoraiNavItems.slice(0, 2).map((item) => item.id)).toEqual(["code", "threads"]);
expect(getDefaultZoraiView()).toBe("threads");
expect(zoraiTools.some((tool) => tool.id === "workspace")).toBe(false);
expect(getDefaultZoraiTool()).toBe("terminal");
```

Also export and test a small shell helper:

```ts
expect(contextPanelLabels("code")).toEqual({ title: "Code Agent", collapsed: "Agent" });
expect(contextPanelLabels("threads")).toEqual({ title: "Orchestration Context", collapsed: "Context" });
```

- [ ] **Step 2: Run the focused test and verify RED**

Run:

```bash
cd frontend
npm test -- --run src/zorai/features/code/codeNavigation.test.ts
```

Expected: failure because `code` is not a `ZoraiViewId`, Workspace still lives under Tools, and context labels are static.

- [ ] **Step 3: Implement the navigation and shell route skeleton**

Add `code` to `ZoraiViewId`/`ZoraiNavIconId`, insert it before Threads, preserve `getDefaultZoraiView() === "threads"`, add the Code icon, remove Workspace from `zoraiTools`, and make Tools default to Terminal.

Add a `contextPanelLabels(view)` helper and pass both title and collapsed label to `ZoraiContextPanel`. Add temporary Code route containers with semantic class names only:

```tsx
if (view === "code") return <CodeView />;
if (view === "code") return <CodeRail />;
if (view === "code") return <CodeAgentPane />;
```

The temporary components may render explicit empty states but must be real components, not TODO placeholders.

- [ ] **Step 4: Run the focused test and verify GREEN**

Run the Task 1 command. Expected: all assertions pass.

- [ ] **Step 5: Commit**

```bash
git add frontend/src/zorai/shell frontend/src/zorai/features/tools frontend/src/zorai/features/code
 git commit -m "feat(code): add first-class Code navigation"
```

---

## Task 2: Add native Open Folder and persistent root/thread bindings

**Files:**
- Create: `frontend/src/zorai/features/code/CodeEmptyState.tsx`
- Create: `frontend/src/zorai/features/code/CodeEmptyState.test.tsx`
- Create: `frontend/src/zorai/features/code/codeWorkspaceBindingStore.ts`
- Create: `frontend/src/zorai/features/code/codeWorkspaceBindingStore.test.ts`
- Modify: `frontend/electron/main/core-ipc-handlers.cjs`
- Modify: `frontend/electron/preload.cjs`
- Modify: `frontend/src/types/zorai-bridge.d.ts`
- Modify: `frontend/src/lib/workspaceContextStore.ts`
- Test: `frontend/electron/main/workspace-service.test.cjs` or create `frontend/electron/workspace-open-folder-ipc.test.cjs`

- [ ] **Step 1: Write failing store and picker tests**

Define a versioned persisted state:

```ts
type CodeWorkspaceBindingState = {
  version: 1;
  lastRoot: string | null;
  threadByRoot: Record<string, string>;
};
```

Test canonical replacement, restore, stale thread removal, and closing a mapping without deleting the thread. In the component test assert the initial UI contains `Open Folder…`, does not contain a textbox, and reveals `Open Path Manually` only after the overflow action.

In Electron tests inject/mock `dialog.showOpenDialog` and assert cancellation returns `{ canceled: true, root: null }`; selection calls `workspaceService.openWorkspace(selectedPath)` and returns the validated canonical root.

- [ ] **Step 2: Run focused tests and verify RED**

```bash
cd frontend
npm test -- --run src/zorai/features/code/codeWorkspaceBindingStore.test.ts src/zorai/features/code/CodeEmptyState.test.tsx
node --test electron/workspace-open-folder-ipc.test.cjs
```

Expected: missing store/component/IPC APIs.

- [ ] **Step 3: Implement the narrow picker bridge and binding store**

Expose:

```ts
workspaceSelectFolder?: () => Promise<
  | { canceled: true; root: null }
  | { canceled: false; root: string; name: string; gitRoot: string | null; isGitRepository: boolean }
>;
```

The main process owns `dialog`; renderer receives only a validated workspace result. Implement a Zustand persist store under one key such as `zorai-code-workspaces-v1`. Do not persist file contents or duplicate thread/message data.

- [ ] **Step 4: Connect Code empty-state selection to the existing runtime**

On successful selection:

1. look up `threadByRoot[opened.root]`;
2. call existing `runtime.openThread` when mapped and valid;
3. otherwise call existing `runtime.createThread` with Code title/active workspace;
4. store the real daemon thread ID after creation/open;
5. call existing workspace-context `bindRoot` for that local thread.

Keep manual path flow hidden until explicitly opened; pass it through existing `workspaceOpen`.

- [ ] **Step 5: Run focused tests and verify GREEN**

Run the Task 2 commands. Expected: all pass.

- [ ] **Step 6: Commit**

```bash
git add frontend/electron frontend/src/types frontend/src/lib frontend/src/zorai/features/code
 git commit -m "feat(code): open and restore folder workspaces"
```

---

## Task 3: Split the monolithic workbench into Code Explorer and editor surfaces

**Files:**
- Create: `frontend/src/zorai/features/code/CodeRail.tsx`
- Create: `frontend/src/zorai/features/code/CodeView.tsx`
- Modify: `frontend/src/components/WorkspaceWorkbench.tsx`
- Create: `frontend/src/zorai/features/code/CodeRail.test.tsx`

- [ ] **Step 1: Write a failing single-scroll-owner test**

Render CodeRail with files plus Source Control, Problems, Tests, Outline, Worktrees, and Agent Changes. Assert:

```ts
expect(container.querySelectorAll(".zorai-code-explorer-scroll")).toHaveLength(1);
expect(container.querySelectorAll('[data-scroll-owner="nested"]')).toHaveLength(0);
expect(screen.getByRole("tree", { name: "Workspace files" })).toBeVisible();
```

Assert compact section names and the root heading exist. Test that every secondary section is a native/details or accessible disclosure inside the same scroll body.

- [ ] **Step 2: Run focused test and verify RED**

```bash
cd frontend
npm test -- --run src/zorai/features/code/CodeRail.test.tsx
```

Expected: missing CodeRail and current nested max-height scroll composition.

- [ ] **Step 3: Extract a shared workspace controller**

Move state/effects/actions from `WorkspaceWorkbench` behind a focused hook or controller object consumed by CodeRail and CodeView. Keep secure filesystem, Git, LSP, tests, watchers, worktrees, operation snapshots, save/conflict, and editor behavior unchanged.

Do not exceed the repository’s 500-line limit for newly created files. Split section renderers into focused files if required, for example `CodeExplorerSections.tsx` and `CodeEditorActions.tsx`.

- [ ] **Step 4: Implement CodeRail information architecture**

Use one structure:

```tsx
<aside className="zorai-code-explorer">
  <CodeExplorerHeader />
  <div className="zorai-code-explorer-scroll">
    <OpenEditorsSection />
    <FilesSection role="tree" aria-label="Workspace files" />
    <SourceControlSection />
    <ProblemsSection />
    <TestsSection />
    <OutlineSection />
    <WorktreesSection />
    <AgentChangesSection />
  </div>
  <CodeExplorerStatus />
</aside>
```

Remove independent `max-height + overflow:auto` ownership from the section CSS; long section content expands inside the one body scroll.

- [ ] **Step 5: Implement CodeView editor-only main surface**

CodeView begins directly with file tabs, breadcrumbs, compact actions, Monaco/diff, and status bar. It must not render `.zorai-view-header`, `.zorai-tool-tab-strip`, or `.zorai-tool-layout`.

- [ ] **Step 6: Run focused tests and verify GREEN**

Run Task 3 test. Also run existing workspace symbol/context unit tests that touch extracted helpers.

- [ ] **Step 7: Commit**

```bash
git add frontend/src/components/WorkspaceWorkbench.tsx frontend/src/zorai/features/code
 git commit -m "refactor(code): split Explorer and editor surfaces"
```

---

## Task 4: Build mockup-faithful tabs and Code CSS geometry

**Files:**
- Create: `frontend/src/zorai/features/code/CodeTabs.tsx`
- Create: `frontend/src/zorai/features/code/CodeTabs.test.tsx`
- Modify: `frontend/src/zorai/styles/zorai.css`
- Modify: `frontend/src/zorai/features/code/CodeView.tsx`
- Modify: `frontend/src/zorai/features/code/CodeRail.tsx`

- [ ] **Step 1: Write failing tab behavior tests**

Render 12 files in a constrained width. Assert:

- tablist exists and has one row container;
- active, dirty, and pinned semantics render;
- overflow button has an accessible count/list of hidden files;
- clicking an overflow item activates it;
- close and reorder call existing store actions;
- wheel handler converts vertical delta to tab-strip horizontal scroll without propagating to editor vertical scroll.

- [ ] **Step 2: Run focused test and verify RED**

```bash
cd frontend
npm test -- --run src/zorai/features/code/CodeTabs.test.tsx
```

Expected: missing CodeTabs/overflow behavior.

- [ ] **Step 3: Implement CodeTabs with a real measurement/overflow model**

Use a ResizeObserver and measured available width. Keep active tab visible. Use a trailing menu button rather than wrapping. Tabs target 34–36px height and a bounded min/max width; preserve existing pin/close/reorder state.

- [ ] **Step 4: Implement the normative CSS geometry**

Translate the mockup into current Zorai tokens:

```css
.zorai-shell--code {
  grid-template-columns: var(--zorai-global-rail-width) minmax(250px, 280px) minmax(380px, 1fr) minmax(300px, 340px);
}
.zorai-code-explorer { min-width: 0; min-height: 0; }
.zorai-code-explorer-scroll { flex: 1; min-height: 0; overflow: auto; }
.zorai-code-tabs { height: 36px; flex-wrap: nowrap; overflow: hidden; }
.zorai-code-editor { min-width: 0; min-height: 0; }
.zorai-code-agent { width: 100%; min-width: 0; min-height: 0; }
```

Use actual existing shell custom properties where names differ. Do not hard-code a new palette. Align Explorer/Agent header heights, 24–26px file rows, 30px section headers, 31px breadcrumbs, and compact status bar with `code-layout-v1.html`.

- [ ] **Step 5: Add static visual-contract assertions**

Add a focused test that verifies the Code route does not render Tools header/tab selectors and that the named structural classes appear in this exact order: Explorer, editor, Agent. CSS tests may assert no `flex-wrap: wrap` on Code tabs and no nested section `overflow:auto` selectors.

- [ ] **Step 6: Run focused tests and build**

```bash
cd frontend
npm test -- --run src/zorai/features/code/CodeTabs.test.tsx src/zorai/features/code/CodeRail.test.tsx src/zorai/features/code/codeNavigation.test.ts
npm run build
```

Expected: tests and production build pass.

- [ ] **Step 7: Commit**

```bash
git add frontend/src/zorai/features/code frontend/src/zorai/styles/zorai.css
 git commit -m "feat(code): match approved Explorer editor layout"
```

---

## Task 5: Extract and reuse the Threads conversation surface

**Files:**
- Create: `frontend/src/zorai/features/threads/ThreadConversation.tsx`
- Create: `frontend/src/zorai/features/threads/ThreadConversation.test.tsx`
- Modify: `frontend/src/zorai/features/threads/ThreadsView.tsx`
- Create: `frontend/src/zorai/features/code/CodeAgentPane.tsx`
- Create: `frontend/src/zorai/features/code/CodeAgentPane.test.tsx`
- Modify: `frontend/src/zorai/shell/ZoraiShell.tsx`

- [ ] **Step 1: Write failing shared-runtime tests**

Render ThreadConversation under one mocked `AgentChatPanelRuntimeContext`. Assert Threads and CodeAgentPane both display the same message IDs/content and both call the same `runtime.sendMessage` from the shared composer. Assert neither CodeAgentPane nor ThreadConversation creates `AgentChatPanelProvider`.

- [ ] **Step 2: Run focused tests and verify RED**

```bash
cd frontend
npm test -- --run src/zorai/features/threads/ThreadConversation.test.tsx src/zorai/features/code/CodeAgentPane.test.tsx
```

Expected: missing shared primitive/Code pane.

- [ ] **Step 3: Extract timeline behavior from ThreadsView**

Move display-item building, history scrolling, tool/activity rows, retry/stream status, message actions, and composer mounting into `ThreadConversation`. Give it explicit presentation props:

```ts
type ThreadConversationProps = {
  variant: "full" | "compact";
  showHeader?: boolean;
  showParticipants?: boolean;
};
```

Do not copy message mapping or composer code into CodeAgentPane.

- [ ] **Step 4: Implement compact CodeAgentPane**

Compose:

```tsx
<aside className="zorai-code-agent">
  <CodeAgentHeader responder runtimeProfile />
  <CodeWorkspaceChips />
  <ThreadConversation variant="compact" showHeader={false} showParticipants={false} />
</aside>
```

The shared composer stays pinned at the bottom; message timeline owns the remaining vertical space. Use existing thread visual tokens and bubble components.

- [ ] **Step 5: Run focused and existing thread tests**

Run Task 5 tests plus `ThreadActivityRow`, retry, message bubble, composer queue/input-history, and spawned-context suites.

- [ ] **Step 6: Commit**

```bash
git add frontend/src/zorai/features/threads frontend/src/zorai/features/code frontend/src/zorai/shell/ZoraiShell.tsx
 git commit -m "refactor(threads): share conversation with Code"
```

---

## Task 6: Add the shared agent/subagent composer target model

**Files:**
- Create: `frontend/src/zorai/features/threads/composerTargetModel.ts`
- Create: `frontend/src/zorai/features/threads/composerTargetModel.test.ts`
- Modify: `frontend/src/zorai/features/threads/ThreadComposer.tsx`
- Modify: `frontend/src/components/agent-chat-panel/runtime/types.ts`
- Modify: `frontend/src/components/agent-chat-panel/runtime/useAgentChatPanelProviderValue.ts`

- [ ] **Step 1: Write failing pure model tests**

Define:

```ts
type ComposerTarget =
  | { kind: "current" }
  | { kind: "agent"; agentId: string; label: string }
  | { kind: "subagent"; subagentId: string; label: string };
```

Test:

- current responder is default;
- agent remains selected after successful handoff/send;
- subagent is one-shot and resets only after accepted dispatch;
- rejected dispatch preserves target and draft;
- enabled subagent definitions only;
- current agent/subagent registry options match existing handoff sources.

- [ ] **Step 2: Run focused model test and verify RED**

```bash
cd frontend
npm test -- --run src/zorai/features/threads/composerTargetModel.test.ts
```

- [ ] **Step 3: Add the target menu to the existing shared composer**

Place it in `.zorai-composer-actions__left` before security mode. Group Current responder, Agents, and Delegate to subagent. Use existing `buildThreadAgentOptions`, built-in personas, and enabled `useAgentStore().subAgents` rather than another registry.

- [ ] **Step 4: Implement agent target dispatch through existing handoff**

When selected agent differs from current responder, call existing `runtime.pushHandoff` using the same reason/summary path as `ThreadHandoffControl`, await success/approval semantics, then call `sendMessage`. Do not write responder state directly in React.

- [ ] **Step 5: Wire the runtime type for subagent dispatch but leave daemon call failing explicitly**

Add a typed method:

```ts
spawnSubagent(request: ComposerSubagentRequest): Promise<ComposerSubagentResult>;
```

Until Task 7 bridge exists, return `{ ok: false, error: "Subagent delegation bridge unavailable" }` from only the bridge-absence branch; do not silently fall back to normal send.

- [ ] **Step 6: Run focused composer/model tests**

Expected: pure state tests and component dispatch tests pass; unavailable bridge is an explicit tested error.

- [ ] **Step 7: Commit**

```bash
git add frontend/src/zorai/features/threads frontend/src/components/agent-chat-panel/runtime
 git commit -m "feat(threads): add composer agent targets"
```

---

## Task 7: Add a typed daemon path for one-shot subagent delegation

**Files:**
- Modify: `crates/zorai-protocol/src/messages/client.rs`
- Modify: `crates/zorai-protocol/src/messages/daemon.rs`
- Modify: `crates/zorai-daemon/src/server/dispatch_part4.rs` or the correct bounded dispatch shard
- Modify: `crates/zorai-daemon/src/agent/tool_executor/subagents.rs`
- Modify: focused protocol/server/subagent test modules
- Modify: `frontend/electron/main/agent-ipc-handlers.cjs`
- Modify: `frontend/electron/preload.cjs`
- Modify: `frontend/src/types/zorai-bridge.d.ts`
- Modify: `frontend/src/components/agent-chat-panel/runtime/useAgentChatPanelProviderValue.ts`
- Create: `frontend/electron/agent-spawn-subagent-ipc.test.cjs`

- [ ] **Step 1: Write failing protocol and daemon tests**

Add serde round-trip coverage for:

```rust
ClientMessage::AgentSpawnSubagent {
    thread_id: String,
    args_json: String,
}
```

Add a server/engine test that submits a normal parent thread plus the existing spawn arguments and asserts the accepted response contains the task ID and reserved child thread ID. Add validation tests proving unknown/disabled/protected subagents and invalid budgets return the same errors as tool-originated spawn.

- [ ] **Step 2: Run narrow Rust tests and verify RED**

Run the exact protocol message test and focused daemon server/subagent tests. Expected: missing variants/dispatcher.

- [ ] **Step 3: Expose existing spawn execution without duplicating it**

Create an engine/server wrapper that builds the existing spawn argument object and calls `execute_spawn_subagent` with the parent thread, no parent task for normal Code threads, the current/preferred session when available, and existing event channel. Parse its existing structured result into a typed response. Do not fork task creation or budget logic.

- [ ] **Step 4: Add Electron IPC and renderer bridge**

Expose:

```ts
agentSpawnSubagent?: (
  threadId: string,
  request: ComposerSubagentRequest,
) => Promise<{ ok: boolean; taskId?: string; childThreadId?: string; error?: string }>;
```

The request contains selected subagent name/definition title, task description from composer text, bounded optional budget, current root as `cwd`, and scoped context text including active file, selection, and explicit attachments. Do not embed file contents automatically.

- [ ] **Step 5: Complete composer delegate-and-stay behavior**

On accepted spawn:

- retain parent active thread;
- clear draft/attachments;
- reset target to current responder;
- let existing daemon task/workflow events render lifecycle and report.

On failure before acceptance:

- preserve draft, attachments, and target;
- show the returned error in existing composer/toast error presentation.

- [ ] **Step 6: Run focused Rust, Electron, and frontend tests**

```bash
cargo test -p zorai-protocol agent_spawn_subagent_message_round_trip
cargo test -p zorai-daemon direct_client_spawn_subagent_uses_parent_thread
cd frontend
node --test electron/agent-spawn-subagent-ipc.test.cjs
npm test -- --run src/zorai/features/threads/composerTargetModel.test.ts
```

Expected: all pass.

- [ ] **Step 7: Commit**

```bash
git add crates/zorai-protocol crates/zorai-daemon frontend/electron frontend/src/types frontend/src/components/agent-chat-panel/runtime frontend/src/zorai/features/threads
 git commit -m "feat(agent): delegate Code messages to subagents"
```

---

## Task 8: Integrate folder/thread lifecycle and Code/Threads identity

**Files:**
- Modify: `frontend/src/zorai/features/code/CodeView.tsx`
- Modify: `frontend/src/zorai/features/code/CodeRail.tsx`
- Modify: `frontend/src/zorai/features/code/codeWorkspaceBindingStore.ts`
- Create: `frontend/src/zorai/features/code/CodeView.test.tsx`
- Modify: `frontend/src/zorai/shell/ZoraiShell.tsx`

- [ ] **Step 1: Write failing same-thread lifecycle tests**

Mock one daemon thread and one canonical root. Assert:

- restoring Code opens that exact thread;
- sending in Code appends through the same runtime message array used by Threads;
- renamed thread title appears in Code Agent header;
- inaccessible root disables file actions but conversation remains;
- stale/deleted thread mapping is replaceable on explicit Create Code Thread/first send;
- closing root mapping does not call thread deletion.

- [ ] **Step 2: Run focused test and verify RED**

```bash
cd frontend
npm test -- --run src/zorai/features/code/CodeView.test.tsx
```

- [ ] **Step 3: Implement lifecycle recovery and view switching**

Use `runtime.openThread`, `runtime.createThread`, and the real `daemonThreadId`. Add a direct “Open in Threads” action that switches view only; it does not copy state. Preserve mapped conversation when root is unavailable.

- [ ] **Step 4: Run focused test and verify GREEN**

- [ ] **Step 5: Commit**

```bash
git add frontend/src/zorai/features/code frontend/src/zorai/shell/ZoraiShell.tsx
 git commit -m "feat(code): bind folders to persistent threads"
```

---

## Task 9: Visual convergence against the approved mockup

**Files:**
- Modify: `frontend/src/zorai/styles/zorai.css`
- Modify: Code components as required
- Reference only: `docs/superpowers/specs/assets/code-layout-v1.html`
- Create artifact: `/home/mkurman/.zorai/threads/thread_11440/artifacts/media/code-view-final.png` or equivalent final capture path

- [ ] **Step 1: Build and launch the Electron development app from the worktree**

Ensure the daemon is current and start the worktree frontend without disturbing another active checkout. Open the Zorai repository in Code and populate:

- nested file tree;
- six or more tabs;
- Source Control or Problems;
- Agent pane with workspace chips and messages.

- [ ] **Step 2: Capture the first production UI screenshot**

Capture a representative desktop viewport. Compare side-by-side against `docs/superpowers/specs/assets/code-layout-v1.html`.

Use this explicit checklist:

```text
[ ] Code first global item below brand; Threads second
[ ] four columns in exact order
[ ] Explorer 250–280px; Agent 300–340px
[ ] Explorer and Agent headers aligned
[ ] 24–26px tree rows, compact section headers
[ ] one-row 34–36px tabs with overflow
[ ] breadcrumbs immediately under tabs
[ ] Monaco owns remaining center height
[ ] compact status bar at bottom
[ ] Agent header → chips → timeline → fixed shared composer
[ ] no Tools header/tab strip/path textbox/nested-scroll trap
[ ] current Zorai tokens and typography throughout
```

- [ ] **Step 3: Correct every material mismatch**

Do not accept “close enough” when structure, width, density, spacing, hierarchy, or scroll ownership differs. Iterate CSS/component layout until the silhouette matches the reference while honoring actual Zorai tokens.

- [ ] **Step 4: Capture and preserve the accepted screenshot**

Save the final screenshot/recording in the thread artifacts and record its path in the delivery summary. If practical, add a developer-facing screenshot note beside the design spec without committing machine-specific binary noise unless desired.

- [ ] **Step 5: Commit visual convergence**

```bash
git add frontend/src/zorai/styles/zorai.css frontend/src/zorai/features/code frontend/src/zorai/features/threads
 git commit -m "style(code): converge on approved Code layout"
```

---

## Task 10: Final automated and manual verification

**Files:**
- Modify tests only if a real regression is uncovered; do not weaken assertions.

- [ ] **Step 1: Run focused frontend and Electron suites**

```bash
cd frontend
npm test -- --run \
  src/zorai/features/code/codeNavigation.test.ts \
  src/zorai/features/code/codeWorkspaceBindingStore.test.ts \
  src/zorai/features/code/CodeEmptyState.test.tsx \
  src/zorai/features/code/CodeRail.test.tsx \
  src/zorai/features/code/CodeTabs.test.tsx \
  src/zorai/features/code/CodeAgentPane.test.tsx \
  src/zorai/features/code/CodeView.test.tsx \
  src/zorai/features/threads/ThreadConversation.test.tsx \
  src/zorai/features/threads/composerTargetModel.test.ts
node --test electron/workspace-open-folder-ipc.test.cjs electron/agent-spawn-subagent-ipc.test.cjs
```

Expected: zero failures.

- [ ] **Step 2: Run full frontend verification once**

```bash
cd frontend
npm test -- --run
npm run lint
npm run build
```

Expected: zero test failures, zero lint errors, production build emitted including Monaco workers.

- [ ] **Step 3: Run focused and broad Rust verification without overlap**

```bash
cargo test -p zorai-protocol agent_spawn_subagent_message_round_trip
cargo test -p zorai-daemon direct_client_spawn_subagent_uses_parent_thread
cargo check -p zorai-daemon -p zorai-protocol
```

Expected: all exit zero. Never overlap Cargo commands.

- [ ] **Step 4: Perform the complete Electron smoke matrix**

Verify:

1. app launches into Threads;
2. Code is directly above Threads;
3. Open Folder invokes native chooser with no required path input;
4. Explorer remains scrollable with every section populated;
5. enough tabs force overflow without wrapping or blocking Monaco scroll;
6. Code message appears in the same thread under Threads;
7. agent selector performs real handoff and persists;
8. subagent selector delegates once, remains in parent, and reports completion;
9. right handle says Agent in Code and Context elsewhere;
10. restart restores folder/thread binding and panel preference;
11. final screen still matches the approved mockup side-by-side.

- [ ] **Step 5: Run source-profile preflight**

```bash
./scripts/setup.sh --check --profile source
```

Expected: required source-profile dependencies present.

- [ ] **Step 6: Review Git scope and commit any verification-only fixes**

```bash
git status --short
git diff --check
git log --oneline --decorate develop..HEAD
```

No temporary screenshots, build outputs, or unrelated changes should be staged. Commit only real fixes with scoped Conventional Commit messages.

- [ ] **Step 7: Rebase and integrate only after final evidence is green**

Ensure local `develop` is clean, rebase the feature branch if it advanced, rerun affected focused tests after conflict resolution, then fast-forward local `develop`. Do not push remotely unless separately requested.

---

## Plan self-review

- **Specification coverage:** Navigation, default Threads startup, native folder picker, persistent real-thread mapping, Explorer scroll repair, tab overflow, shared conversation runtime, agent handoff, one-shot subagent delegation, recovery behavior, Zorai-token styling, and side-by-side visual acceptance each have an explicit task and verification step.
- **No duplication:** The plan extracts `ThreadConversation` and adds a narrow daemon spawn wrapper around `execute_spawn_subagent`; it explicitly prohibits copied chat or child-task orchestration.
- **Visual fidelity:** The branch-preserved HTML is normative, concrete proportions/densities are repeated in Task 4, and Task 9 blocks completion on screenshot comparison rather than functional tests alone.
- **Risk controls:** Native picker remains main-process-owned; filesystem roots still use existing validation; subagent execution remains daemon-governed; closing Code mappings never deletes threads/files.
- **Repository constraints:** New files are planned below 500 lines, Cargo runs are serialized, and substantial work stays in the isolated worktree.
