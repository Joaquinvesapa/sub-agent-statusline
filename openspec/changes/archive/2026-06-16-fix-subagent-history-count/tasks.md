# Tasks: Fix Subagent History Count

## Review Workload Forecast

| Field | Value |
|-------|-------|
| Estimated changed lines | 400-650 |
| 400-line budget risk | High |
| Chained PRs recommended | Yes |
| Suggested split | PR 1 counter projection/tests → PR 2 TUI hydration/sidebar wiring |
| Delivery strategy | chained PRs (resolved) |
| Chain strategy | stacked-to-main |

Decision needed before apply: Yes
Chained PRs recommended: Yes
Chain strategy: stacked-to-main
400-line budget risk: High

### Suggested Work Units

| Unit | Goal | Likely PR | Notes |
|------|------|-----------|-------|
| 1 | Historical counter helper plus render usage | PR 1 | Base `main`; includes `src/state.ts`, `src/render.ts`, `src/state.test.ts`, `src/render.test.ts`. |
| 2 | Sidebar/session hydration wiring | PR 2 | Depends on PR 1; includes `src/tui.tsx`, `src/tui.test.ts`. |

## Phase 1: RED Tests

- [x] 1.1 Add failing `src/state.test.ts` cases for real session/subtask totals, `tool`/`Delegation:` exclusion, dedupe, and current-session scoping.
- [x] 1.2 Add failing `src/render.test.ts` case where stale hidden completed history increments `Σ` but not default visible `done`.
- [x] 1.3 Add failing `src/tui.test.ts` seam cases for `routeSessionID ?? ctx.session_id`, no-session skip, and no cross-session mixing.

## Phase 2: Counter Projection

- [x] 2.1 Add `countHistoricalSubagentExecutions()` in `src/state.ts`, reusing real-execution identity rules and excluding wrappers.
- [x] 2.2 Update `src/render.ts` `renderStatusLine()` so `Σ` uses historical real executions while run/done/error remain visible-row counts.
- [x] 2.3 Keep existing `totalExecuted` normalization compatible in `src/state.ts`; do not reinterpret persisted/global totals as sidebar session totals.
- [x] 2.4 Review fix: exclude legacy/source-missing `Delegation:` technical rows from historical totals and scope statusline render to the current parent session when retained state includes other sessions.
- [x] 2.5 Review fix: preserve `currentParentSessionID` across the TUI clone/persist/render seam so persisted statusline snapshots keep session-scoped counts.
- [x] 2.6 Review fix: keep generic child status/detail mutations from switching `currentParentSessionID` when old retained children finish or reconcile during background maintenance.
- [x] 2.7 Review fix: keep active `upsertRunningChild()` scope updates even when an unchanged retained child replays from another parent session.

## Phase 3: TUI Integration

- [x] 3.1 Update `src/tui.tsx` `SidebarSubagents` so own-session `Σ` counts all real current-session children, including hidden history.
- [x] 3.2 Remove unrelated-session fallback from sidebar counters; `done` stays based on visible completed rows only.
- [x] 3.3 Add/export a pure hydration-session resolver in `src/tui.tsx` and hydrate with route session or `ctx.session_id`, skipping when both are absent.

## Phase 4: Verification / Refactor

- [x] 4.1 Make the RED tests pass with focused fixtures only; avoid broad TUI/e2e automation.
- [x] 4.2 Run focused tests (`pnpm test -- src/state.test.ts src/render.test.ts`, which executed the full suite including `src/tui.test.ts`) and `pnpm typecheck`.
- [x] 4.3 Refactor names/comments for clarity without changing sidebar/statusline labels or layout.
- [x] 4.4 Follow-up review fix: exclude structurally identified `tool` wrapper rows from sidebar visible `running`/`done`/`error` counters while preserving row visibility and historical `Σ` semantics.
