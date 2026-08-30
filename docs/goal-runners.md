# Goal Runners

A goal run is one worker on a dedicated `goal:{id}` thread plus an owner supervisor. The worker does the work. Completeness is decided only by the supervisor.

For the currently landed additive state-transition substrate that goal work can build on, see [state-transition-harness.md](./state-transition-harness.md).

## What A Goal Run Does

1. Accepts a long-running objective from the UI, CLI, or an owner agent.
2. Pins the launching thread as the owner supervisor for the life of the run.
3. Enqueues one worker task on `goal:{id}` with the goal text as the prompt.
4. The worker works until it claims completeness by calling `request_goal_review`.
5. The owner (or Mission Control, if there is no owner agent) verdicts: Accept, Soft reject, or Hard reject.

Finishing a worker turn without `request_goal_review` does not complete the goal.

## Starting A Goal Run

From the TUI:

1. Open `Goals`.
2. Start a new goal to open `Mission Control`.
3. Enter the goal prompt in the preflight view.
4. Confirm the primary agent provider, model, and reasoning effort.
5. Start the run from Mission Control.

Good goal prompts are specific, bounded, and outcome-oriented.

Example:

```text
Investigate why the nightly Rust build is failing, identify the root cause, propose the smallest safe fix, and capture any reusable workflow as a skill.
```

## Lifecycle

Goal runs move through these top-level states:

- `queued`: accepted, waiting for the worker task
- `running`: the worker is executing
- `awaiting_review`: the worker blocked and asked the supervisor to verdict
- `paused`: orchestration is paused by the operator
- `completed`: the owner accepted
- `failed`: the owner hard-rejected, or the worker failed
- `cancelled`: the operator cancelled the goal run

Unused historical statuses may still appear on old rows. New runs do not write them.

## Supervisor Protocol

The worker must call `request_goal_review { report }`. That:

- sets the run to `awaiting_review`
- blocks the worker (`Blocked` with reason `awaiting supervisor:`)
- wakes the owner with the report

The owner (owner thread, or `control_goal_run` with no caller thread for a human) then calls `submit_goal_review` with one of:

- `accept` — criteria met; stop the worker; unpin the owner; `Completed`
- `soft_reject` — explanation required; the same worker continues on the same thread with that feedback
- `hard_reject` — cancel the worker; stop the worker thread; unpin the owner; `Failed`

First verdict wins. Soft-reject loops have no automatic retry budget; the owner hard-rejects or the operator cancels.

UI-launched goals with no owner agent use the same three buttons in Mission Control and the Goals view.

Operator controls that remain: `pause`, `resume`, `cancel`.

## Mission Control During A Run

While a goal is running, Goals stays an orchestration surface and Threads stays a conversation surface.

Mission Control exposes:

- tabs: Work, Review, Activity, Threads, Files
- worker thread and current status
- worker todos as progress (not a completion gate)
- the review dialogue (report plus Accept / Soft reject / Hard reject)
- pause / resume / cancel

`Esc` in Goals does not collapse back into inline chat. If you want to steer the active execution thread directly, use `Open active thread` to jump into `/threads`. Threads opened that way show a `Return to goal` affordance so you can safely come back to the same goal run.

## How Goal Runs Use The Execution Queue

A goal run owns the long-lived objective. It enqueues one worker task (`source=goal_run`) on the dedicated working thread. That task uses the normal tool-loop bound. Worker-internal `update_todo` is the worker's own checklist; it is not a completion gate.

The only way a goal completes is owner `accept`. The only way it dies from review is `hard_reject` (or operator cancel).
