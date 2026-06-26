# Design: Fix Delegate History Counters

## Technical Approach

Add one pure classification layer and route render visibility, sidebar/home counters, statusline counters, and historical `Σ` through it. The classifier treats only `source: "session"` or `id: "ses_*"` as real executions. `tool`/`subtask` rows are proxies only when they carry a trusted `targetSessionID: "ses_*"`; otherwise they are invocation wrappers. Wrappers are never emitted or counted, and proxies only enrich or correlate to a real session identity.

## Architecture Decisions

| Decision | Choice | Alternatives considered | Rationale |
|---|---|---|---|
| Classification ownership | Create `src/subagent-classification.ts` with pure helpers used by `state.ts`, `render.ts`, and `tui.tsx`. | Keep helpers split across state/render; classify in events. | Prevents drift between visible rows and counters without coupling event ingestion to partial OpenCode payload order. |
| Canonical identity | Canonical execution identity is the real session id (`ses_*`). | Keep synthetic row id and attach `targetSessionID`. | User-confirmed wrappers are not executions; rows/counters must show/count only real subagents. |
| Correlation | Accept trusted target session, shared message id, or unique same-parent synthetic↔session match; otherwise fail closed. | Title similarity, `Delegation:` prefix, duration/timestamp heuristics. | Semantic evidence is stable; display text and timing are explicitly unreliable. |

## Data Flow

    events/hydration ──→ state.children ──→ classify/collapse ──→ visible rows
                                      │              │
                                      └──────────────┴──→ counters / Σ

`events.ts` should keep preserving `source`, `toolName`, `id`, `parentID`, `messageID`, and sanitized `targetSessionID`. It should not decide visibility.

## File Changes

| File | Action | Description |
|------|--------|-------------|
| `src/subagent-classification.ts` | Create | Shared `classifySubagentWorkItem()`, trusted target/session-id helpers, correlation, and metadata merge helpers. |
| `src/render.ts` | Modify | Rework `collapseSubagentWorkItems()` to output only canonical real session rows; `visibleSubagentWorkItems()` filters wrappers before recency/history rules. |
| `src/state.ts` | Modify | Make `isVisibleSubagentCounterEligible()` and `countHistoricalSubagentExecutions()` count only classified real session identities; remove targetless subtask fallback counting. |
| `src/tui.tsx` | Modify | Sidebar/home snapshots continue to use render/state helpers; hydration target backfill must remain unique/fail-closed. |
| `src/events.ts` | Modify | Only preserve semantic fields; no title-based classification. Keep sync task target extraction and async delegate fields intact. |
| `src/*.test.ts` | Modify | Update regression coverage for wrappers, proxies, real sessions, and counters. |

## Interfaces / Contracts

```ts
type SubagentWorkClassification =
  | { kind: "real-execution"; executionID: string; targetSessionID: string }
  | { kind: "execution-proxy"; executionID: string; targetSessionID: string }
  | { kind: "invocation-wrapper" };
```

`collapseSubagentWorkItems(children)` should build a map keyed by `executionID`. Real session rows win. Matched proxies may contribute non-identity display metadata (`summary`, useful prompt-derived title when desired) and lifecycle/navigation metadata only when missing, but the emitted row keeps the real `id`, `source: "session"`, status, timing, tokens, and `targetSessionID`. Targetless `delegate`, `task`, and `subtask` rows are dropped. Ambiguous same-parent matches are not merged.

`isVisibleSubagentCounterEligible(child)` returns true only for classified real executions. `countHistoricalSubagentExecutions({ children, parentSessionID })` counts unique real `executionID`s after the same classification/correlation, independent of completed-history visibility.

Sync `task`/`subtask` and async `delegate` wrappers are treated identically: targetless = hidden/uncounted wrapper; trusted target = proxy; real session row = visible/countable execution.

## Testing Strategy

| Layer | What to Test | Approach |
|-------|-------------|----------|
| Unit | Classifier semantics | New tests via `state.test.ts` or dedicated classifier tests for real `Delegation:` titles, targetless wrappers, trusted proxies, ambiguity. |
| Unit | Render collapse/visibility | `render.test.ts`: wrapper hidden before real exists; history shows only real session; proxy+session emits one `ses_*` row. |
| Unit | Counters | `state.test.ts`: `Σ` and visible eligibility count only real sessions; no targetless subtask fallback. |
| Snapshot seams | Sidebar/home/statusline agreement | `tui.test.ts` and `render.test.ts`: same current-session totals and visible counts for delegate/task/subtask cases. |
| Events | Semantic field preservation | `events.test.ts`: delegate `toolName`, task targets, and real `Delegation:` session storage. |

## Migration / Rollout

No migration required. Runtime/hydrated views recompute from `children`; persisted legacy counted wrapper ids should be ignored or rekeyed only when a real `ses_*` row exists.

## Risks and Non-goals

- Risk: target-only proxies without hydrated real sessions disappear until the session row arrives; this matches the domain rule.
- Risk: unique same-parent correlation can be wrong if OpenCode omits stronger ids; fail closed.
- Non-goal: repairing old persisted inflated counters or introducing timing/title heuristics.

## Open Questions

None.
