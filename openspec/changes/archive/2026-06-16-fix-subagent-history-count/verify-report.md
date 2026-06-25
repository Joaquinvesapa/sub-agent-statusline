# Verify Report: fix-subagent-history-count

## Verification Report

**Change**: fix-subagent-history-count
**Version**: N/A
**Mode**: Standard verification for this SDD cycle; Strict TDD config drift remains (`openspec/config.yaml` has `testing.strict_tdd: true` and `sdd.strict_tdd: true`, while the launch instruction says this verification cycle is Standard Mode).

### Completeness

| Metric | Value |
|--------|-------|
| Tasks total | 17 |
| Tasks complete | 17 |
| Tasks incomplete | 0 |
| Proposal/spec/design/tasks present | Yes |
| Prior verify report reviewed | Yes |
| Required source inspection completed | Yes |

### Build & Tests Execution

**Focused tests**: ✅ Passed

```text
pnpm test -- src/tui.test.ts src/state.test.ts src/render.test.ts src/events.test.ts
Test Files: 7 passed (7)
Tests: 120 passed (120)
```

**Typecheck**: ✅ Passed

```text
pnpm typecheck
tsc --noEmit -p tsconfig.json
```

**Full tests**: ✅ Passed

```text
pnpm test
Test Files: 7 passed (7)
Tests: 120 passed (120)
```

**Build**: ✅ Passed

```text
pnpm build
tsup
ESM Build success: dist/index.js, dist/tui.js
DTS Build success: dist/index.d.ts, dist/tui.d.ts
```

**Coverage**: ✅ Passed runtime suite with coverage; no threshold configured.

```text
pnpm test:coverage
Test Files: 7 passed (7)
Tests: 120 passed (120)
All files: 89.76% lines, 85.77% statements, 76.55% branches, 93.4% funcs
Changed covered files: src/state.ts 90.06% lines, src/render.ts 91.30% lines, src/events.ts 85.49% lines
Note: vitest.config.ts excludes src/tui.tsx from coverage collection.
```

**Diff check**: ✅ Passed

```text
git diff --check
(no output)
```

### Worktree Scope Check

| Check | Result | Details |
|-------|--------|---------|
| Unrelated untracked files | ✅ Untouched | `api-audit-scout.md` and `bun.lock` remain untracked and were not modified by verification. |
| Change files present | ✅ Yes | Source/test changes plus `openspec/changes/fix-subagent-history-count/*`. |

### TDD / Mode Drift

| Check | Result | Details |
|-------|--------|---------|
| Config strict TDD | ⚠️ Drift | `openspec/config.yaml` has `testing.strict_tdd: true` and `sdd.strict_tdd: true`. |
| Cycle mode from launch status | ✅ Standard | Launch instruction says this cycle used Standard Mode with known Strict TDD config drift. |
| Strict TDD module | ✅ Skipped | Standard Mode was authoritative for this verification, so strict TDD checks were not applied. |
| Apply TDD evidence | ⚠️ Not evaluated | No Strict TDD apply-progress artifact was required for this Standard Mode verify. |

### Test Layer Distribution

| Layer | Tests | Files | Tools |
|-------|-------|-------|-------|
| Unit / pure seam | 117 | `src/*.test.ts`, including `src/state.test.ts`, `src/render.test.ts`, `src/tui.test.ts`, and `src/events.test.ts` relevant cases | Vitest |
| Integration | 3 | `test/index.integration.test.ts` | Vitest |
| E2E | 0 | — | Not configured |
| **Total executed** | **120** | **7 files** | Vitest |

### Spec Compliance Matrix

| Requirement | Scenario | Runtime evidence | Result |
|-------------|----------|------------------|--------|
| Historical total counter | Hidden completed history contributes to total | `src/render.test.ts > counts hidden completed history in total without changing visible done`; `src/tui.test.ts > counts hidden current-session history in total without changing visible done` | ✅ COMPLIANT |
| Historical total counter | History toggle does not redefine total | `src/render.test.ts > shows stale done items when completed history is enabled`; `src/state.test.ts > counts historical real executions without wrappers or cross-session rows`; source inspection confirms `Σ` comes from `countHistoricalSubagentExecutions()` rather than visible-row length | ✅ COMPLIANT |
| Visible completed counter | Hidden completed rows do not contribute to done | `src/tui.test.ts > counts hidden current-session history in total without changing visible done`; `src/render.test.ts > counts hidden completed history in total without changing visible done` | ✅ COMPLIANT |
| Visible completed counter | Visible completed history contributes to done | `src/render.test.ts > shows stale done items when completed history is enabled`; `resolveSidebarSubagentSnapshot()` and `resolveHomeBottomStatusSnapshot()` count `done` from `visibleSubagentWorkItems()` after visibility filtering | ✅ COMPLIANT |
| Wrapper row exclusion | Delegation wrapper is excluded from historical totals | `src/state.test.ts > counts historical real executions without wrappers or cross-session rows`; `src/events.test.ts > persists delegate tool kind without relying on display title` | ✅ COMPLIANT |
| Wrapper row exclusion | Tool-only wrapper is excluded from historical totals | `src/state.test.ts > upserts tool wrappers without counting them and marks terminal statuses`; `src/state.test.ts > keeps non-zero-duration tool wrappers uncounted`; historical wrapper tests | ✅ COMPLIANT |
| Visible task proxy eligibility | `toolName: "task"` increments visible counters but not `Σ` | `src/tui.test.ts > counts visible running and done task tool proxies in sidebar counters`; `src/render.test.ts > counts visible task tool proxies in aggregate visible counters` | ✅ COMPLIANT |
| Visible delegate exclusion | `toolName: "delegate"` does not increment visible counters | `src/state.test.ts > counts only task tool proxies in visible counters`; `src/render.test.ts > counts visible task tool proxies in aggregate visible counters` includes delegate exclusion | ✅ COMPLIANT |
| Legacy structural proxy eligibility | Legacy `source: "tool"` / `tool:` rows count only with `agentName` or `targetSessionID` | `src/state.test.ts > counts only task tool proxies in visible counters`; `src/tui.test.ts > counts visible legacy task proxies with agent metadata in sidebar counters`; `src/tui.test.ts > keeps visible tool wrappers out of sidebar visible counters`; home-bottom and render equivalents | ✅ COMPLIANT |
| Consistent sidebar/statusline/home-bottom counters | All UI projections share visible eligibility and session scoping | `src/render.test.ts > keeps/counts visible wrappers/task proxies`; `src/tui.test.ts > sidebar` and `resolveHomeBottomStatusSnapshot` cases; source inspection confirms shared `isVisibleSubagentCounterEligible()` usage | ✅ COMPLIANT |
| Current-session hydration source | Context session fallback hydrates history | `src/tui.test.ts > falls back to the sidebar context session when the route is absent`; source inspection confirms hydration effect uses `resolveHydrationSessionID({ routeSessionID, contextSessionID })` | ✅ COMPLIANT |
| Current-session hydration source | Session isolation is preserved | `src/tui.test.ts > does not fall back to unrelated-session rows or counts`; `src/render.test.ts > renders only the current parent session when retained state has other sessions`; `src/tui.test.ts > does not count visible retained children from another parent session` | ✅ COMPLIANT |
| Current-session hydration source | No session source is available | `src/tui.test.ts > skips hydration when no route or context session exists`; source inspection confirms hydrate effect returns when no resolved session exists | ✅ COMPLIANT |

**Compliance summary**: 13/13 verified behaviors compliant, 0 failing.

### Correctness (Static Evidence)

| Requirement | Status | Notes |
|------------|--------|-------|
| `Σ` counts real historical current-session subagents | ✅ Implemented | `countHistoricalSubagentExecutions()` scopes by `parentSessionID`, dedupes real sessions/subtask fallbacks, excludes technical wrappers, and is used by statusline, sidebar, and home-bottom projections. |
| Visible `running/done/error` remain visible-only | ✅ Implemented | Sidebar/statusline/home-bottom counters are derived from `visibleSubagentWorkItems()` outputs after shared eligibility filtering. |
| `toolName: "task"` visible proxy counting | ✅ Implemented | `isTaskToolProxy()` returns true for structural task-tool wrappers, allowing visible `running/done/error` counters to reflect visible task proxies. |
| `toolName: "delegate"` visible proxy exclusion | ✅ Implemented | `isTaskToolProxy()` returns false for delegate wrappers even when they remain visible as rows. |
| Legacy structural task proxy counting | ✅ Implemented | Legacy synthetic tool rows without `toolName` count only when `agentName` or `targetSessionID` is present. |
| Legacy pure wrapper exclusion | ✅ Implemented | Source/id-only tool rows without `toolName`, `agentName`, or `targetSessionID` remain visible but do not increment visible counters. |
| Historical wrapper exclusion | ✅ Implemented | Historical totals exclude `source: "tool"`, legacy `tool:` IDs, and technical `Delegation:` rows. |
| Home-bottom `Σ` avoids inflated `state.totalExecuted` | ✅ Implemented | `resolveHomeBottomStatusSnapshot()` computes `totalExecuted` with `countHistoricalSubagentExecutions()` rather than persisted/global `state.totalExecuted`. |
| Sidebar own-session counters | ✅ Implemented | `resolveSidebarSubagentSnapshot()` filters by `sessionID` and no longer falls back to unrelated sessions or `state.totalExecuted`. |
| Statusline render session scoping | ✅ Implemented | `renderStatusLine()` filters retained children by `currentParentSessionID` when scope is known. |
| Hydration source fallback | ✅ Implemented | `resolveHydrationSessionID()` resolves `routeSessionID ?? ctx.session_id`; hydrate effect skips when both are absent. |
| Active render scope preservation | ✅ Implemented | `cloneState()` preserves `currentParentSessionID`; generic retained-child mutations avoid switching render scope; active `upsertRunningChild()` keeps scope aligned. |

### Coherence (Design)

| Decision | Followed? | Notes |
|----------|-----------|-------|
| Separate historical counter from visible rendering | ✅ Yes | Historical `Σ` is computed separately from `visibleSubagentWorkItems()`; visible counters remain based on rows that are actually visible and eligible. |
| Explicit wrapper filtering | ✅ Yes | Visible-counter filtering is structural (`source`, `id`, `toolName`, `agentName`, `targetSessionID`) and not title-based; historical filtering still protects against technical `Delegation:` records. |
| Session source and isolation | ✅ Yes | Hydration and counter projections use route/context session resolution and scoped child sets. |
| Do not use global/persisted total for UI `Σ` | ✅ Yes | Sidebar and home-bottom no longer read `state.totalExecuted` for displayed `Σ`; statusline recomputes from scoped children. |

### Issues Found

**CRITICAL**: None.

**WARNING**:
- Strict TDD mode drift remains: current `openspec/config.yaml` enables strict TDD, but this verify cycle was explicitly launched in Standard Mode.
- `src/tui.tsx` is excluded from coverage collection by `vitest.config.ts`, so TUI wiring coverage is represented through seam tests but not coverage percentages.

**SUGGESTION**:
- Consider adding coverage collection for selected `src/tui.tsx` pure seams if coverage reporting for TUI wiring becomes important.

### Verdict

PASS WITH WARNINGS

Runtime verification passed across focused tests, typecheck, full tests, build, coverage execution, and diff check. The follow-up fixes address visible `task` proxy counting structurally while excluding `delegate` and pure wrapper rows, preserving current-session historical `Σ`, visible-only counters, and route/context hydration semantics. Remaining warnings are process/config and coverage-reporting drift, not observed functional failures.
