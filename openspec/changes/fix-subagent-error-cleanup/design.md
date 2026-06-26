# Design: Fix Subagent Error Cleanup

## Technical Approach

Keep list visibility and status aggregation as two separate projections over the same retained real executions. `src/render.ts` already owns row visibility through `visibleSubagentWorkItems()` and terminal recency in `isVisibleWorkItem()`. That path should continue deciding which rows render by default/history. Header/status counters must instead count retained, not-yet-pruned current-session real executions after classification/correlation, so hidden terminal `done`/`error` rows still appear in `done`, `err`, and `Σ`. `src/state.ts` retention remains unchanged: `pruneTerminalChildren()` removes terminal rows by TTL/cap, and `countHistoricalSubagentExecutions()` already gives retained `Σ` semantics.

## Architecture Decisions

| Option | Tradeoff | Decision |
|---|---|---|
| Count counters from visible rows | Simple, but hidden retained terminal rows disappear from `done`/`err` | Reject. This is the bug. |
| Count counters from retained correlated executions | Slightly more code, but matches spec and `Σ` | Choose. Visibility is not aggregation. |
| Prune errors earlier from state | Removes clutter, but loses history/toggle access and `Σ` sooner | Reject. Errors must age like `done`. |

| Option | Tradeoff | Decision |
|---|---|---|
| Add a retained status-count helper beside historical counting | Centralizes real-execution classification and parent scoping | Choose. Avoid duplicating `correlateSubagentWorkItems()` logic in UI/render. |
| Use `getCounts(state)` directly everywhere | Existing all-state helper is close, but lacks parent scoping and correlation semantics clarity | Reject for TUI session snapshots. |

| Option | Tradeoff | Decision |
|---|---|---|
| Fall back to other-session rows whenever current visible rows are empty | Keeps sidebar populated, but can mix other-session visible rows/counts with current-session `Σ` when current history is hidden | Reject. Scope consistency is more important than filling empty rows. |
| Fall back only when the current session has no visible rows and no retained real executions | Preserves current hidden history counters and keeps rows/counts/`Σ` in one scope | Choose. Hidden current history blocks fallback; truly empty current sessions may still show other sessions. |

## Data Flow

```
state.children (retained until pruneTerminalChildren TTL/cap)
        │
        ├─→ render.ts visibleSubagentWorkItems()
        │      └─ default/history visibleChildren for row rendering
        │
        └─→ state.ts retained status counter helper
               ├─ running/done/error for headers/status
               └─ countHistoricalSubagentExecutions() for Σ
```

Default mode may show only `1 run`; the retained counter projection can still produce `1 run · 6 done · 7 err · Σ 13`. History mode still uses `showCompletedHistory` to reveal hidden retained terminal rows without changing counter totals.

## File Changes

| File | Action | Description |
|------|--------|-------------|
| `src/state.ts` | Modify | Add/export retained status counting helper near `countHistoricalSubagentExecutions()`, scoped by optional `parentSessionID`, using `correlateSubagentWorkItems()` to count real retained `running`/`done`/`error` once. Keep pruning unchanged. |
| `src/render.ts` | Modify | Keep `visibleSubagentWorkItems()` for details only. Update `renderStatusLine()` to derive aggregate `running/done/error` from retained correlated executions, not the visible row list. |
| `src/tui.tsx` | Modify | In `resolveTuiSubagentSnapshot()`, keep `visibleChildren` from `visibleSubagentWorkItems()`, but add/use retained `statusCounts` for `AggregateBar` and `HomeBottomStatus`. Preserve `totalExecuted` from `countHistoricalSubagentExecutions()`. |
| `src/render.test.ts` | Modify | Add regression where `renderStatusLine()` shows retained hidden terminal `done/error` counts while details only include visible rows. |
| `src/tui.test.ts` | Modify | Add screenshot-style snapshot: default visible list has `1 run`, retained counters show `1 run`, `6 done`, `7 error`, and `Σ 13`; history reveals terminal rows without changing counts. |
| `src/state.test.ts` | Modify | Cover retained status helper and old `error` terminal pruning. |

## Interfaces / Contracts

No public API change. Internal contracts:

```ts
visibleSubagentWorkItems(children, nowMs, { showCompletedHistory?: boolean })
countRetainedSubagentStatuses({ children, parentSessionID? }): StatusCounts
```

- Default: visible rows exclude stale terminal `done` and `error` executions.
- History enabled: retained terminal rows are included after classification/collapse.
- Header/status `done` and `error` count retained correlated real executions, not visible rows.
- `Σ` remains based on retained correlated real executions.
- TUI fallback to other sessions is allowed only when the current session has no visible rows and no retained correlated real executions; if fallback occurs, visible rows, retained counters, and `Σ` all use the other-session scope.

## Testing Strategy

| Layer | What to Test | Approach |
|-------|-------------|----------|
| Unit | Retained counters | `src/state.test.ts` helper tests for scoped correlated `running/done/error` counts. |
| Unit | Statusline aggregate vs details | `src/render.test.ts` fixed-time case where hidden terminals count but do not render as details. |
| Unit | TUI snapshot seam | `src/tui.test.ts` via `resolveTuiSubagentSnapshot()` for `1 run · 6 done · 7 err · Σ 13` with only running visible by default. |
| Integration | Regression safety | Run `pnpm test`; strict TDD applies before implementation. |
| E2E | Not applicable | Project config marks E2E unavailable. |

## Migration / Rollout

No migration required. Existing retained errored rows will stop appearing in default views once they are outside the terminal visibility window; they remain in history until normal terminal pruning removes them.

## Open Questions

None.
