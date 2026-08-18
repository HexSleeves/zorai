# Loop-Ledger Daemon Integration Analysis

Date: 2026-08-17
Scope: implementing the J-Space-derived mechanisms (5-state ledger, verifier binding, failure inheritance, broadcast-once anchors) as daemon capabilities instead of pure convention. Complements `guidelines/loop-ledger-verification-task.md` and `skills/productivity/agent-skills/loop-ledger/`.

## Current state (what exists today)

| Mechanism | Existing daemon support | Gap |
|---|---|---|
| Tier gating | Skill discovery + deferred tools load machinery per turn | No persisted notion of task tier (fast/full/loop) |
| 5-state ledger | `threads/<id>/artifacts/specs/` prompt convention; goal inventory dirs (`goal_inventory_specs_dir`) exist per goal run | No structured ledger artifact; no resume-time injection |
| Verifier binding | `GoalProofCheck { id, title, state, summary, evidence_ids, resolved_at }`; `proof-ledger.json` projection; `submit_goal_step_verdict(verdict, explanation)` with task/goal/step binding checks | Verdict has no verifier/coverage/gap fields; proof checks are dossier-side, not per-completion-claim |
| Failure inheritance | Goal run health, quiet recovery, resume decisions (`GoalResumeDecision` with reason codes) | No diagnosis-carrying retry rule; retries don't cite prior failure cause |
| Broadcast-once anchors | Dossier units aggregate evidence/proof checks; subagent context bundles | No explicit "Core anchors" block broadcast to step tasks and children |
| Seam checkpoints | Compaction artifacts (`compaction/artifact.rs`) preserve state across context loss | No ledger refresh hook on tool-chain boundary / subagent return |

## Key code paths

1. **Verification prompt**: `crates/zorai-daemon/src/agent/goal_planner/progress.rs` — `enqueue_goal_step_verification()` builds the reviewer task description ("Use verdict `pass` only when..."). This is where verifier-binding language enters.
2. **Verdict ingestion**: `crates/zorai-daemon/src/agent/tool_executor/tasks.rs` — `execute_submit_goal_step_verdict()` validates verdict/explanation, binds task→goal_run→step. Extension point for structured evidence fields.
3. **Proof model**: `crates/zorai-daemon/src/agent/types/goal_dossier.rs` — `GoalProofCheck`, `GoalEvidenceRecord`, `GoalRunReport`.
4. **Projection**: `crates/zorai-daemon/src/agent/goal_dossier/projection.rs` — writes `dossier.json`, `proof-ledger.json`, `goal.md` per goal run; inventory dirs specs/plans/execution already created.
5. **System prompt injection**: `crates/zorai-daemon/src/agent/system_prompt.rs` + `prompt_inspection.rs` (guidelines section auto-rendered from guidelines dir).
6. **Resume**: `goal_quiet_recovery.rs`, `goal_run_health.rs`, `GoalResumeDecision`.

## Implementation proposals (ordered by leverage/effort)

### P1 — Structured verdict evidence (verifier binding, hard gate)
Extend `submit_goal_step_verdict` args with optional-but-enforced fields:
- `verifier: String` (command/test/review + exit code)
- `coverage: String` (scope exercised)
- `gaps: Option<String>` (not covered)

Changes:
- `execute_submit_goal_step_verdict()`: parse new fields; when `verdict == pass`, reject empty `verifier`/`coverage` with an actionable error ("a pass requires the verifier that ran and its coverage scope"). Keep `fail` unencumbered.
- `GoalStepReviewVerdict` storage path: persist fields into the dossier (new `GoalVerdictEvidence` struct in `types/goal_dossier.rs`, linked by `evidence_ids`).
- `enqueue_goal_step_verification()` prompt: add the three-field requirement text.
- Tests: extend `agent/tool_executor/tests/part6.rs` verdict cases (pass without verifier → error; with fields → persisted into proof ledger).

Effort: small, contained, no schema migration risk (serde defaults).

### P2 — Goal-run ledger artifact (5-state, persisted)
Write `ledger.md` (+ `ledger.json` for machine use) into `goal_inventory_specs_dir()` at goal creation; update on step transitions:
- `Goal`: from `GoalRun.goal` (daemon-owned).
- `Core`: anchors extracted from dossier units (paths, IDs, constraints) — append-only via a small `core_anchor` concept or reuse `GoalEvidenceRecord` with a new record kind.
- `Verified`: derived — one entry per passed proof check.
- `Open`: derived from failed/pending steps and resume decisions with reason codes.
- `Next`: from current in-progress step's `success_criteria` first line.

Changes live in `goal_dossier/projection.rs` (extend `write_goal_projection_files`) and `goal_planner/progress.rs` (step transitions). Feed `Next` + `Core` into the step task description builder in `task_prompt.rs` so every step agent starts with the anchors instead of re-deriving them.

Effort: medium. Highest payoff for long runs: any resume (quiet recovery, restart) reads one file instead of reconstructing from events.

### P3 — Failure inheritance on retries
`goal_run_health.rs` already tracks `retry_count`/`next_retry_at`. Add `last_failure_diagnosis: Option<String>` to the step/task health record:
- On fail verdict or task error, store the explanation/error (already captured) into the diagnosis field.
- When re-dispatching a step task, prepend "Prior attempt failed: {diagnosis}. The retry must state what changed; a repeat of the same approach without new diagnosis should fail review."
- Cheap heuristic gate in review prompt: if retry_count ≥ 2 and diagnosis unchanged, instruct reviewer to demand an approach switch.

Effort: small-medium. Leverages existing `GoalResumeDecision.reason_code` plumbing.

### P4 — Seam checkpoint injection (resume + subagent return hooks)
At the two cheapest seams:
- After quiet-recovery resume: inject ledger `Goal`/`Next` into the resumed turn's context (one prompt block in `goal_quiet_recovery.rs` resume path).
- On subagent completion integration (`agent/subagent`): when parent aggregates child results, include the child's ledger `Verified` entries in the aggregation context.

Full tool-call-boundary checkpointing is not recommended initially — token cost per seam is high and the existing compaction artifact path already covers the worst case (context loss).

### P5 — Tier flag on tasks/goal steps
Add `tier: fast|full|loop` to `AgentTask`/`GoalRunStep` (serde default `full`). Loop tier gates ledger maintenance and checkpoint injection so simple tasks pay nothing. Set via planner LLM output schema (goal_parsing) with conservative default.

## Implementation status

- P1 **implemented** and committed (d3fd1e70): `GoalVerdictEvidence` in `types/task_types.rs`, parse/validate helpers in `goal_planner.rs`, pass-verdict enforcement in `tool_executor/tasks.rs`, schema args in `tool_executor/catalog/part_d.rs`, reviewer prompt + step-summary/provenance evidence in `goal_planner/progress.rs`. `cargo check` passes; verdict tests pass; `goal_planner`/`part6` mass failures are pre-existing test-env SQLite init panics (confirmed on stashed baseline).
- P2 **implemented** and committed (c597c72c): `ledger.md`/`ledger.json` (Goal/Core/Verified/Open/Next) written into `goal_inventory_specs_dir` on every projection refresh (`goal_dossier/projection.rs`); ledger injected into all four step task enqueue descriptions via `goal_step_task_description`, into verification task descriptions, and into planner replan prompts for non-terminal runs. `cargo check` + goal_dossier/verdict tests pass.
- P3 **implemented** and committed (e96a0e8b): `GoalRun.step_failure_history` records `step_id#title attempt N: diagnosis` on every requeue; `goal_step_task_description` prepends a Retry context block with prior diagnoses, escalating to a switch-approach warning at 2+ attempts; history surfaces in the ledger Open section. New tests: `verifier_fail_verdict_requeues_current_step` extended with history/retry-context assertions, `repeated_step_failures_warn_about_approach_switch` added. All targeted suites pass.
- P4 **implemented**: active-step task dispatch reads daemon-owned `inventory/specs/ledger.json` with an in-memory projection fallback, injects the source path and current-step pointer, and now covers successful specialist/divergent/debate routes as well as normal goal tasks. Quiet-goal recovery injects a compact Goal/Core/Next resume checkpoint. Completed subagent returns inject current-step/Verified/Next integration context so the parent does not re-derive established checks. Focused projection and quiet-recovery tests cover the new seams.

## Ordering recommendation

P1 first (small, hardens the core anti-false-completion gate), then P2 (ledger persistence — multiplies resume reliability), P3 (retry hygiene), P4 (seam checkpoint injection), and P5 last (tier gating). P1–P4 are implemented; P5 remains.

## Non-goals

- No first-person grammar control, no first-turn persona anchoring (model-specific overfits, contradict provider-agnostic design).
- No benchmark claims import from the J-Space report (single-run, unverified).
