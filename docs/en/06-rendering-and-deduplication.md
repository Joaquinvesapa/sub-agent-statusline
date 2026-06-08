# Rendering and deduplication

`src/render.ts` turns internal state into a useful view. It does not show every `children` entry as stored. It first sorts, collapses duplicates, filters rows, and builds an aggregate summary.

Core rule:

> The UI shows human-readable work, not every technical detail stored as evidence.

## From internal state to visible rows

```txt
StatuslineState.children
  ↓
sort by priority
  ↓
collapseSubagentWorkItems()
  ↓
filter visibility
  ↓
renderStatusLine() / sidebar
```

This is why three internal entries can represent one delegated task and become one visible row.

## Why deduplication is needed

OpenCode can emit multiple representations of the same subagent:

```txt
tool:prt_task       task technical wrapper
subtask:prt_sub     synthetic message part
ses_child           real child session
```

For the user, this is usually one delegation. Showing all raw entries would create duplicate-looking rows.

## Deduplication vs counting

Deduplicating visible rows is not the same as counting executions.

| Concept | Where it lives | Question it answers |
| --- | --- | --- |
| Counting | `src/state.ts` | How many real executions happened? |
| Visual deduplication | `src/render.ts` | How many rows should the user see? |
| Internal state | `StatuslineState.children` | What evidence does the plugin know? |

Example:

```txt
internal children: 3
visible rows:      1
totalExecuted:     1
```

That can be completely correct.

## Priority ordering

Before rendering, items are ordered so the most relevant entries appear first.

General rules:

- newer items first;
- `running` and `error` matter more than old history;
- ID tie-breakers keep ordering stable.

Stable ordering prevents unnecessary UI jumping when timestamps match.

## Work item collapse

The main helper is `collapseSubagentWorkItems()`.

It groups related representations of the same work.

| Case | Expected result |
| --- | --- |
| `subtask:*` with `targetSessionID` to `ses_*` | Show one enriched row. |
| `tool:*` associated with a `subtask:*` and real session | Hide the technical wrapper. |
| Real session duplicated by a more descriptive synthetic row | Merge terminal/timing/token data. |
| Generic wrapper without safe correlation | Do not collapse with an unrelated session. |

## Data that can be merged

When a relationship is safe, rendering can prefer or copy useful data from the real session into a synthetic row:

- terminal `status` (`done` or `error`);
- `endedAt`;
- duration;
- `targetSessionID`;
- tokens/context;
- color;
- useful summary or title.

This lets a row with a human title such as `Review current diff` show the real terminal status from `ses_child`.

## Example: subtask + session

Internal state:

```ts
children = {
  "subtask:prt_1": {
    id: "subtask:prt_1",
    source: "subtask",
    title: "Review current diff",
    targetSessionID: "ses_child",
    status: "running"
  },
  "ses_child": {
    id: "ses_child",
    source: "session",
    targetSessionID: "ses_child",
    status: "done",
    endedAt: "..."
  }
}
```

Expected visible row:

```txt
Review current diff · done
```

The real session contributes terminal status, while the subtask keeps the better title.

## Example: technical wrapper without target

Internal state:

```ts
children = {
  "tool:prt_task": {
    id: "tool:prt_task",
    source: "tool",
    title: "task",
    status: "running"
  },
  "ses_other": {
    id: "ses_other",
    source: "session",
    status: "running"
  }
}
```

If there is no safe evidence that `tool:prt_task` corresponds to `ses_other`, rendering must not collapse them.

## Visibility of `done` rows

The plugin does not keep all completions visible forever.

General behavior:

- `running` remains visible;
- `error` remains visible;
- recent `done` remains visible for feedback;
- old `done` can be hidden;
- active work prioritizes rows related to that work.

This keeps the sidebar useful instead of turning it into a long history.

The sidebar can temporarily relax the `done` filters through completed history.
When completed history is enabled, stale `done` rows and unrelated `done` rows
hidden during active work become visible again after the normal collapse/dedupe
step. Text statusline output and the home summary keep the default filtering.

## Visibility vs pruning

Hiding a row during render is not the same as deleting it from state.

Two layers exist:

1. **Visibility filtering** in `src/render.ts`.
2. **State pruning** in `src/state.ts`, which keeps terminal rows for up to 3
   days with a 1,500-row cap.

Neither should reduce `totalExecuted`.

Completed history only displays retained rows. It does not restore rows that
state pruning already removed or past sessions that OpenCode APIs do not return.

## Text rendering

The project can also produce text statusline output.

Conceptual example:

```txt
↳ 1 running · 1 done · 0 error · Σ 2 total · Review diff 00:42 · Tests 01:10
```

Text rendering includes:

- running count;
- visible done count;
- error count;
- total executed;
- compact per-child details;
- token/context details when available.

## Duration, tokens, and color

Durations are compact:

| Duration | Format |
| --- | --- |
| Less than 1 hour | `MM:SS` |
| 1 hour or more | `HH:MM:SS` |

Token/context examples:

```txt
1,500 tokens · 12.3% used
1.5k ctx 12%
```

ANSI color in text output can be disabled with:

```sh
NO_COLOR=1
```

or:

```sh
OPENCODE_SUBAGENT_STATUSLINE_COLOR=0
```

## Aggregate state

Aggregate output may look like:

```txt
↳ 1 running · 0 done · 1 error · Σ 2 total
```

Important distinction:

- `running`, `done`, and `error` describe visible or relevant rows;
- `Σ total` comes from semantic counters;
- the total may be larger than the current visible row count.

## When fewer rows are correct

| Case | Correct visible result |
| --- | --- |
| `tool:prt_task` + `ses_child` | One real session row. |
| `subtask:prt_1` + `ses_child` | One enriched subtask row. |
| Old `done` plus active work | Active work visible; old done hidden. |

With completed history enabled in the sidebar, the old `done` row in the final
case is visible again if it is still retained in state.

## When not collapsing is correct

| Case | Why not collapse |
| --- | --- |
| Wrapper without target and multiple sessions | Correlation is ambiguous. |
| Output contains multiple session IDs | Choosing one would be a guess. |
| Similar generic titles only | Title alone is not strong enough evidence. |

## Relation to the sidebar

The TUI sidebar consumes processed rows so it can show delegated work instead of raw technical signals.

It also applies UX rules:

- prefer current-session subagents;
- show other sessions when appropriate;
- support focus and navigation;
- open a session only when `targetSessionID` is navigable;
- preserve scroll and expanded/collapsed state.

## Tests

`src/render.test.ts` protects:

- collapse between synthetic rows and real sessions;
- not collapsing generic wrappers without correlation;
- keeping recent `done` rows visible;
- hiding unrelated history when active work exists;
- stable ordering;
- aggregate formatting and `NO_COLOR`.

Related behavior also depends on `src/state.test.ts`, `src/events.test.ts`, and `src/reconcile.test.ts`.

## Change checklist

Before changing rendering or deduplication, check:

- Am I hiding a row only with safe evidence?
- Does the technical wrapper still avoid execution counting?
- Is the visible title still useful for humans?
- Is the real session still navigable through `targetSessionID`?
- Are errors still visible?
- Do recent `done` rows still provide feedback?
- Is semantic total still independent of visible row count?
- Did I add or update render tests for rule changes?

## Summary

Rendering turns technical evidence into a human view. It avoids visual duplicates, preserves useful information, hides technical noise, keeps errors and active work visible, and keeps the semantic total separate from the number of visible rows.
