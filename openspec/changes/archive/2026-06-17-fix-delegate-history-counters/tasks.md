# Tasks: Fix Delegate History Counters

## Review Workload Forecast

| Field | Value |
|-------|-------|
| Estimated changed lines | 450-650 |
| 400-line budget risk | High |
| Chained PRs recommended | Yes |
| Suggested split | PR 1 classifier/tests → PR 2 render/state counters → PR 3 TUI/events seams |
| Delivery strategy | ask-on-risk |
| Chain strategy | feature-branch-chain |

Decision needed before apply: Yes
Chained PRs recommended: Yes
Chain strategy: feature-branch-chain
400-line budget risk: High

### Suggested Work Units

| Unit | Goal | Likely PR | Notes |
|------|------|-----------|-------|
| 1 | Add pure classification model with focused tests | PR 1 | Base main/tracker; no UI wiring |
| 2 | Route render/state counters through classifier | PR 2 | Depends on PR 1; includes visible/history tests |
| 3 | Prove TUI/event seams agree | PR 3 | Depends on PR 2; includes snapshot and field-preservation tests |

## Phase 1: RED Tests

- [x] 1.1 Create `src/subagent-classification.test.ts` covering real `Delegation:` sessions, targetless delegate/task/subtask wrappers, trusted `targetSessionID`, and ambiguous same-parent fail-closed.
- [x] 1.2 Update `src/render.test.ts` so wrappers are hidden before real-session evidence, completed history shows only real executions, and proxy+session emits one canonical `ses_*` row.
- [x] 1.3a Update `src/state.test.ts` so `Σ`, `running`, `done`, and `err` count only classified real executions per spec scenarios.
- [x] 1.3b Update `src/tui.test.ts` so TUI sidebar/home seams agree with render/state classified counters. _(PR 3)_
- [x] 1.4 Add classifier regression coverage for trusted proxies whose `targetSessionID` real session is missing from candidates. _(PR 2 corrective fix)_

## Phase 2: Classifier Foundation

- [x] 2.1 Create `src/subagent-classification.ts` with `SubagentWorkClassification`, `isRealSessionID()`, trusted target helpers, and `classifySubagentWorkItem()`.
- [x] 2.2 Add classifier correlation helpers for trusted target, shared message id, and unique same-parent match; return wrapper/ambiguous cases as hidden/uncountable.
- [x] 2.3 Add metadata merge helper that preserves real `id`, `source: "session"`, status, timing, tokens, and navigation target while accepting safe proxy display metadata.
- [x] 2.4 Prevent trusted-target proxies from falling back to message-id or same-parent correlation when the trusted real target is absent. _(PR 2 corrective fix)_

## Phase 3: Core Wiring

- [x] 3.1 Modify `src/render.ts` `collapseSubagentWorkItems()` and `visibleSubagentWorkItems()` to emit only canonical real execution rows and drop invocation wrappers.
- [x] 3.2 Modify `src/state.ts` `isVisibleSubagentCounterEligible()` and `countHistoricalSubagentExecutions()` to count unique real execution IDs; remove targetless subtask fallback and title-based exclusion.
- [x] 3.3 Modify `src/tui.tsx` sidebar/home snapshot seams to consume the same classified rows and keep hydration target backfill unique/fail-closed.
- [x] 3.4 Review `src/events.ts` to preserve `source`, `toolName`, `id`, `parentID`, `messageID`, and sanitized `targetSessionID` without adding title-based classification.

## Phase 4: Verification

- [x] 4.1 Update `src/events.test.ts` for delegate `toolName`, task targets, and real `session.created` rows titled `Delegation:`.
- [x] 4.2a Run PR 2 verification: focused render/state/classifier tests, `pnpm test`, and `pnpm typecheck`; record evidence for `sdd-verify`.
- [x] 4.2c Run PR 2 corrective verification: focused classifier/render/state tests and `pnpm typecheck`; record evidence for `sdd-verify`. _(PR 2 corrective fix)_
- [x] 4.2b Run final full-change verification including `pnpm build` after PR 3 seams are complete.
