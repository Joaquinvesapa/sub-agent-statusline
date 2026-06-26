## Exploration: fix-subagent-error-cleanup

### Current State
Subagent lifecycle state is stored in `StatuslineState.children` as `running`, `done`, or `error`. Real executions are classified by `source: "session"` or `ses_*` IDs, while tool/subtask wrappers without trusted targets are excluded by `classifySubagentWorkItem()` and `collapseSubagentWorkItems()`.

Terminal cleanup already exists in `pruneTerminalChildren()`: any non-running child, including `error`, is removed from tracked state after `TERMINAL_CHILD_TTL_MS` (3 days) or when the terminal-child cap is exceeded. This cleanup is invoked through `refreshDerivedFields()` during `loadState()`, `saveState()`, TUI ticks, event handling, and hydration persistence.

The visible-list behavior is asymmetric. `isVisibleWorkItem()` only applies the 10-minute recent-history window to `done`; every non-`done` child returns visible, so errored real sessions remain visible in the sidebar, home-bottom status, and statusline render for as long as they remain in `state.children`. During active work, `visibleSubagentWorkItems()` explicitly keeps `error` rows (`running || error`) while filtering unrelated `done` rows. That matches the reported behavior where errored subagents keep displaying while other agents run and continue showing after active work ends. Existing tests cover stale `done` hiding and old terminal pruning, but there is no regression test proving stale `error` rows age out of the default visible list.

Targeted lifecycle-related tests were checked with `pnpm test -- src/render.test.ts src/state.test.ts src/tui.test.ts`; Vitest ran the suite and passed 111 tests. The current passing tests encode the existing done-only recency behavior but do not cover error visibility cleanup.

### Affected Areas
- `src/render.ts` — `isVisibleWorkItem()` and `visibleSubagentWorkItems()` define default row visibility; currently only stale `done` rows are hidden and `error` rows remain visible whenever present.
- `src/tui.tsx` — `resolveTuiSubagentSnapshot()`, `SidebarSubagents`, and `HomeBottomStatus` consume `visibleSubagentWorkItems()` for visible rows/counts; home-bottom remains visible when `counts().error > 0`.
- `src/state.ts` — `pruneTerminalChildren()` already prunes old non-running state after 3 days, and `refreshDerivedFields()` triggers it; likely no storage cleanup rewrite is needed unless the desired TTL changes.
- `src/events.ts` — `session.error`, terminal `session.status`, and errored task/tool evidence call `markChildStatus(..., "error")`, setting `endedAt`/`updatedAt` for cleanup and elapsed timing.
- `src/render.test.ts` — has stale `done` and active-work filtering coverage; needs stale/recent `error` default visibility tests and active-work behavior tests.
- `src/tui.test.ts` — snapshot tests should cover errored rows aging out of default visible counts while remaining in historical `Σ` if retained.
- `src/state.test.ts` — already covers old terminal pruning for `done`; should add or extend coverage to prove old `error` children are pruned from tracked state by terminal cleanup.

### Approaches
1. **Treat errors as terminal for default visibility** — Change row visibility so both `done` and `error` use the same recent-terminal window unless completed history is enabled.
   - Pros: Small, localized fix; matches current terminal-state cleanup model; directly stops errored rows from staying visible indefinitely in normal UI.
   - Cons: The existing toggle is named completed history, so showing old errors through it may need wording/spec clarification.
   - Effort: Low

2. **Add an error-specific visible TTL** — Keep `done` at 10 minutes but introduce a separate recent-error window such as `RECENT_ERROR_VISIBLE_MS`.
   - Pros: Allows errors to stay visible longer than successful completions if desired; preserves explicit UX distinction.
   - Cons: Adds configuration/semantic complexity without an existing product rule; still needs history-toggle semantics for old errors.
   - Effort: Medium

3. **Shorten or specialize tracked-state pruning for errors** — Remove errored children from `state.children` earlier than other terminal children.
   - Pros: Reduces persisted/in-memory state sooner.
   - Cons: Conflates UI visibility with history retention; can erase evidence needed for `Σ`, history, navigation, or debugging; risks changing persisted counter behavior unnecessarily.
   - Effort: Medium

### Recommendation
Use approach 1. Keep `error` as a terminal lifecycle status and make default visibility treat stale `error` rows like stale `done` rows: recent terminal rows remain visible briefly, history mode can reveal retained terminal history, and `pruneTerminalChildren()` continues to remove old terminal rows from tracked state after the existing 3-day TTL/cap. This fixes the user-visible permanence without weakening the historical counter/classification model established by the recent subagent-history changes.

The proposal/spec should define whether the existing completed-history toggle is renamed conceptually to terminal-history, or whether it may continue to reveal both completed and errored terminal rows under the current UI label.

### Risks
- Hiding stale errors too aggressively could make failures less discoverable if users expect error evidence to remain visible until manual acknowledgement.
- If `endedAt` is missing or invalid on an errored child, visibility and pruning depend on `updatedAt`; tests should cover this fallback.
- Changing visible error counts changes `HomeBottomStatus` visibility because it currently stays mounted when `counts().error > 0`.
- History-toggle semantics may be confusing if a control labeled completed history also reveals errored history.

### Ready for Proposal
Yes — propose a focused bug fix that treats `error` as terminal for default visibility, keeps historical `Σ` and terminal state retention intact, and adds regression tests for stale error rows in `render`, `tui` snapshots, and terminal state pruning.
