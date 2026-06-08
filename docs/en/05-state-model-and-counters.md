# State model and counters

The plugin's internal state lives in `src/state.ts`. Its job is to store subagent evidence, maintain invariants, and count real executions without duplicating technical wrappers.

Main idea:

> `children` stores what the plugin knows. `totalExecuted` counts real work. The UI may show fewer rows than the state stores.

## Central state

The main state type is `StatuslineState`.

Simplified shape:

```ts
type StatuslineState = {
  children: Record<string, ChildSessionState>
  countedChildIDs: string[]
  totalExecuted: number
  updatedAt: string
}
```

| Field | Meaning |
| --- | --- |
| `children` | Map of known work items: real sessions, subtasks, and wrappers. |
| `countedChildIDs` | Identities that already counted as execution. |
| `totalExecuted` | Semantic total of real executions. |
| `updatedAt` | Last derived state update. |

## ChildSessionState

Each `children` entry represents an item related to delegated work.

Simplified shape:

```ts
type ChildSessionState = {
  id: string
  parentID?: string
  messageID?: string
  targetSessionID?: string
  source?: "session" | "subtask" | "tool"
  status: "running" | "done" | "error"
  title?: string
  summary?: string
  agent?: string
  startedAt?: string
  updatedAt?: string
  endedAt?: string
  elapsedMs?: number
  color?: string
  tokenState?: ChildTokenState
}
```

## Sources

`source` is the key field for understanding behavior.

| Source | Represents | Example ID | Counts as execution |
| --- | --- | --- | --- |
| `session` | Real OpenCode child session. | `ses_abc123` | Yes, once. |
| `subtask` | Synthetic representation of a message part. | `subtask:prt_1` | May count as fallback. |
| `tool` | Technical tool-call wrapper. | `tool:prt_2` | No. |

Counters use this classification, not duration or visibility.

## Internal statuses

The plugin reduces many possible statuses to three internal values:

```txt
running | done | error
```

| Status | Meaning |
| --- | --- |
| `running` | Evidence of active or pending work. |
| `done` | Evidence of successful/idle completion. |
| `error` | Evidence of error, cancellation, or failure. |

Color and elapsed duration are derived fields refreshed from state.

## ID vs targetSessionID

`id` identifies the internal state entry.

`targetSessionID` identifies the real navigable session, when known.

```ts
{
  id: "subtask:prt_1",
  source: "subtask",
  targetSessionID: "ses_child"
}
```

That means:

- the internal item is still the subtask;
- the associated real session is `ses_child`;
- the UI can navigate to `ses_child`;
- counters can reconcile toward `ses_child`;
- rendering can merge real session data into the synthetic row.

## Counting rules

The plugin counts real executions, not events or rows.

Rules:

1. `source: "tool"` never increments `totalExecuted`.
2. `source: "session"` increments once per real session.
3. `source: "subtask"` may increment as fallback if no real session is associated yet.
4. When a real session appears for an already-counted subtask, the counter reconciles without incrementing again.
5. Repeated updates of the same child do not count again.

## Why `tool` does not count

A `tool:*` wrapper represents the technical call, not necessarily the real work.

```txt
tool:prt_task  -> task wrapper
ses_child      -> real session created by that task
```

If both counted, one delegation would become two executions.

Therefore:

```txt
tool:prt_task = evidence, not execution
ses_child     = real execution
```

Even a wrapper with nonzero duration still does not count. The rule is based on `source`, not timing heuristics.

## Real session counting

When a real session arrives:

```ts
upsertRunningChild(state, {
  id: "ses_child",
  source: "session",
  parentID: "ses_parent",
  targetSessionID: "ses_child"
})
```

The plugin:

1. creates or updates `children["ses_child"]`;
2. checks whether that identity was already counted;
3. increments `totalExecuted` if it was not counted;
4. records the identity in `countedChildIDs`.

A later update for `ses_child` does not increment again.

## Subtask fallback counting

Sometimes a `subtask` appears before the real session.

```txt
subtask:prt_1 appears first
ses_child appears later
```

Before the real session is known, the subtask may count as fallback:

```ts
countedChildIDs = ["subtask:prt_1"]
totalExecuted = 1
```

When the real session appears and the subtask gets `targetSessionID`, the counter reconciles:

```ts
countedChildIDs = ["ses_child"]
totalExecuted = 1
```

The total stays one because it is the same work.

## Rekeying

Rekeying changes the counted identity from a provisional ID to a stronger ID.

```txt
Before: countedChildIDs = ["subtask:prt_1"]
After:  countedChildIDs = ["ses_child"]
```

This happens when:

- a counted subtask gets `targetSessionID`;
- a correlated real session appears;
- loaded state is normalized.

The goal is to keep `totalExecuted` correct and avoid duplicates.

## Persistence

State can be saved as JSON.

Default path:

```txt
$XDG_RUNTIME_DIR/opencode-subagent-statusline/<instance>/state.json
```

If `XDG_RUNTIME_DIR` is absent, the system temp directory is used.

`status.txt` lives next to `state.json` and contains runtime text output.

Relevant variables:

| Variable | Use |
| --- | --- |
| `OPENCODE_SUBAGENT_STATUSLINE_STATE` | Overrides the `state.json` path. |
| `OPENCODE_SUBAGENT_STATUSLINE_INSTANCE` | Defines the instance name. |
| `OPENCODE_SUBAGENT_STATUSLINE_PRESERVE_STATE=1` | Prevents runtime startup state clearing. |
| `XDG_RUNTIME_DIR` | Default base for runtime state. |

The TUI also persists auxiliary snapshots, but its main state is in memory while active.

## Load normalization

`loadState()` is defensive.

If JSON is broken or missing, it returns an empty state.

When loading persisted state, it normalizes counters to reduce inconsistencies:

- avoids adding new `tool:*` wrappers to counts;
- reconciles subtasks with known `targetSessionID`;
- deduplicates equivalent identities;
- preserves compatibility with historical data.

Important: the project does not promise to repair every inflated counter from old versions. The priority is preventing new incorrect counts.

## Derived fields and pruning

State refresh recalculates fields such as:

| Field | Source |
| --- | --- |
| `elapsedMs` | Difference between `startedAt` and `endedAt` or current time. |
| `color` | Derived from `status`. |
| `updatedAt` | Latest known update. |
| tokens/context | Evidence from events, TUI state, SQLite, or logs. |

Old terminal children may be pruned to avoid unbounded growth. Terminal rows are
retained for up to 3 days with a 1,500-row cap. Pruning rows must not reduce
`totalExecuted`.

## Main mutation helpers

| Helper | Responsibility |
| --- | --- |
| `createEmptyState()` | Create initial state. |
| `upsertRunningChild()` | Create or update a running child. |
| `markChildStatus()` | Mark a child as `done` or `error`. |
| `upsertChildDetails()` | Merge title, summary, agent, tokens, and target. |
| `refreshDerivedFields()` | Recalculate duration, color, pruning, and timestamps. |
| `loadState()` | Load and normalize persisted state. |
| `saveState()` | Save normalized state to disk. |

## Example flow

```ts
children["tool:prt_task"] = { id: "tool:prt_task", source: "tool", status: "running" }
countedChildIDs = []
totalExecuted = 0

children["subtask:prt_1"] = { id: "subtask:prt_1", source: "subtask", status: "running" }
countedChildIDs = ["subtask:prt_1"]
totalExecuted = 1

children["ses_child"] = { id: "ses_child", source: "session", targetSessionID: "ses_child", status: "running" }
children["subtask:prt_1"].targetSessionID = "ses_child"

countedChildIDs = ["ses_child"]
totalExecuted = 1
```

Rendering may show one visible row even though state keeps multiple evidence entries.

## Invariants for future changes

- A `tool:*` wrapper must not increment `totalExecuted`.
- A real session must count exactly once.
- A fallback-counted subtask must not duplicate when its real session appears.
- `targetSessionID` must be used only with safe correlation.
- State must tolerate invalid JSON and old data.
- Pruning children must not change historical execution totals.
- Counter changes should update `state`, `events`, and `render` tests as needed.

## Related tests

| File | Confirms |
| --- | --- |
| `src/state.test.ts` | Counting, rekeying, persistence, and normalization. |
| `src/events.test.ts` | Target extraction and safe correlation. |
| `src/render.test.ts` | Visual collapse without duplicate rows. |
| `src/reconcile.test.ts` | Conservative stale-state closure. |
