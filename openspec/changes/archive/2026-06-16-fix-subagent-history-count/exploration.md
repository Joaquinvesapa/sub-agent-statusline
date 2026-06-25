## Exploration: fix-subagent-history-count

### Current State
The TUI keeps an in-memory `StatuslineState` initialized with `createEmptyState()` and updates it from live OpenCode events plus `hydratePreviousSubagents()` for the current route session. The sidebar header counters in `SidebarSubagents` are computed from `visibleChildren()`, which filters `state.children` through `visibleSubagentWorkItems()` with `showCompletedHistory` disabled by default. That default hides completed rows older than 10 minutes, and when active work exists it only keeps done rows correlated to active message IDs. Clicking/toggling the `Σ` history control sets `showCompletedHistory` to true, so the same hydrated children become visible even when they are stale history.

The `Σ` number is not derived from the rendered history rows; it reads `props.state().totalExecuted`. `totalExecuted` is maintained by `countChildExecution()` when children are first upserted. Real session children count unless their title matches the technical `Delegation:` prefix; `tool` wrappers never count; `subtask` fallbacks count unless later rekeyed to a real target session. This creates a likely mismatch: completed historical rows can exist in `state.children` and appear when completed history is toggled, while the collapsed/header view still shows `0 done` because stale done rows are intentionally hidden, and `Σ 0` when those rows were hydrated as uncounted tool wrappers or technical `Delegation:` sessions.

Hydration itself is asynchronous and only keyed from `resolveRouteSessionID(api)`. Rendering uses `ctx.session_id ?? routeSessionID`, so there is also a possible route/context mismatch where the sidebar has a session ID to render but hydration does not run until the route exposes one. In addition, sessions are marked hydrated after one successful empty/partial API response, so early empty children/messages responses can suppress later retries.

### Affected Areas
- `src/tui.tsx` — `SidebarSubagents` computes collapsed/header counts from `visibleChildren()` and toggles completed history; `initializeTui()` controls route-based hydration and retry caching; `hydratePreviousSubagents()` backfills historical children.
- `src/render.ts` — `visibleSubagentWorkItems()` hides stale completed items unless `showCompletedHistory` is true; `renderStatusLine()` uses the same visible-filtered counts but `state.totalExecuted` for `Σ`.
- `src/state.ts` — `countChildExecution()`, `resolveExecutionCountIdentity()`, `loadState()`, and counter normalization define which hydrated records contribute to `totalExecuted`.
- `src/events.ts` — event extraction decides whether records are `session`, `subtask`, or `tool`, and technical `Delegation:` titles are treated specially.
- `src/render.test.ts` — already covers stale done visibility and completed-history behavior; needs regression coverage for header aggregate semantics versus history rows.
- `src/state.test.ts` / `src/events.test.ts` — existing counter tests cover uncounted tools, real sessions, subtasks, and rekeying; likely need cases for hydrated historical `Delegation:`/tool-only rows that appear in history.
- `src/tui.test.ts` or new TUI seam tests — likely place to cover route/context hydration trigger and `showCompletedHistory` toggle behavior if a test seam is added.

### Approaches
1. **Derive header aggregate from all collapsed work items, not only default-visible rows** — Keep the row list collapsed by default, but compute header `done/error/run` or at least `Σ` from a separate all-history projection.
   - Pros: Aligns header counters with the history users can reveal; small localized change in `SidebarSubagents`/`renderStatusLine` semantics.
   - Cons: Changes current meaning of `done` from “currently visible/recent” to “historical”; could make collapsed header noisier unless labels are clarified.
   - Effort: Medium

2. **Repair execution counting during hydration** — Ensure every history-visible real subagent execution contributes to `totalExecuted`, including rows represented by technical `Delegation:` sessions only when they are the actual historical item, while still excluding pure call wrappers.
   - Pros: Directly fixes `Σ 0` without changing visible-list recency rules; preserves separation between wrapper artifacts and real executions.
   - Cons: Needs careful source/type discrimination to avoid regressing the earlier call-counting fix that intentionally excludes tool wrappers and technical delegation placeholders.
   - Effort: Medium

3. **Broaden hydration trigger and retry reconciliation** — Hydrate using the sidebar `ctx.session_id` as well as route session ID, and avoid marking a session permanently hydrated after an empty/partial response that may race OpenCode state availability.
   - Pros: Addresses timing/session mismatch where state is empty until a user interaction or route change; improves robustness for never-closed long sessions.
   - Cons: Does not by itself fix rows that are present but uncounted; requires TUI test seams/mocks around API route and slot context.
   - Effort: Medium/High

### Recommendation
Treat this as two related bugs with one user symptom. First, specify the desired counter semantics: the collapsed header should not show `Σ 0` when completed history contains real subagent executions for the same session. Then implement a narrow fix that (a) computes `Σ` from the same collapsed historical work-item identity set when persisted counters are missing/stale, or repairs `totalExecuted` during hydration for history-visible real executions, and (b) uses `ctx.session_id` as a hydration candidate so sidebar rendering and hydration share the same session scope. Preserve the existing rule that pure `tool` wrappers are not counted.

### Risks
- Counting technical `Delegation:` rows naively can reintroduce the previous bug where zero-second call/wrapper artifacts were counted as executed subagents.
- Changing `done` header semantics may surprise users if the header starts counting old completed rows while the collapsed list remains hidden.
- Hydration retries can become noisy or expensive if children/messages APIs are polled too aggressively for long sessions.
- Route/session fallback logic must avoid mixing “other sessions” history into the current session total.

### Ready for Proposal
Yes — propose a bug fix that defines header `Σ` as real historical executions available for the current sidebar session, keeps default rows collapsed/recent-only, and adds hydration reconciliation for route/context session mismatch plus missing execution counters.
