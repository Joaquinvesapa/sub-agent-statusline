# Delta for subagent-history-counters

## ADDED Requirements

### Requirement: Terminal error history visibility

The system MUST apply the same default list visibility rule to terminal `error` executions as it applies to terminal `done` executions. Hidden terminal errors MUST still contribute to header/status `err` and `Σ` counters, and MUST remain available when history is shown.
TUI snapshots MUST keep visible rows, retained status counters, and `Σ` in the same session scope. If the current session has retained hidden terminal executions, the snapshot MUST stay scoped to the current session instead of falling back to visible rows from other sessions.

#### Scenario: Stale terminal error hides from default view

- GIVEN a real current-session subagent execution ended in `error` outside the default terminal visibility window
- WHEN the default sidebar/statusline rows are computed
- THEN the stale error row is hidden
- AND an equally stale `done` row follows the same visibility outcome

#### Scenario: Recent terminal error remains visible

- GIVEN a real current-session subagent execution ended in `error` inside the default terminal visibility window
- WHEN the default sidebar/statusline rows are computed
- THEN the recent error row remains visible
- AND it contributes to header/status `err` counters

#### Scenario: Running work does not reveal stale errors

- GIVEN at least one subagent execution is `running`
- AND an older real execution ended in `error` outside the default terminal visibility window
- WHEN default rows and counters are rendered
- THEN the running execution remains visible
- AND the stale error row remains hidden from the default view
- AND header/status `err` still includes the hidden retained error

#### Scenario: Hidden terminal error remains historical

- GIVEN a stale real current-session error is hidden from the default view
- WHEN historical counters are rendered
- THEN `err` includes the hidden retained error execution
- AND `Σ` includes the hidden error execution

#### Scenario: History toggle reveals hidden terminal errors

- GIVEN stale real current-session `done` and `error` executions are hidden by default visibility
- WHEN the history toggle is enabled
- THEN both terminal rows become available in the visible history view
- AND `Σ` remains unchanged

#### Scenario: Current retained history blocks other-session fallback

- GIVEN the current session has retained hidden terminal `done` and `error` executions
- AND another session has visible running work
- WHEN the TUI snapshot is resolved with other-session fallback enabled
- THEN the snapshot stays scoped to the current session
- AND no other-session rows are shown
- AND `done`, `err`, and `Σ` report the current-session retained executions

#### Scenario: Empty current session may fall back to other-session scope

- GIVEN the current session has no visible rows and no retained real executions
- AND another session has visible or retained real executions
- WHEN the TUI snapshot is resolved with other-session fallback enabled
- THEN the snapshot MAY show the other-session rows
- AND retained status counters and `Σ` use the same other-session scope as the visible rows

## MODIFIED Requirements

### Requirement: Visible completed counter

The system MUST report header/status `done` and `err` as counts of retained, not-yet-pruned current-session real terminal executions, independent of default list visibility. Default rows MAY hide unrelated retained terminal `done` and `error` executions while `running` work exists. `Σ` MUST remain the total retained/history count of classified current-session real executions.
(Previously: `done` counted visible completed rows only, so hidden terminal rows could zero status counters while still contributing to `Σ`.)

#### Scenario: Hidden completed rows still contribute to done

- GIVEN completed subagent rows exist but are hidden by the default visibility filter
- WHEN the collapsed/default header is rendered
- THEN `done` includes the hidden retained completed rows
- AND `Σ` includes retained current-session real rows

#### Scenario: Visible completed history contributes to done

- GIVEN completed real execution rows become visible after the completed-history toggle
- WHEN counters are rendered
- THEN `done` still includes the retained completed real execution rows

#### Scenario: Running header counts retained terminal history

- GIVEN the default list shows `1 run`
- AND retained terminal history contains `6 done` and `7 err`
- WHEN the sidebar/statusline header is rendered
- THEN it shows `1 run · 6 done · 7 err · Σ 13`
