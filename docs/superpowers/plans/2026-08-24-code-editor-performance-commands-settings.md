# Code Editor Performance, Commands, and Settings Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task on the explicitly approved `develop` branch. Steps use checkbox syntax.

**Goal:** Deliver a sub-200ms Code editor with cached Monaco models, a comprehensive Code-scoped command/hotkey system, SVG toolbar, dedicated Code Settings tab, safe autosave/close behavior, large-file gating, and dynamic Prettier formatting.

**Architecture:** Extract document/model ownership and command/settings policy from `WorkspaceWorkbench` into focused stores/controllers. Preload Monaco on Code entry, make model activation the critical path, and defer LSP/Git/test/outline work until after paint. One command registry drives editor actions, shortcuts, palettes, icons, and settings.

**Tech Stack:** React 19, TypeScript, Monaco Editor, Zustand, Electron IPC, Vitest, Vite, Prettier dynamic imports.

---

## Task 1 — Performance instrumentation and Monaco preload

**Create:**
- `frontend/src/zorai/features/code/codeEditorPerformance.ts`
- `frontend/src/zorai/features/code/codeEditorPerformance.test.ts`
- `frontend/src/zorai/features/code/codeEditorPreload.ts`
- `frontend/src/zorai/features/code/codeEditorPreload.test.ts`

**Modify:**
- `frontend/src/zorai/features/code/CodeView.tsx`
- `frontend/src/components/WorkspaceWorkbench.tsx`
- `frontend/src/components/WorkspaceCodeEditor.tsx`

- [ ] Write RED tests for bounded performance records, mark ordering, p50/p95, idempotent concurrent preload, and failed-preload retry.
- [ ] Implement mark names `start`, `tab-active`, `ipc-start`, `ipc-complete`, `model-ready`, `paint`, `interactive`; retain no content.
- [ ] Replace nested lazy imports with exported preload promises. Start preload when Code mounts and on file-row pointer/focus.
- [ ] Add benchmark helper and development diagnostics.
- [ ] Verify focused tests and commit `perf(code): preload and measure editor startup`.

## Task 2 — Document/model cache and fast open pipeline

**Create:**
- `frontend/src/zorai/features/code/codeDocumentModel.ts`
- `frontend/src/zorai/features/code/codeDocumentModel.test.ts`
- `frontend/src/zorai/features/code/codeDocumentStore.ts`
- `frontend/src/zorai/features/code/codeDocumentStore.test.ts`

**Modify:**
- `frontend/src/components/WorkspaceWorkbench.tsx`
- `frontend/src/components/WorkspaceCodeEditor.tsx`

- [ ] Write RED tests for canonical root/path keys, activation tokens, stale-read suppression, cache hit without IPC, dirty protection, LRU clean eviction, and view-state preservation.
- [ ] Implement metadata-focused Zustand store; Monaco model references remain in an imperative controller map.
- [ ] Make tab activation synchronous, then cached model attach or root-constrained read.
- [ ] Move content mutation out of parent workbench full-string state; subscribe only to active metadata/dirty/version.
- [ ] Schedule LSP, diagnostics, test decoration, outline, and Git work after interactive mark.
- [ ] Verify p95 helper and commit `perf(code): cache documents and Monaco models`.

## Task 3 — Central Code command registry and editing actions

**Create:**
- `frontend/src/zorai/features/code/codeCommands.ts`
- `frontend/src/zorai/features/code/codeCommands.test.ts`
- `frontend/src/zorai/features/code/CodeCommandProvider.tsx`
- `frontend/src/zorai/features/code/codeKeybindings.ts`
- `frontend/src/zorai/features/code/codeKeybindings.test.ts`

**Modify:**
- `frontend/src/components/WorkspaceCodeEditor.tsx`
- `frontend/src/zorai/shell/ZoraiShell.tsx`

- [ ] RED tests for unique IDs, required command inventory, platform Ctrl/Cmd normalization, Code/global conflicts, enablement, and no handling outside Code.
- [ ] Implement registry metadata and Code command context.
- [ ] Register Monaco actions for save/reload/find/replace/go-to/delete/duplicate/move/case/comment/indent/occurrence/line insertion/join/sort/undo/redo.
- [ ] Route shell commands for panel toggles, settings, files, external actions, and tab navigation.
- [ ] Ensure each transformation is one undoable operation and preserves selection where possible.
- [ ] Verify and commit `feat(code): add scoped editor command registry`.

## Task 4 — Quick open and command palette

**Create:**
- `frontend/src/zorai/features/code/codeFuzzySearch.ts`
- `frontend/src/zorai/features/code/codeFuzzySearch.test.ts`
- `frontend/src/zorai/features/code/CodeQuickOpen.tsx`
- `frontend/src/zorai/features/code/CodeCommandPalette.tsx`

**Modify:**
- `frontend/src/components/WorkspaceWorkbench.tsx`
- `frontend/src/zorai/styles/zorai.css`

- [ ] RED tests for fuzzy ranking, recency/open boosts, path suffix `:line:column`, disabled command reasons, and keyboard navigation.
- [ ] Implement editor-column combobox/listbox overlays with Escape/focus restoration.
- [ ] Quick open uses indexed tree paths and root-constrained workspace search fallback.
- [ ] Command palette searches title/category/binding/aliases and dispatches registry commands.
- [ ] Verify and commit `feat(code): add quick open and command palette`.

## Task 5 — SVG command toolbar

**Create:**
- `frontend/src/zorai/features/code/CodeIcon.tsx`
- `frontend/src/zorai/features/code/CodeIconButton.tsx`
- `frontend/src/zorai/features/code/codeIcons.test.tsx`

**Modify:**
- `frontend/src/components/WorkspaceWorkbench.tsx`
- `frontend/src/zorai/styles/zorai.css`

- [ ] RED tests proving primary toolbar controls are SVG command buttons with accessible names, current bindings, disabled reasons, and registry dispatch.
- [ ] Implement icon paths and shared icon button.
- [ ] Replace text/Unicode toolbar actions with grouped save/reload/diff/external/search/palette/settings/wrap/minimap SVG controls.
- [ ] Preserve confirmation semantics for destructive commands.
- [ ] Verify and commit `refactor(code): use SVG command toolbar`.

## Task 6 — Code settings store and special Settings tab

**Create:**
- `frontend/src/zorai/features/code/codeEditorSettingsStore.ts`
- `frontend/src/zorai/features/code/codeEditorSettingsStore.test.ts`
- `frontend/src/zorai/features/code/CodeSettingsView.tsx`
- `frontend/src/zorai/features/code/codeEditorTabs.ts`
- `frontend/src/zorai/features/code/codeEditorTabs.test.ts`

**Modify:**
- `frontend/src/zorai/features/code/CodeTabs.tsx`
- `frontend/src/components/WorkspaceWorkbench.tsx`
- `frontend/src/components/WorkspaceCodeEditor.tsx`
- `frontend/src/zorai/styles/zorai.css`

- [ ] RED tests for defaults/migration/normalization, wrapping range, auto-save values, cache/size values, shortcuts, duplicate settings tab, previous-file restoration, and no filesystem side effects.
- [ ] Implement versioned dedicated Code settings store.
- [ ] Implement typed file/settings tab union and searchable settings sections.
- [ ] Apply Monaco settings live, including bounded wrap at 120 by default.
- [ ] `Ctrl/Cmd+,` and gear command open one existing Settings tab.
- [ ] Verify and commit `feat(code): add dedicated editor settings tab`.

## Task 7 — Autosave and dirty-close safety

**Create:**
- `frontend/src/zorai/features/code/codeAutoSave.ts`
- `frontend/src/zorai/features/code/codeAutoSave.test.ts`
- `frontend/src/zorai/features/code/DirtyFileCloseDialog.tsx`

**Modify:**
- `frontend/src/components/WorkspaceWorkbench.tsx`
- `frontend/src/zorai/features/code/codeDocumentStore.ts`
- Electron window-close IPC only if required by existing close gate.

- [ ] RED tests for Off/delay/editor-blur/Code-window-blur, timer reset/cancel, save failure/conflict, and Save/Don't Save/Cancel.
- [ ] Implement one save pipeline used by manual/auto/close flows.
- [ ] Dirty close never discards silently; Cancel preserves model/view.
- [ ] Integrate normal Electron close gate without claiming forced-quit async guarantees.
- [ ] Verify and commit `feat(code): add safe autosave and dirty close`.

## Task 8 — Large-file metadata gate

**Modify/Create:**
- `frontend/electron/main/core-ipc-handlers.cjs`
- `frontend/electron/preload.cjs`
- `frontend/src/types/zorai-bridge.d.ts`
- `frontend/electron/workspace-folder-ipc.test.cjs` or focused new IPC test
- `frontend/src/zorai/features/code/CodeLargeFileGate.tsx`
- `frontend/src/zorai/features/code/codeLargeFile.test.ts`
- `frontend/src/zorai/features/code/codeDocumentStore.ts`

- [ ] RED IPC tests for root-constrained file stat, external open, and reveal; reject traversal/outside-root.
- [ ] RED renderer tests for 5 MB default, 1–100 MB normalization, no full read before gate, and one-time reduced override.
- [ ] Implement bridge and gate UI.
- [ ] Reduced mode disables LSP/diagnostics/tests/minimap/sticky scroll/formatting and displays indicator.
- [ ] Verify and commit `feat(code): gate oversized editor files`.

## Task 9 — Dynamic Prettier formatting

**Modify:**
- `frontend/package.json`
- `frontend/package-lock.json`

**Create:**
- `frontend/src/zorai/features/code/codeFormatter.ts`
- `frontend/src/zorai/features/code/codeFormatter.test.ts`

**Modify:**
- command registry/settings/save pipeline.

- [ ] Add lockfile-defined Prettier and required parser/plugin packages.
- [ ] RED tests proving no Prettier import on Code entry/open, language mapping, document/selection formatting, one undo edit, disabled unsupported language, failure non-mutation, and format-on-save default Off.
- [ ] Implement dynamic imports for JS/TS/JSX/TSX/JSON/CSS/SCSS/Less/HTML/Markdown/YAML.
- [ ] Fall back to registered Monaco/LSP formatter for other languages.
- [ ] Verify and commit `feat(code): add dynamic Prettier formatting`.

## Task 10 — Full benchmark and acceptance

- [ ] Run all frontend tests, TypeScript, lint, build, and relevant Electron IPC.
- [ ] Production Electron/browser benchmark: cold first file and warm cached files across TSX/Rust/JSON/Markdown; record p50/p95 and require p95 <200 ms for supported size.
- [ ] Verify cached file causes no read IPC and deferred services start after interactive mark.
- [ ] Exercise all bound commands, quick open, palette, SVG toolbar, settings edits/reset, wrapping, autosave modes, dirty close, large-file actions, and formatter paths.
- [ ] Verify no Code setting/command mutates global agent/provider/model state and no Code hotkey leaks outside Code.
- [ ] Confirm all new production files under 500 lines and clean `develop`.
- [ ] Save final screenshot and benchmark report under thread artifacts.
