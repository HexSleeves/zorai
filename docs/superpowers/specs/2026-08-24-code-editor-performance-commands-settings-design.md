# Code Editor Performance, Commands, and Settings Design

**Date:** 2026-08-24
**Branch:** `develop`
**Workspace:** `/mnt/e/gitlab/it/zorai`
**Status:** Approved in conversation; pending written-spec review

## Objective

Make the Code editor fast enough for daily use and give it a comprehensive, discoverable command/settings system. Every file below the configured editable-size limit must become visible and editable within 200 ms, including the first file opened after entering Code. The same command registry must drive Monaco actions, Code-scoped hotkeys, SVG toolbar buttons, quick open, the command palette, shortcut settings, and help text.

The work is performed directly on clean local `develop`, per operator instruction. It must preserve unrelated `develop` commits and must not use a worktree.

## Approved product decisions

- Strict performance target: every supported file, including first Monaco use, visible and editable within 200 ms at p95 on the verification machine.
- Monaco is preloaded when Code is entered; it is not first loaded after a file click.
- Documents and Monaco models are cached per canonical root/path and reused across tab switches.
- LSP, diagnostics, Git, tests, outline extraction, and other non-critical work are deferred until after editor-visible paint.
- Files larger than 5 MB are gated by default; the limit is configurable from 1–100 MB.
- Oversized files offer Open externally, Reveal in file manager, and one-time Open anyway in reduced-feature mode.
- Code uses VS Code-style hotkeys scoped to Code/editor focus. Code scope intentionally overrides conflicting global terminal/workspace shortcuts only while Code is active.
- All Code shortcuts are editable in dedicated Code settings with duplicate/conflict warnings.
- Primary editor/toolbar actions use accessible SVG icon buttons rather than text or Unicode glyphs.
- Dedicated Code settings open in one special closable `Code Settings` editor tab, not global Settings, Explorer, or Agent.
- Auto-save modes: Off, After delay, Editor focus lost, Code/window focus lost.
- Dirty tab close always prompts Save / Don't Save / Cancel. No mode silently discards changes.
- Default auto-save is Off; default delay is 1,000 ms.
- Default wrapping is bounded at `min(viewport, 120 columns)`; configured column range 40–500.
- Formatting bundles Prettier for supported web/data languages, loaded dynamically outside the file-open critical path.
- Format-on-save is Off by default.

## Current bottlenecks

### Double-lazy Monaco cold path

The current editor pays two dynamic-import boundaries after the first file click:

1. `WorkspaceWorkbench.tsx` lazy-loads `WorkspaceCodeEditor`.
2. `WorkspaceCodeEditor.tsx` lazy-loads `@monaco-editor/react` and Monaco.

The first file click therefore triggers download/read, parse, module initialization, editor creation, language setup, and model creation before the editor is usable. Monaco workers and editor chunks are multi-megabyte assets, so this cannot reliably meet 200 ms when loaded on demand.

### Monolithic controlled render path

`WorkspaceWorkbench` currently owns Explorer, Git, history, worktrees, tests, diagnostics, LSP, agent operations, open documents, modes, and editor state. Opening or editing a document updates parent state and recomputes many unrelated projections. `WorkspaceCodeEditor` receives a controlled full-string `value`, so every keystroke propagates through the workbench rather than remaining primarily in Monaco's model.

### File-open work mixed with non-critical services

File activation, LSP open/change, diagnostics, outline extraction, Git state, test discovery/glyphs, workspace watchers, and context synchronization share the same component lifecycle. Even where requests are asynchronous, the current ownership creates avoidable rerenders and makes the critical path difficult to measure or constrain.

## Performance contract

### Latency budget

For local files below the configured size limit:

| Phase | Target |
|---|---:|
| Immediate tab/selection feedback | <16 ms |
| Cached document/model activation | <50 ms |
| Uncached workspace read target | <120 ms |
| Visible and editable editor, total | <200 ms p95 |

The acceptance target applies to both the first and subsequent file openings. Monaco preload must therefore complete before the first file click in the benchmark flow.

### Measurements

Record these marks for every activation:

```text
code-file-open:start
code-file-open:tab-active
code-file-open:ipc-start
code-file-open:ipc-complete
code-file-open:model-ready
code-file-open:paint
code-file-open:interactive
```

Derive measures for immediate feedback, IPC, model setup, paint, and total interaction. Measurements include root/path, cache hit, byte size, line count, language, cold/warm runtime state, and reduced-feature mode, but never file contents.

Development logging and a Code performance overlay are optional settings. Production keeps bounded recent measurements in memory for diagnostics without verbose console noise.

### Monaco preload

Create one idempotent preload function that imports:

- `WorkspaceCodeEditor`;
- `@monaco-editor/react`;
- required Monaco editor contribution/runtime modules;
- the core worker environment.

Preload starts when Code becomes active. File-row hover/focus calls the same function as a fallback. The preloader exposes readiness and failure state and deduplicates concurrent callers. Prettier is not part of Monaco preload.

### Document and model ownership

Create a focused document/model controller and store keyed by:

```text
canonical root + relative path
```

Each entry tracks:

- canonical root and path;
- content metadata/hash/language/size/line count;
- loading, ready, error, dirty, saving, conflict, and oversized states;
- Monaco model URI and disposable model reference boundary;
- original/disk snapshot needed for conflict-safe writes;
- last access time, cursor, selections, scroll state, and view state;
- reduced-feature one-time override;
- active load/save request tokens.

Monaco model content is authoritative while mounted. React state subscribes to metadata and dirty/version signals, not the full document string on every keystroke. Fallback textarea mode continues to work through the same command/document interface.

A bounded LRU cache evicts clean, inactive models/documents according to Code settings. Dirty models are never automatically evicted. Closing a clean tab may retain the model until cache pressure. Closing a dirty tab uses the safety prompt.

### Open pipeline

1. Synchronously activate or create the tab and show loading state.
2. Increment the path-specific activation token.
3. If a ready cached model/document exists, attach it immediately and restore editor view state.
4. Otherwise begin `workspaceReadFile` without awaiting unrelated work.
5. Ignore stale read completion when a newer activation token exists.
6. Check byte size against the configured limit.
7. For supported size, create/update the Monaco model and paint the editor.
8. Mark the editor interactive after model attachment and focus/cursor restoration.
9. Start LSP, diagnostics, outline, tests, and Git-related work after the interactive mark using deferred scheduling.

Repeated activation of a cached file must not call `workspaceReadFile` again unless reload, conflict handling, external-change invalidation, or explicit cache eviction requires it.

## Large-file policy

### Defaults

```text
Maximum editable size: 5 MB
Configurable range: 1–100 MB
```

The bridge must expose byte size without requiring the renderer to load arbitrarily large text into memory first. Prefer metadata/stat in directory entries or a dedicated root-constrained file-stat IPC. If current `workspaceReadFile` is the only source, add a root-constrained metadata call and gate before reading full contents.

### Oversized-file gate

When a file exceeds the limit, activate a special file tab that shows:

- file path;
- actual size;
- configured limit;
- Open externally;
- Reveal in file manager;
- Open anyway for this file.

Open anyway is session/document-specific and does not raise the global limit. It enters reduced-feature mode:

- no LSP open/change/providers;
- no diagnostics or test decorations;
- no minimap;
- no sticky scroll;
- reduced tokenization and expensive editor features;
- no automatic formatting;
- explicit visual indicator that reduced mode is active.

The one-time decision is discarded when the document/controller is disposed.

## Code command registry

### Command definition

Every Code command is registered once:

```ts
type CodeCommand = {
  id: CodeCommandId;
  title: string;
  category: string;
  icon: CodeIconId;
  defaultKeybinding: string | null;
  when: (context: CodeCommandContext) => boolean;
  execute: (context: CodeCommandContext) => void | Promise<void>;
};
```

The registry is the source of truth for:

- Monaco actions;
- Code-scoped keyboard handling;
- SVG toolbar buttons;
- command palette;
- quick-open related actions;
- Code Settings keyboard-shortcut list;
- tooltips and accessible names;
- command enablement and conflict warnings.

No toolbar action may maintain a second independent callback implementation when a registry command exists.

### Initial command set

#### File and navigation

- Save
- Save all
- Reload from disk
- Reopen closed editor
- Quick open file
- Search project
- Find in file
- Replace in file
- Go to line
- Go to symbol
- Go to definition
- Find references
- Close editor
- Close other editors
- Next editor
- Previous editor
- Pin/unpin editor
- Open externally
- Reveal in file manager
- Open Code Settings
- Command palette

#### Editing

- Undo
- Redo
- Cut
- Copy
- Paste
- Select all
- Delete line
- Duplicate line or selection
- Move line or selection up/down
- Uppercase selection
- Lowercase selection
- Toggle line comment
- Toggle block comment
- Indent
- Outdent
- Select next occurrence
- Select all occurrences
- Format document
- Format selection
- Trim trailing whitespace
- Insert line above
- Insert line below
- Join lines
- Sort selected lines ascending
- Sort selected lines descending

#### View

- Toggle Explorer
- Toggle Code Agent
- Toggle minimap
- Toggle bounded word wrap
- Increase editor font
- Decrease editor font
- Reset editor font
- Toggle whitespace rendering
- Toggle sticky scroll

### Default hotkeys

Use platform-aware `Ctrl/Cmd` display and matching:

```text
Ctrl/Cmd+S          Save
Ctrl/Cmd+Shift+S    Save all
Ctrl/Cmd+R          Reload from disk
Ctrl/Cmd+F          Find in file
Ctrl/Cmd+H          Replace in file
Ctrl/Cmd+P          Quick open file
Ctrl/Cmd+Shift+P    Code command palette
Ctrl/Cmd+Shift+F    Search project
Ctrl/Cmd+G          Go to line
F12                 Go to definition
Shift+F12           Find references
Ctrl/Cmd+D          Select next occurrence
Alt+Up/Down         Move line/selection
Shift+Alt+Up/Down   Duplicate line/selection
Ctrl/Cmd+Shift+K    Delete line
Ctrl/Cmd+/          Toggle line comment
Shift+Alt+A         Toggle block comment
Ctrl/Cmd+U          Lowercase selection
Ctrl/Cmd+Shift+U    Uppercase selection
Ctrl/Cmd+Z          Undo
Ctrl/Cmd+Y          Redo
Ctrl/Cmd+B          Toggle Explorer
Ctrl/Cmd+Shift+A    Toggle Code Agent
Ctrl/Cmd+,          Open Code Settings
```

Other commands may be unbound by default but remain available in the palette and shortcut settings.

### Scope and conflicts

Code command handling is active only while the active Zorai view is Code. Monaco/editor commands own keyboard events while focus is in Monaco or the fallback editor. Shell-level Code commands own events elsewhere in the Code surface. Outside Code, existing global keybindings remain unchanged.

Code bindings intentionally override global shortcuts inside Code. Code settings show global collisions as warnings. Duplicate enabled bindings within Code are blocking conflicts and cannot be saved until resolved or one command is unbound.

Bindings are stored by command ID in a versioned Code settings store. Platform normalization handles Ctrl/Cmd without storing separate binding sets unless the operator explicitly overrides them.

## Quick open and command palette

### Quick open — Ctrl/Cmd+P

A keyboard-first overlay in the editor column:

- fuzzy-search indexed project files;
- recent/open files receive ranking boosts;
- results include path and compact file-type SVG;
- Arrow navigation, Enter open, Escape close;
- optional `:line[:column]` suffix parsing;
- uses loaded/lazy Explorer index and falls back to root-constrained workspace search when incomplete;
- hover/focus of results preloads the editor runtime and may prefetch small file metadata/content within a bounded budget.

### Command palette — Ctrl/Cmd+Shift+P

Searches command title, category, current keybinding, and aliases. Disabled commands remain visible with a reason. Selecting executes through the same registry. “Preferences: Open Code Settings” focuses the special settings tab.

Both overlays are bounded to the editor column, accessible as combobox/listbox patterns, and never resize the Agent or Explorer panels.

## SVG toolbar

Replace textual editor action buttons and Unicode file/editor controls with a consistent icon-button component backed by `CodeIconId`.

Requirements:

- actual SVG paths, not icon-font or Unicode glyphs;
- command title plus current keybinding in tooltip;
- explicit `aria-label`;
- disabled reason in tooltip;
- visible focus state;
- compact neutral Code palette;
- shared sizes and stroke weight;
- command execution through registry.

Primary toolbar groups:

- file: save, reload, diff, external open/reveal;
- navigation: quick open, project search, command palette;
- view: settings, wrap, minimap;
- destructive file actions remain visually separated and require existing confirmation semantics.

## Dedicated Code Settings tab

### Tab behavior

The gear SVG and `Ctrl/Cmd+,` open one special `Code Settings` tab in the center tab strip.

- Opening again focuses the existing settings tab.
- It is closable and may be pinned.
- It never becomes `ThreadWorkspaceContext.activeFile`.
- It does not trigger filesystem read/write, Git, LSP, diagnostics, tests, or Agent attachment.
- The previously active file/model/view state remains preserved.
- Closing returns to the previously active file where available.
- Special tabs use a typed editor-tab union rather than pretending settings is a path.

### Settings store

Create a dedicated versioned `codeEditorSettingsStore`. It persists only Code editor, command, formatting, autosave, performance, and appearance preferences. It does not reuse terminal settings and does not mutate agent/provider/model state.

The store explicitly normalizes/migrates malformed and older values. Defaults are immutable constants. Unknown command IDs are preserved only when safe for forward compatibility and never executed until registered.

### Sections

#### Editor

- font family;
- font size;
- line height;
- tab size;
- insert spaces;
- bounded/off/viewport/column wrapping mode;
- wrap column, default 120, range 40–500;
- format on paste/type/save;
- trim trailing whitespace on save;
- final newline on save.

#### Files and Auto Save

- Off;
- After delay;
- Editor focus lost;
- Code/window focus lost;
- delay, default 1,000 ms;
- dirty-close safety policy shown as fixed Save / Don't Save / Cancel;
- external-change handling;
- reopen previous editors;
- restore cursor and scroll position.

#### Performance and Large Files

- maximum editable size, default 5 MB, range 1–100 MB;
- Monaco preload, enabled by default to satisfy strict target;
- document/model cache budget;
- LRU cache behavior summary;
- performance measurement/logging toggle;
- one-time reduced-mode behavior summary.

#### Keyboard Shortcuts

- searchable command list;
- current and default bindings;
- record-new-shortcut mode;
- Code duplicate and global collision warnings;
- unbind;
- reset one;
- reset all;
- platform-aware display.

#### Appearance

- theme;
- cursor style/blink;
- rulers;
- minimap;
- sticky scroll;
- whitespace;
- control characters;
- line numbers;
- bracket guides/colorization;
- overview ruler;
- glyph margin;
- smooth scrolling.

#### Advanced

- LSP enablement;
- diagnostics delay;
- completion triggers;
- semantic highlighting;
- reduced-mode details;
- per-language overrides are a future extension, not required in this implementation.

## Auto-save and close safety

### Modes

```ts
type CodeAutoSaveMode =
  | "off"
  | "after_delay"
  | "editor_focus_lost"
  | "code_window_focus_lost";
```

Defaults:

```text
mode: off
delay: 1000 ms
```

After-delay timers are per document, debounced, cancelled after successful save, reset on further edits, and suspended during conflicts/errors. Focus-loss modes save only dirty, valid, non-oversized documents that are not already saving.

### Save pipeline

Manual and automatic save share one conflict-safe implementation:

1. optional trim trailing whitespace/final newline/format-on-save transforms;
2. write using expected disk hash;
3. on success update original/hash/dirty metadata;
4. on conflict retain model content and dirty state;
5. surface compare/reload actions;
6. do not retry automatically in a tight loop.

### Dirty-close prompt

Closing a dirty file tab always presents:

- Save;
- Don't Save;
- Cancel.

Cancel preserves tab, model, selection, and view state. Save waits for successful write before closing. Don't Save disposes or caches the clean disk/original state according to cache policy. Settings/special tabs do not use file-save prompts.

Application/window close integrates with Electron's close gate where available. The implementation must not claim asynchronous writes after forced OS termination and never silently discards dirty documents during a normal close flow.

## Wrapping behavior

Default mode is bounded:

```text
wordWrap: bounded
wordWrapColumn: 120
wrappingIndent: same
```

Effective wrap is the smaller of viewport and configured column. Expose off, viewport, column, and bounded modes. Column values normalize to 40–500.

## Formatting

### Prettier coverage

Bundle Prettier and appropriate plugins for:

- JavaScript;
- TypeScript;
- JSX;
- TSX;
- JSON/JSONC;
- CSS/SCSS/Less;
- HTML;
- Markdown;
- YAML where supported by selected plugins.

Prettier and plugins are loaded through dynamic imports only when formatting is invoked or during optional idle warmup after Monaco is ready. They never participate in Code entry or file-open critical path.

### Formatter resolution

1. use bundled Prettier for mapped supported languages;
2. otherwise invoke a registered Monaco/LSP document or range formatter;
3. otherwise disable with `No formatter available for this language.`

Formatting produces one undoable edit transaction and preserves selections where possible. Format Document and Format Selection are manual commands. Format-on-save is Off by default and configurable.

Formatter failure shows a non-destructive notification and does not alter the model/undo stack.

## Error and recovery behavior

- Read failure keeps the tab visible with Retry, Open externally, and Reveal actions.
- Activation tokens prevent stale read completion from replacing a newer selection.
- Reloading dirty content requires confirmation.
- Save conflict retains dirty model and offers compare/reload.
- Auto-save failure keeps dirty state and shows an actionable error.
- Oversized files show the size gate before loading full content when metadata is available.
- Open-anyway state is per-document/session and visibly reduced.
- Command execution failures are surfaced once without corrupting editor state.
- Shortcut conflicts block ambiguous Code binding persistence.
- Settings normalization falls back to safe defaults.
- Missing formatter disables formatting rather than silently doing nothing.
- Settings tab never triggers file-service side effects.

## Components and ownership

### New focused units

- `codeEditorPreload.ts` — idempotent Monaco/editor preloader and readiness metrics.
- `codeEditorDocumentStore.ts` — document/model metadata, activation tokens, dirty/save/conflict/cache state.
- `codeEditorPerformance.ts` — marks, measures, bounded records, benchmark helpers.
- `codeEditorSettingsStore.ts` — versioned settings and keybinding persistence/normalization.
- `codeCommands.ts` — registry metadata, enablement, platform bindings, conflict detection.
- `CodeCommandProvider.tsx` — Code-scoped command context and dispatch.
- `CodeCommandPalette.tsx` — searchable registry overlay.
- `CodeQuickOpen.tsx` — project file search overlay.
- `CodeIcon.tsx` and `CodeIconButton.tsx` — SVG icon system and command tooltips.
- `CodeSettingsView.tsx` — special settings-tab content and shortcut editor.
- `CodeLargeFileGate.tsx` — oversized-file actions and one-time reduced-mode entry.
- `codeFormatter.ts` — dynamic Prettier/plugin resolver plus Monaco formatter fallback.
- `DirtyFileCloseDialog.tsx` — Save / Don't Save / Cancel contract.

### Existing units to refactor

- `WorkspaceWorkbench.tsx` retains workspace orchestration and Explorer/editor composition, but no longer owns full document strings or command definitions.
- `WorkspaceCodeEditor.tsx` owns Monaco adapter/model attachment, editor action registration, settings application, and fallback integration.
- `CodeTabs.tsx` moves from file-only tabs to typed file/settings tabs while preserving current file ordering/pinning/overflow.
- Electron workspace IPC adds root-constrained file stat and external-open/reveal operations if not already exposed.

Every new production file remains under 500 lines. Large registries may be split by command category.

## Accessibility

- All toolbar buttons have SVG, accessible name, tooltip, focus state, and disabled explanation.
- Quick open and command palette use combobox/listbox semantics and full keyboard operation.
- Settings controls have labels, descriptions, validation messages, and reset actions.
- Shortcut recording is keyboard accessible and provides conflict announcements.
- Dirty-close and large-file dialogs trap focus and restore it on close.
- Hotkeys remain discoverable through tooltips, palette, and settings.
- No command relies only on an icon or color for meaning.

## Verification matrix

### Performance

- preload is idempotent and begins on Code entry;
- file-row hover/focus calls preload;
- cached activation performs no file-read IPC;
- stale read cannot replace newer active tab;
- non-critical service work begins after interactive mark;
- cold and warm benchmark across representative TSX, Rust, JSON, and Markdown files;
- p50 and p95 recorded;
- p95 total under 200 ms for files under configured limit;
- cache pressure evicts only clean inactive entries;
- dirty models are never evicted.

### Commands and hotkeys

- registry IDs and active bindings are unique;
- platform normalization and display;
- Code scope wins only while Code is active;
- no Code shortcut leakage into Threads/Terminal views;
- command enablement matches document/editor/formatter state;
- editing transforms preserve undo boundaries and selections;
- quick open and palette fuzzy ranking/navigation;
- toolbar/icon/tooltip metadata matches registry;
- every approved command has a registry entry and execution test.

### Settings and autosave

- defaults, persistence, normalization, migration;
- settings special tab uniqueness and previous-file restoration;
- wrapping modes/column live application;
- each auto-save mode, timer reset/cancel, focus events;
- conflict and save failure preserve dirty content;
- dirty close Save / Don't Save / Cancel;
- max-size normalization and size gate;
- one-time reduced-mode features;
- shortcut conflict warnings/reset;
- no settings action mutates global agent/provider/model state.

### Formatting

- Prettier not imported during Code entry/file open;
- language/plugin mapping;
- document and selection formatting;
- one undoable edit;
- format-on-save off by default;
- Monaco/LSP fallback;
- unsupported command disabled;
- failure leaves model unchanged.

### Real UI and Electron

- measure first and repeated file opens with real production bundle/Electron bridge;
- exercise all core hotkeys on Windows/Linux Ctrl and macOS Cmd normalization;
- verify SVG toolbar and tooltip bindings;
- edit/reset shortcuts in Code Settings;
- quick open, command palette, search/replace, line transforms;
- all auto-save modes and dirty-close paths;
- bounded wrapping at 120 and custom value;
- oversized-file external/reveal/open-anyway actions;
- settings tab behavior and no file/LSP/Git side effects;
- no global provider/model/agent mutations.

## Staged delivery

1. Performance instrumentation, Monaco preload, and document/model cache.
2. Central command registry and Monaco editing actions.
3. Quick open and command palette.
4. SVG toolbar conversion.
5. Code settings store and special Settings tab.
6. Auto-save and dirty-close safety.
7. Large-file metadata gate and one-time reduced mode.
8. Dynamic Prettier formatter integration.
9. Full performance benchmark, automated regression suite, and real UI verification.

Each stage is test-first and independently buildable. Production code changes are committed in coherent slices directly on `develop` after focused verification.

## Non-goals

- Per-language settings overrides in this pass.
- Replacing Monaco with another editor.
- Mutating global terminal keybindings to accommodate Code.
- Global agent/provider/model changes from Code settings.
- Silent save/discard on close.
- Loading Prettier in the file-open critical path.
- Editing files above the configured limit without explicit one-time override.
