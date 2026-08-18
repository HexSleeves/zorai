---
name: loop-ledger-verification
description: Use when executing long multi-step tasks, goal runs, or subagent handoffs that need persistent task state, verifier-bound completion claims, and diagnosis-carrying retries. Adapted from the J-Space capability-realization report.
recommended_skills:
recommended_guidelines:
  - planning-task
  - task-intake
  - project-management-task
---

## Overview

Long tasks fail through state loss, not model weakness: goals fade during mechanical execution, constraints get re-derived differently per branch, retries discard failure diagnoses, and local test success gets reported as overall completion. This guideline counters those four loss modes with a minimal persistent ledger and three binding rules. It is runtime-agnostic — no first-person grammar tricks, no first-turn persona anchoring.

## Tier gating (choose before starting)

- **fast** — single-step, self-verifiable work. No ledger, no spec. Just do it.
- **full** — bounded multi-step work. `update_todo` + a short spec in the thread specs dir.
- **loop** — multi-file / multi-tool / multi-session / goal-run work. Ledger artifact (below) + spec + explicit checkpoints.

## The 5-state ledger (loop tier only)

Keep exactly one file per task, e.g. `threads/<id>/artifacts/specs/ledger.md`, with five sections and nothing else:

```
# Ledger: <task>
## Goal      — one sentence; the deliverable, not the activity
## Core      — anchors established once: paths, names, constraints, style. Broadcast to all branches; never re-derived.
## Verified  — append-only: claim | verifier that ran | coverage scope | NOT covered
## Open      — unresolved questions/blockers, each with owner or next probe
## Next      — exactly one next action, executable without further context
```

Rules:
- `Core` entries are written once and referenced everywhere (subagent descriptions, child tasks, resume turns). If a branch needs a new anchor, add it to `Core` and broadcast — do not fork a private copy.
- `Next` is replaced, never accumulated. If it cannot be executed cold, it is not specific enough.
- On resume after pause/handoff/restart: re-read the ledger before re-reading anything else.

## Rule 1 — Verifier binding

Every completion claim (todo completion, goal step verdict, workspace completion, "done" message) must state:

1. **Verifier** — what concretely ran: command + exit code, test name, review, build.
2. **Coverage** — what scope that verifier actually exercised.
3. **Gap** — what it did not cover.

A claim without all three is a hypothesis, not a result. Partial coverage is fine; unscoped "tests pass" is not.

## Rule 2 — Failure inheritance

- Any retry must cite the prior attempt's diagnosis. A retry with no new diagnosis is forbidden — that is a blank retry.
- After two diagnosed failures on one path, the path is wrong: switch approach or escalate, and record the switch in `Open`/`Core`.
- Failed-path knowledge is appended to the ledger (e.g. `Verified` negative entries or `Open` with diagnosis), so post-restart attempts do not replay it.

## Rule 3 — Checkpoint on seam crossings

After each tool-call chain boundary, file/context switch, or subagent return, refresh from the ledger before acting: confirm `Goal` still matches the request, `Next` still applies, and any new constraint earned a `Core` entry. Checkpoints are cheap; drift is expensive.

## Quality Gate

A loop-tier task is complete when: the deliverable exists, `Verified` entries' combined coverage matches the `Goal` scope (with gaps explicitly accepted), `Open` is empty or explicitly deferred with reason, and the final report states verifier + coverage per claim.
