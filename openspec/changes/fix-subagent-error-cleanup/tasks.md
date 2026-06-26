# Tasks: Fix Subagent Error Cleanup

## Review Workload Forecast

| Field | Value |
|-------|-------|
| Estimated changed lines | Addendum: 180-320; remaining total: 180-320 |
| 400-line budget risk | Medium |
| Chained PRs recommended | No |
| Suggested split | Single PR: addendum tests, retained counters, verification |
| Delivery strategy | ask-on-risk |
| Chain strategy | pending |

Decision needed before apply: No
Chained PRs recommended: No
Chain strategy: pending
400-line budget risk: Medium

### Suggested Work Units

| Unit | Goal | Likely PR | Notes |
|------|------|-----------|-------|
| 1 | Completed: hide stale/unrelated terminal rows while preserving history access | PR 1 | Already checked |
| 2 | Add retained terminal `done`/`err` counters independent of default row visibility | PR 1 | Strict TDD; no broad refactors |

## Phase 1: RED Regression Tests

- [x] 1.1 In `src/render.test.ts`, add failing tests for stale `error` hidden, recent `error` visible, and stale `done` parity.
- [x] 1.2 In `src/render.test.ts`, add failing test: `running` child stays visible while stale `error` remains hidden.
- [x] 1.3 In `src/render.test.ts`, add failing history-mode test where stale `done` and `error` reappear with `showCompletedHistory`.
- [x] 1.4 In `src/tui.test.ts`, add failing snapshot/counter tests: stale hidden error excluded from visible `err`, included in `Σ`, visible with history.
- [x] 1.5 In `src/state.test.ts`, add old-`error` terminal pruning regression; if it already passes, record it as existing behavior evidence.

## Phase 2: GREEN Implementation

- [x] 2.1 In `src/render.ts`, make `isVisibleWorkItem()` apply the terminal recency window to both `done` and `error` using `endedAt ?? updatedAt`.
- [x] 2.2 In `src/render.ts`, update `visibleSubagentWorkItems()` active-running filtering so stale `error` rows are not re-admitted.
- [x] 2.3 In `src/tui.tsx`, modify only if RED tests expose coupling; keep `resolveTuiSubagentSnapshot()` consuming corrected visible rows.

## Phase 3: REFACTOR / Verification

- [x] 3.1 In `src/render.ts`, rename terminal-visibility helpers/constants if useful; do not change public API or history-toggle names.
- [x] 3.2 Run `pnpm test -- src/render.test.ts src/tui.test.ts src/state.test.ts` and capture evidence.
- [x] 3.3 Run `pnpm test` and `pnpm typecheck`; mark tasks complete only after both pass or document blockers.

## Phase 4: Correction After Invalid Verify

- [x] 4.1 In `src/render.ts`, ensure active-running filtering keeps only `running` rows unconditionally; terminal `done` and `error` rows must match active running `messageID`s, with regressions in `src/render.test.ts` and `src/tui.test.ts`.

## Phase 5: Addendum RED Tests — Retained Terminal Counters

- [x] 5.1 In `src/render.test.ts`, add failing test for spec scenario “Running header counts retained terminal history”: default rows show `1 run`; header shows retained `6 done · 7 err · Σ 13`.
- [x] 5.2 In `src/tui.test.ts`, add failing `resolveTuiSubagentSnapshot()`/snapshot test: default list hides retained terminal rows, counters show retained `done`/`err`, and `Σ` remains total retained count.
- [x] 5.3 In `src/render.test.ts` or `src/tui.test.ts`, add failing history-toggle test proving hidden terminal `done`/`error` rows reappear while `Σ`, `done`, and `err` totals stay unchanged.
- [x] 5.4 In `src/state.test.ts`, add failing helper test for retained scoped real-execution status counts, including hidden terminal `done` and `error` rows.

## Phase 6: Addendum GREEN Implementation

- [x] 6.1 In `src/state.ts`, add/export retained terminal status count helper near `countHistoricalSubagentExecutions()`, using existing correlation/scoping semantics.
- [x] 6.2 In `src/render.ts`, update `renderStatusLine()` to use retained `done`/`err` counts for header/status while details still use `visibleSubagentWorkItems()`.
- [x] 6.3 In `src/tui.tsx`, update `resolveTuiSubagentSnapshot()`/TUI counters to use retained status counts while keeping row visibility filtered.

## Phase 7: Addendum REFACTOR / Verification

- [x] 7.1 Keep naming local and minimal; avoid broad refactors or public API renames.
- [x] 7.2 Run `pnpm test -- src/state.test.ts src/render.test.ts src/tui.test.ts`; then run `pnpm test` and `pnpm typecheck`, recording evidence.

## Phase 8: Pre-commit Review Blocker Correction — TUI Scope Consistency

- [x] 8.1 In `src/tui.test.ts`, add failing regressions proving current-session hidden retained terminal history blocks other-session fallback and allowed fallback keeps rows, retained counters, and `Σ` in one scope.
- [x] 8.2 In `src/tui.tsx`, update `resolveTuiSubagentSnapshot()` so fallback depends on both current-session visibility and current-session retained/historical execution presence.
- [x] 8.3 Update spec/design with the TUI snapshot scope invariant, keep the code change minimal, and run focused/full verification commands.
