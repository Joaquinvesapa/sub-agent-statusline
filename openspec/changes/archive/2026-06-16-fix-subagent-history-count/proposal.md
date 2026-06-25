# Proposal: Fix Subagent History Count

## Intent

Fix sidebar/statusline counters so the collapsed header reflects real current-session subagent history honestly. Today hydrated completed rows can appear after toggling `Σ` while the header still reports `Σ 0` or `0 done`, because stale rows are hidden by default, some hydrated rows are wrapper artifacts, and hydration may miss the sidebar session when the route session is unavailable.

## Scope

### In Scope
- Define `Σ` as all real historical subagents in the current session, including collapsed/default-hidden rows.
- Keep `done` scoped to visible completed rows only.
- Exclude technical wrapper rows titled like `Delegation: ...` from real subagent counts.
- Allow sidebar hydration to use `ctx.session_id` when the route session is unclear or missing.
- Add regression coverage for historical counts, wrapper exclusion, and session fallback hydration.

### Out of Scope
- Redesigning the sidebar/statusline layout or labels.
- Counting tool/call wrappers as subagent executions.
- Broad polling or cross-session history aggregation.

## Capabilities

### New Capabilities
- `subagent-history-counters`: Defines sidebar/statusline counter semantics for historical versus visible subagent rows, real-run identity, wrapper exclusion, and current-session hydration.

### Modified Capabilities
None.

## Approach

Use a separate current-session “real subagent history” projection for `Σ`, independent from the default visible-row filter. Preserve existing visible-list behavior for rows and `done`. Reconcile hydration so `ctx.session_id` can seed historical children when route session ID is absent, while keeping session isolation and excluding `Delegation:`/tool wrappers.

## Affected Areas

| Area | Impact | Description |
|------|--------|-------------|
| `src/tui.tsx` | Modified | Sidebar counters, history toggle, hydration session source. |
| `src/render.ts` | Modified | Counter projection versus visible row filtering. |
| `src/state.ts` | Modified | Execution identity/count normalization for hydrated history. |
| `src/events.ts` | Modified | Preserve wrapper versus real subagent discrimination if needed. |
| `src/*.test.ts`, `test/**/*.test.ts` | Modified | Regression coverage for confirmed semantics. |

## Risks

| Risk | Likelihood | Mitigation |
|------|------------|------------|
| Wrapper rows get counted again | Medium | Test `Delegation:` and tool-only rows as excluded. |
| Session fallback mixes histories | Medium | Require current-session scoping in hydration tests. |
| `done` semantics regress | Low | Assert `done` counts visible completed rows only. |

## Rollback Plan

Revert the counter/hydration changes and their tests from this change folder's implementation commit; no persisted data migration is required.

## Dependencies

- Existing OpenCode session, child-message, and sidebar context APIs.

## Success Criteria

- [ ] `Σ` counts all real historical subagents for the current session, including collapsed rows.
- [ ] `done` counts only visible completed rows.
- [ ] `Delegation:` wrapper rows do not increase real subagent counts.
- [ ] Sidebar hydration works when only `ctx.session_id` is available.
