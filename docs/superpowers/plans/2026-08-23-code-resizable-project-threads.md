# Code Resizable Panels and Project Thread History Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add persisted horizontal resizing for Code's Explorer and Agent panels plus project-scoped thread creation/history/status controls that preserve daemon-authoritative per-thread state and never mutate global agent/provider/model settings.

**Architecture:** Keep the current Zorai shell grid and drive Code-only widths through persisted Zustand preferences and CSS variables. Add pure project-thread/status/read models, then compose them into an extracted Code Agent pane that uses the existing `openThreadTarget`, thread creation, handoff, and compact `ThreadsView` paths.

**Tech Stack:** React 19, TypeScript, Zustand persistence, existing AgentChatPanel runtime, Vitest, Electron/Vite, CSS Grid and pointer events.

---

## File map

### Create

- `frontend/src/zorai/features/code/codeLayoutModel.ts` — constants and pure effective-width/grid calculations.
- `frontend/src/zorai/features/code/codeLayoutModel.test.ts` — width clamping and keyboard-delta behavior.
- `frontend/src/zorai/features/code/codeLayoutStore.ts` — versioned shared persisted preferred widths.
- `frontend/src/zorai/features/code/codeLayoutStore.test.ts` — hydration, persistence, migration, reset.
- `frontend/src/zorai/features/code/CodeResizeHandle.tsx` — accessible pointer/keyboard resize separator.
- `frontend/src/zorai/features/code/codeProjectThreads.ts` — root filtering, identity overlay, search, actual owner, status precedence, unread evidence.
- `frontend/src/zorai/features/code/codeProjectThreads.test.ts` — pure project-thread/status behavior.
- `frontend/src/zorai/features/threads/threadReadStateStore.ts` — shared persisted read timestamps and local-to-daemon migration.
- `frontend/src/zorai/features/threads/threadReadStateStore.test.ts` — read/migration/pruning behavior.
- `frontend/src/zorai/features/code/CodeThreadHistoryMenu.tsx` — rounded clock trigger and accessible searchable anchored menu.
- `frontend/src/zorai/features/code/CodeAgentPane.tsx` — project-thread orchestration, rounded +/clock controls, compact shared conversation.

### Modify

- `frontend/src/zorai/shell/ZoraiShell.tsx` — Code width variables, collapse-aware resize handles, viewport clamping.
- `frontend/src/zorai/styles/zorai.css` — six-column Code grid, resize handles, compact header controls/history menu/status dots.
- `frontend/src/zorai/features/code/CodeView.tsx` — export project root state to extracted Agent pane and retain folder/editor responsibilities.
- `frontend/src/zorai/features/threads/ThreadsView.tsx` — compact header action slot and shared mark-read effect.
- `frontend/src/zorai/features/threads/ThreadComposer.tsx` — reset provisional target on thread switch; preserve send-time thread-only handoff.
- `frontend/src/lib/workspaceContextStore.ts` — narrow stale-association removal and context lookup helpers if required by history recovery.
- `frontend/src/zorai/features/zoraiSurfaces.test.ts` — integration contracts and global-setting isolation.
- `frontend/src/zorai/features/code/codeView.test.ts` — extracted pane/root contracts.

## Task 1: Persisted resize domain and store

**Files:**
- Create: `frontend/src/zorai/features/code/codeLayoutModel.ts`
- Create: `frontend/src/zorai/features/code/codeLayoutModel.test.ts`
- Create: `frontend/src/zorai/features/code/codeLayoutStore.ts`
- Create: `frontend/src/zorai/features/code/codeLayoutStore.test.ts`

- [ ] **Step 1: Write failing pure width tests**

Cover these exact cases:

```ts
expect(resolveCodePanelWidths({
  viewportWidth: 1600,
  explorerPreferred: 280,
  agentPreferred: 320,
  explorerOpen: true,
  agentOpen: true,
})).toEqual({ explorer: 280, agent: 320 });

expect(resolveCodePanelWidths({
  viewportWidth: 900,
  explorerPreferred: 520,
  agentPreferred: 640,
  explorerOpen: true,
  agentOpen: true,
}).editor).toBeGreaterThanOrEqual(CODE_EDITOR_MIN_WIDTH);

expect(adjustCodePanelWidth("explorer", 280, "ArrowRight", false)).toBe(290);
expect(adjustCodePanelWidth("agent", 320, "ArrowLeft", true)).toBe(280);
```

Also test min/max, collapsed panels, preferred-width preservation, Home/End, and viewport expansion.

- [ ] **Step 2: Run the focused model test and verify RED**

Run:

```bash
cd frontend
npx vitest run src/zorai/features/code/codeLayoutModel.test.ts
```

Expected: FAIL because `codeLayoutModel.ts` does not exist.

- [ ] **Step 3: Implement the pure model**

Export constants:

```ts
export const CODE_EXPLORER_DEFAULT_WIDTH = 280;
export const CODE_EXPLORER_MIN_WIDTH = 180;
export const CODE_EXPLORER_MAX_WIDTH = 520;
export const CODE_AGENT_DEFAULT_WIDTH = 320;
export const CODE_AGENT_MIN_WIDTH = 260;
export const CODE_AGENT_MAX_WIDTH = 640;
export const CODE_EDITOR_MIN_WIDTH = 380;
export const CODE_RESIZE_HANDLE_WIDTH = 5;
export const CODE_GLOBAL_RAIL_WIDTH = 68;
export const CODE_COLLAPSED_EXPLORER_WIDTH = 48;
export const CODE_COLLAPSED_AGENT_WIDTH = 40;
```

Implement `resolveCodePanelWidths`, `maxCodePanelWidth`, and keyboard adjustment without React or browser dependencies.

- [ ] **Step 4: Run model tests and verify GREEN**

Expected: all `codeLayoutModel` tests pass.

- [ ] **Step 5: Write failing persisted-store tests**

Use an in-memory `StateStorage` and verify:

```ts
store.getState().setExplorerPreferredWidth(410);
store.getState().setAgentPreferredWidth(500);
expect(rehydrated.getState()).toMatchObject({ explorerPreferredWidth: 410, agentPreferredWidth: 500 });
```

Test malformed persisted values normalize to defaults and reset actions restore 280/320.

- [ ] **Step 6: Implement the versioned Zustand store**

Store only preferred widths, not viewport-clamped effective widths. Use a dedicated persisted name such as `zorai-code-layout`, version `1`, with explicit `partialize`, `merge`, and `migrate`.

- [ ] **Step 7: Run both focused suites and commit**

```bash
npx vitest run src/zorai/features/code/codeLayoutModel.test.ts src/zorai/features/code/codeLayoutStore.test.ts
git add frontend/src/zorai/features/code/codeLayoutModel* frontend/src/zorai/features/code/codeLayoutStore*
git commit -m "feat(code): persist resizable panel widths"
```

## Task 2: Accessible shell resize handles

**Files:**
- Create: `frontend/src/zorai/features/code/CodeResizeHandle.tsx`
- Modify: `frontend/src/zorai/shell/ZoraiShell.tsx`
- Modify: `frontend/src/zorai/styles/zorai.css`
- Modify: `frontend/src/zorai/features/zoraiSurfaces.test.ts`

- [ ] **Step 1: Add failing shell source/behavior contracts**

Assert that Code shell renders two handles only when corresponding panels are open, exposes Code CSS variables, and does not render handles for other views. Assert handle source contains pointer capture, horizontal separator ARIA, Home/End, arrow keys, and double-click reset.

- [ ] **Step 2: Run focused surface tests and verify RED**

```bash
npx vitest run src/zorai/features/zoraiSurfaces.test.ts
```

Expected: missing `CodeResizeHandle` and Code layout CSS variables.

- [ ] **Step 3: Implement `CodeResizeHandle`**

Props:

```ts
type CodeResizeHandleProps = {
  panel: "explorer" | "agent";
  value: number;
  min: number;
  max: number;
  onChange: (value: number) => void;
  onReset: () => void;
};
```

For Explorer, pointer movement to the right increases width. For Agent, pointer movement to the right decreases width. Use pointer capture and stable start coordinates. Implement keyboard behavior from the approved spec.

- [ ] **Step 4: Wire viewport-aware widths in `ZoraiShell`**

Read preferred widths from the layout store, track `window.innerWidth`, derive effective widths via the pure model, and set Code-only style variables:

```ts
{
  "--zorai-code-explorer-width": `${effective.explorer}px`,
  "--zorai-code-agent-width": `${effective.agent}px`,
} as React.CSSProperties
```

Render the Explorer handle between contextual rail and main, and Agent handle between main and context panel. Hide handles when their panel is collapsed.

- [ ] **Step 5: Update Code grid CSS**

Expanded grid:

```css
grid-template-columns:
  68px
  var(--zorai-code-explorer-width)
  5px
  minmax(380px, 1fr)
  5px
  var(--zorai-code-agent-width);
```

Add collapse variants and narrow breakpoint handling. Add focus, hover, and dragging visuals using neutral Code tokens.

- [ ] **Step 6: Run tests, typecheck, and commit**

```bash
npx vitest run src/zorai/features/code/codeLayoutModel.test.ts src/zorai/features/code/codeLayoutStore.test.ts src/zorai/features/zoraiSurfaces.test.ts
npx tsc -b
git add frontend/src/zorai/features/code/CodeResizeHandle.tsx frontend/src/zorai/shell/ZoraiShell.tsx frontend/src/zorai/styles/zorai.css frontend/src/zorai/features/zoraiSurfaces.test.ts
git commit -m "feat(code): resize Explorer and Agent panels"
```

## Task 3: Shared read state

**Files:**
- Create: `frontend/src/zorai/features/threads/threadReadStateStore.ts`
- Create: `frontend/src/zorai/features/threads/threadReadStateStore.test.ts`
- Modify: `frontend/src/zorai/features/threads/ThreadsView.tsx`

- [ ] **Step 1: Write failing read-state tests**

Cover stable keys, mark-read monotonicity, local-to-daemon migration, malformed hydration, and pruning:

```ts
store.getState().markRead("local:a", 100);
store.getState().markRead("local:a", 90);
expect(store.getState().lastReadAtByThread["local:a"]).toBe(100);

store.getState().migrateThreadKey("local:a", "daemon:d");
expect(store.getState().lastReadAtByThread).toEqual({ "daemon:d": 100 });
```

- [ ] **Step 2: Verify RED, implement versioned persisted store, verify GREEN**

Prefer daemon identity; expose `threadReadKey(thread)`, `markRead`, `migrateThreadKey`, `lastReadAt`, and `prune`.

- [ ] **Step 3: Mark displayed threads read in `ThreadsView`**

After the active thread's latest loaded message is rendered, mark the newest displayed message timestamp. Migrate local key when daemon linkage appears. Apply to both full Threads and compact Code because they share `ThreadsView`.

- [ ] **Step 4: Add integration assertions and commit**

```bash
npx vitest run src/zorai/features/threads/threadReadStateStore.test.ts src/zorai/features/zoraiSurfaces.test.ts
git add frontend/src/zorai/features/threads/threadReadStateStore* frontend/src/zorai/features/threads/ThreadsView.tsx frontend/src/zorai/features/zoraiSurfaces.test.ts
git commit -m "feat(threads): share project thread read state"
```

## Task 4: Project thread projection and status model

**Files:**
- Create: `frontend/src/zorai/features/code/codeProjectThreads.ts`
- Create: `frontend/src/zorai/features/code/codeProjectThreads.test.ts`

- [ ] **Step 1: Write failing project filtering and overlay tests**

Build fixtures for two roots, local/daemon identity overlap, unsent local threads, and newest-first ordering. Verify search across title and actual responder.

- [ ] **Step 2: Write failing status precedence tests**

Use an explicit evidence object:

```ts
expect(resolveCodeProjectThreadStatus({
  needsOperatorAction: true,
  working: true,
  latestCompletionAt: 300,
  lastReadAt: 0,
})).toBe("needs_operator_action");

expect(resolveCodeProjectThreadStatus({
  needsOperatorAction: false,
  working: true,
  latestCompletionAt: 300,
  lastReadAt: 0,
})).toBe("working");
```

Verify unread, idle, unscoped approvals ignored, and no title/prose parsing.

- [ ] **Step 3: Implement pure identity/filter/search/status functions**

Export:

```ts
export type CodeProjectThreadStatus = "needs_operator_action" | "working" | "done_unread" | "idle";
export function actualThreadResponder(thread: AgentThread): { id: string; name: string };
export function projectThreadsForRoot(...): CodeProjectThreadEntry[];
export function filterCodeProjectThreads(...): CodeProjectThreadEntry[];
export function resolveCodeProjectThreadStatus(...): CodeProjectThreadStatus;
export function statusPresentation(...): { label: string; dot: "amber" | "blue" | "green" | null };
```

- [ ] **Step 4: Run focused tests and commit**

```bash
npx vitest run src/zorai/features/code/codeProjectThreads.test.ts
git add frontend/src/zorai/features/code/codeProjectThreads*
git commit -m "feat(code): derive project thread history status"
```

## Task 5: Clock menu and extracted Code Agent pane

**Files:**
- Create: `frontend/src/zorai/features/code/CodeThreadHistoryMenu.tsx`
- Create: `frontend/src/zorai/features/code/CodeAgentPane.tsx`
- Modify: `frontend/src/zorai/features/code/CodeView.tsx`
- Modify: `frontend/src/zorai/features/threads/ThreadsView.tsx`
- Modify: `frontend/src/zorai/styles/zorai.css`
- Modify: `frontend/src/zorai/features/code/codeView.test.ts`
- Modify: `frontend/src/zorai/features/zoraiSurfaces.test.ts`

- [ ] **Step 1: Add failing UI ownership contracts**

Assert `CodeView.tsx` no longer defines `CodeAgentPane`, the extracted pane renders rounded create/history actions, and `ThreadsView` accepts a compact header-actions slot that is absent in full Threads.

- [ ] **Step 2: Implement the accessible history menu**

Props contain derived entries, current identity, loading/error, and callbacks. Implement search autofocus, Arrow Up/Down, Enter, Escape, click outside, retry, `aria-current`, visible status text, and dot classes.

- [ ] **Step 3: Extract and implement `CodeAgentPane`**

Use active root/context, hydrate workspace contexts, refresh daemon thread list, project via `codeProjectThreads`, and render:

```tsx
<ThreadsView
  variant="compact"
  compactHeaderActions={
    <CodeThreadHistoryMenu ... />
  }
/>
```

Switch daemon-linked threads through `openThreadTarget`. Open local pre-daemon threads with `runtime.openThread`.

- [ ] **Step 4: Implement rounded + creation**

Read `actualThreadResponder(runtime.activeThread)`, create `Code · <project>`, open immediately, and `bindRoot(localId, root)`. Ignore provisional composer state. Do not call `updateAgentSetting`.

- [ ] **Step 5: Maintain last-active root mapping**

When selected/new thread receives a daemon ID and its context root matches the current root, call `bindThreadToRoot(root, daemonThreadId)`.

- [ ] **Step 6: Add CSS for Option A and run focused tests**

Keep controls within the compact 58px header, use rounded neutral buttons, clamp dropdown width/height to the Agent panel, and add status dot colors plus text.

- [ ] **Step 7: Commit**

```bash
git add frontend/src/zorai/features/code/CodeAgentPane.tsx frontend/src/zorai/features/code/CodeThreadHistoryMenu.tsx frontend/src/zorai/features/code/CodeView.tsx frontend/src/zorai/features/threads/ThreadsView.tsx frontend/src/zorai/styles/zorai.css frontend/src/zorai/features/code/codeView.test.ts frontend/src/zorai/features/zoraiSurfaces.test.ts
git commit -m "feat(code): add project thread history controls"
```

## Task 6: Composer thread-owner isolation and switching reset

**Files:**
- Modify: `frontend/src/zorai/features/threads/ThreadComposer.tsx`
- Modify: `frontend/src/zorai/features/zoraiSurfaces.test.ts`
- Test: existing composer target/model tests plus source contract.

- [ ] **Step 1: Add failing tests**

Assert provisional selection does not call handoff immediately, send performs handoff before `sendMessage`, failed handoff preserves draft/target, active-thread change resets to current responder, and the target-send path contains no global setting mutation.

- [ ] **Step 2: Implement active-thread reset**

Memoize targets and reset `composerTarget` plus target error when `activeThreadId` changes. Do not reset during ordinary rerenders of the same thread.

- [ ] **Step 3: Preserve thread-only handoff**

Keep `pushHandoff` in `sendCurrentInput`; ensure no provider/model/global agent setting call exists in this branch. Keep normal full Threads selector-free.

- [ ] **Step 4: Run focused tests and commit**

```bash
npx vitest run src/zorai/features/threads/composerTargetModel.test.ts src/zorai/features/zoraiSurfaces.test.ts
git add frontend/src/zorai/features/threads/ThreadComposer.tsx frontend/src/zorai/features/zoraiSurfaces.test.ts
git commit -m "fix(code): isolate provisional thread ownership"
```

## Task 7: Full verification and real UI acceptance

**Files:**
- No production files unless verification finds a reproducible defect.
- Artifact: `/home/mkurman/.zorai/threads/thread_11440/artifacts/media/code-resizable-project-threads.png`

- [ ] **Step 1: Run all frontend tests**

```bash
cd frontend
npm run test:unit
```

Expected: all test files pass.

- [ ] **Step 2: Run TypeScript, lint, and production build**

```bash
npx tsc -b
npx eslint <all changed TS/TSX files> --no-warn-ignored
npm run build
```

Expected: zero errors. Existing unrelated warnings must be called out, not hidden.

- [ ] **Step 3: Run relevant Electron IPC suites**

```bash
node --test electron/workspace-folder-ipc.test.cjs electron/agent-send-message-target-ipc.test.cjs
```

Expected: all relevant tests pass.

- [ ] **Step 4: Perform real browser/Electron interaction**

At 1600×807 and a constrained width/height:

- drag Explorer and Agent handles to min/max/intermediate;
- keyboard-adjust and double-click reset;
- reload and verify persistence;
- collapse/reopen and verify restoration;
- create two project threads via +;
- search/switch via clock;
- verify another project's thread is excluded;
- verify independent messages/owners/provider/model state;
- verify status precedence and shared read clearing;
- verify no global settings mutation after Code agent selection/send;
- verify menu/composer stay within Agent bounds.

- [ ] **Step 5: Capture screenshot and inspect computed geometry**

Save the screenshot to the artifact path above and record panel/client/scroll dimensions.

- [ ] **Step 6: Final diff and file-size gate**

```bash
git diff --check
git status --short --branch
wc -l <all newly created production files>
```

Every new production file must remain below 500 lines.

- [ ] **Step 7: Finish branch**

Fast-forward into clean local `develop`, rerun focused tests post-integration, stop temporary preview processes, remove the merged worktree/branch, and report any intentionally uncovered external failure.
