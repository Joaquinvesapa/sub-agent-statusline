# Proposal: Fix Delegate History Counters

## Intent

Fix the domain mismatch between subagent invocation wrappers and real subagent executions. Users should never see or count a call wrapper as an execution, and real executions must remain visible/countable even when their title looks like `Delegation:`.

## Scope

### In Scope
- Centralize classification for `real-execution`, `execution-proxy`, and `invocation-wrapper` semantics.
- Make sidebar rows, historical view, visible counters, and `Σ` consume the same classified execution identities.
- Hide/count only real executions: wrappers are not visible/countable before trusted real-session evidence exists.
- Preserve navigation/status metadata when collapsing a proxy/wrapper with its real session.

### Out of Scope
- Broad migration/repair of persisted historical inflated counters.
- Timing-, duration-, or title-based classification heuristics.
- Source-code implementation in this proposal phase.

## Capabilities

### New Capabilities
- None

### Modified Capabilities
- `subagent-history-counters`: refine wrapper exclusion, visible history, and counter semantics to use evidence-based execution classification.

## Approach

Use a shared pure classification layer near state/render boundaries. Treat `source: "session"` or `ses_*` IDs as real executions; trusted `targetSessionID`, scoped `parentID`, and shared `messageID` may correlate proxies to real executions. Treat targetless `tool`/`subtask` rows as invocation/proxy evidence only. Do not use title text, `Delegation:` prefix, timestamps, elapsed duration, or weak title similarity to decide countability.

## Affected Areas

| Area | Impact | Description |
|------|--------|-------------|
| `src/state.ts` | Modified | Historical `Σ`, visible counter eligibility, execution identity resolution. |
| `src/render.ts` | Modified | Collapse/visibility should hide wrappers and expose only classified real executions. |
| `src/tui.tsx` | Modified | Sidebar/home/status snapshots consume the same classification output. |
| `src/events.ts` | Modified | Preserve reliable fields (`source`, `toolName`, IDs, parent/message/target IDs). |
| `src/*.test.ts`, `test/**/*.integration.test.ts` | Modified | Regression coverage for delegate/task/subtask wrappers and real sessions. |

## Risks

| Risk | Likelihood | Mitigation |
|------|------------|------------|
| Ambiguous same-parent wrappers merge incorrectly | Med | Fail closed unless correlation is trusted and unique. |
| Real `Delegation:` sessions excluded by old title logic | Med | Make `source`/`ses_*` identity override title text. |
| Counters drift from rendered rows | Med | Route rows/history/counters through one classifier. |

## Rollback Plan

Revert the classifier, row filtering, counter changes, and related tests. Since no persisted migration is required, rollback restores prior runtime behavior without data repair.

## Dependencies

- Existing OpenCode event/session fields exposed through current plugin state.
- Existing Vitest, `pnpm test`, and `pnpm typecheck` verification.

## Success Criteria

- [ ] Invocation wrappers are never user-visible/countable executions before real-session evidence exists.
- [ ] Historical view and counters show/count only real executions, including real `Delegation:`-titled sessions.
- [ ] Sidebar rows, home/status counters, and `Σ` agree on the same execution identities.
