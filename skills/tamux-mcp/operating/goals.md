# Goal Runs

## Agent Rules

- **Use goal runs for outcomes, not scripts** — start a goal run when one worker should pursue a bounded objective under owner supervision
- **Treat goal runs as durable background work** — the run, worker task, and status stay available across UI disconnects and daemon restarts
- **Write the `goal` as the desired result** — include scope, constraints, and success criteria instead of step-by-step instructions
- **Use `session_id` when terminal context matters** — it targets an existing active terminal session; it does not create or guarantee one
- **Monitor with `get_goal_run` before intervening** — inspect status and `pending_review_report` to confirm whether the worker is running, awaiting review, or actually needs action
- **Use `control_goal_run` only for supported controls** — `pause`, `resume`, `cancel`, `accept`, `soft_reject`, and `hard_reject`
- **Do not claim the goal is complete in prose** — the worker must call `request_goal_review`; the owner must `accept` before the run is done
- **Do not split one objective into many background tasks unless you need exact queue control** — goal runs are for supervised autonomy; tasks are for explicit dependency/scheduling management

## Reference

### `start_goal_run`

Start a durable goal run. Provide the `goal` text. The daemon pins the launching thread as owner supervisor and enqueues one worker on `goal:{id}`.

| Param | Type | Required | Description |
|---|---|---|---|
| `goal` | string | Yes | Goal text describing the outcome to accomplish |
| `title` | string | No | Short display title |
| `thread_id` | string | No | Owner/supervisor thread; does not target terminal execution |
| `session_id` | string | No | UUID from an existing active terminal session to target |
| `priority` | string | No | `low`, `normal`, `high`, `urgent` |

**Returns:** Full goal run JSON object.

### Goal Run Lifecycle

```text
queued -> running -> awaiting_review -> completed
                                  -> running (soft_reject)
                                  -> failed (hard_reject)
                           -> paused -> running
any -> cancelled
```

- `queued` — accepted, waiting for the worker task
- `running` — the worker is executing
- `awaiting_review` — the worker called `request_goal_review` and is blocked until a supervisor verdict
- `completed` — the owner accepted; this is terminal
- `paused` — operator paused future orchestration; a worker already running is not terminated automatically
- `cancelled` — operator ended the run; this is terminal
- `failed` — hard reject or worker failure

### `list_goal_runs`

List durable goal runs with status and summary metrics.

**Parameters:** None.

### `get_goal_run`

Fetch one goal run with status, worker thread, and `pending_review_report` when awaiting review.

| Param | Type | Required | Description |
|---|---|---|---|
| `goal_run_id` | string | Yes | Goal run UUID |

### `control_goal_run`

Change run state or submit a supervisor verdict.

| Param | Type | Required | Description |
|---|---|---|---|
| `goal_run_id` | string | Yes | Goal run UUID |
| `action` | string | Yes | `pause`, `resume`, `cancel`, `accept`, `soft_reject`, `hard_reject` |
| `payload` | object | No | For `soft_reject` and `hard_reject`, `{ "explanation": "..." }` is required |

No other user-facing controls are supported. Completeness is never implied by the worker finishing a turn.

## When To Use Goal Runs

- Use a goal run when you want one worker to pursue an outcome and an owner supervisor to accept or reject completeness
- Use a task when you already know the exact unit of work, command, dependency chain, or schedule you want queued
- Use a normal chat turn when you only need reasoning, advice, or a quick answer without durable execution

## Gotchas

- Goal runs use one worker task; they do not replace the task system
- Approval gates pause autonomous progress; check the run state before assuming it is stuck
- Pausing a goal run stops future orchestration, but it does not terminate a worker that is already running
- Soft reject continues the same worker on the same thread; there is no automatic retry budget
- Goal runs currently require the built-in `daemon` backend, the service that owns run state and orchestration
