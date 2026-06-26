# Proposal: Fix Subagent Error Cleanup

## Intent

Errored subagents currently stay in the default sidebar/statusline view until pruning removes them days later. Treat `error` like `done` for default row visibility so old terminal rows do not crowd active work, while header counters still summarize retained history.

## Scope

### In Scope
- Hide stale or unrelated terminal `done`/`error` rows from the default list while active `running` work exists.
- Keep retained hidden terminal rows counted in header/status `done`, `err`, and `Σ` until normal pruning removes them.
- Keep hidden terminal rows available through the history toggle.
- Preserve existing terminal-state pruning TTL/cap behavior.
- Add regression coverage for render, TUI snapshots/counts, and error pruning.

### Out of Scope
- New manual acknowledgement workflow for errors.
- Changing the 3-day terminal retention TTL or cap.
- Reworking wrapper/proxy classification from the previous history-counter change.
- Renaming UI controls unless later spec/design requires copy clarification.

## Capabilities

### New Capabilities
- None

### Modified Capabilities
- `subagent-history-counters`: retained terminal `done`/`error` rows may be hidden from the default list during active work, but header/status counters must still report their retained history counts.

## Approach

Separate list visibility from header/status aggregation. The default list may hide unrelated retained terminal rows when `running` work exists, but counters aggregate retained current-session real executions by status (`done`, `error`) plus `Σ`. Keep `pruneTerminalChildren()` unchanged for TTL/cap cleanup. Tests should prove the screenshot case: `1 run` visible while retained history still reports e.g. `6 done · 7 err · Σ 13`.

## Affected Areas

| Area | Impact | Description |
|------|--------|-------------|
| `src/render.ts` | Modified | Keep terminal row visibility filtered without losing retained counter inputs. |
| `src/tui.tsx` | Modified | Render retained-history `done`/`err` counters even when rows are hidden. |
| `src/render.test.ts` | Modified | Cover active-work filtering with hidden terminal rows. |
| `src/tui.test.ts` | Modified | Cover screenshot counters: hidden `done`/`error` still counted. |
| `src/state.test.ts` | Modified | Confirm old `error` rows prune as terminal children. |

## Risks

| Risk | Likelihood | Mitigation |
|------|------------|------------|
| Users miss old failures in default view | Med | Preserve `done`/`err`/`Σ` counters and history toggle visibility. |
| Missing timestamps hide/prune incorrectly | Low | Cover `updatedAt` fallback for errored rows. |
| UI label confusion for history toggle | Low | Specify behavior now; defer copy rename unless needed. |

## Rollback Plan

Revert the visibility change and related tests/spec deltas; existing terminal pruning and classification behavior remain unchanged.

## Dependencies

- Existing `subagent-history-counters` spec and current visibility/pruning helpers.

## Success Criteria

- [ ] Stale or unrelated terminal rows hide from default views during active work.
- [ ] Hidden retained terminal rows still contribute to header/status `done`, `err`, and `Σ`.
- [ ] Active running work shows `run` rows without zeroing retained `done`/`err` counters.
- [ ] Existing terminal cleanup continues pruning old errors after TTL/cap.
