# Design: Fix Subagent History Count

## Technical Approach

Separate historical identity counting from visible-row rendering. `visibleSubagentWorkItems()` will continue to decide which rows are shown by default and therefore what `done` means. A new state/render counter projection will compute `Σ` from all current-session real subagent executions, including collapsed or stale completed rows, while excluding technical wrappers (`source: "tool"`, `Delegation:` titles). Sidebar hydration will use the rendered sidebar session (`ctx.session_id`) when the route session is absent, without falling back to unrelated sessions.

## Architecture Decisions

| Decision | Choice | Alternatives considered | Rationale |
|---|---|---|---|
| Counter source | Add a centralized historical counter helper near state/render boundaries and use it from `SidebarSubagents` and statusline rendering where session context exists. | Reinterpret `visibleSubagentWorkItems()` as historical, or keep using raw `state.totalExecuted`. | Visibility and historical identity are different concepts; `totalExecuted` is persisted/global and can be stale or cross-session. |
| Wrapper filtering | Keep explicit source/type discrimination: exclude `source: "tool"` and `Delegation:` real-session titles; count real `session` rows and `subtask` fallbacks by one deduped identity. | Filter by elapsed time, duration, or UI title only. | Project rules prefer explicit discrimination; timing filters would reintroduce wrapper bugs. |
| Session source | Track the sidebar context session and hydrate with `routeSessionID ?? ctx.session_id`; if neither exists, do not hydrate or mix sessions. | Poll all sessions, or keep route-only hydration. | Fixes missing route hydration while preserving current-session isolation. |

## Data Flow

```
OpenCode events/API hydration
  -> applySubagentEvent()/state children
  -> historicalCounter(children, currentSessionID) -> Σ
  -> visibleSubagentWorkItems(currentSession children) -> run/done/error + rows
```

## File Changes

| File | Action | Description |
|------|--------|-------------|
| `src/state.ts` | Modify | Export/reuse real-execution identity logic for historical counting; dedupe by target/session identity and exclude tools/technical delegation rows. |
| `src/render.ts` | Modify | Use the counter projection in `renderStatusLine` where applicable; keep `done` based on visible work items. |
| `src/tui.tsx` | Modify | Compute sidebar `Σ` from all current-session children, keep `done` from visible rows, remove counter fallback to unrelated sessions, and hydrate using route or sidebar context session. |
| `src/state.test.ts` | Modify | Cover historical real-session/subtask counts, wrapper exclusion, `Delegation:` exclusion, and dedupe. |
| `src/render.test.ts` | Modify | Cover stale hidden completed rows contributing to `Σ` while excluded from default `done`. |
| `src/tui.test.ts` | Modify | Add pure seam tests for route/context session selection and no-session no-mixing behavior. |

## Interfaces / Contracts

```ts
type SubagentCounterSnapshot = {
  running: number;
  done: number; // visible completed rows only
  error: number;
  total: number; // all real current-session historical executions
};

function countHistoricalSubagentExecutions(input: {
  children: ChildSessionState[];
  parentSessionID?: string;
}): number;
```

The helper MUST treat `parentSessionID` as required for sidebar/session-scoped totals. Without it, callers may only count an explicitly supplied, already-scoped child array.

## Testing Strategy

| Layer | What to Test | Approach |
|-------|-------------|----------|
| Unit | Real historical count, wrapper exclusion, dedupe | Add `state.test.ts` cases around session/subtask/tool/`Delegation:` children. |
| Unit | `Σ` vs visible `done` semantics | Add `render.test.ts` cases with stale completed history and default visibility. |
| Integration seam | Hydration session fallback | Add `tui.test.ts` pure helper tests for `routeSessionID ?? ctx.session_id` and missing-session behavior. |

## Migration / Rollout

No migration required. Existing persisted state is read as-is; counters are derived from current scoped children at render time, with existing normalization preserved for compatibility.

## Open Questions

None.
