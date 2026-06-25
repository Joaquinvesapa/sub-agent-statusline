# subagent-history-counters Specification

## Purpose

Define sidebar/statusline subagent counter semantics for current-session history, visible rows, wrapper exclusion, and session-scoped hydration.

## Requirements

### Requirement: Historical total counter

The system MUST report `Σ` as the count of all real historical subagent executions for the current session, independent of collapsed/default row visibility.

#### Scenario: Hidden completed history contributes to total

- GIVEN the current session has completed real subagent rows hidden by the default collapsed view
- WHEN the sidebar/statusline header is rendered
- THEN `Σ` includes those hidden real subagent rows
- AND the visible row list remains collapsed according to its visibility rules

#### Scenario: History toggle does not redefine total

- GIVEN real historical subagent rows exist for the current session
- WHEN completed history is toggled from hidden to visible
- THEN `Σ` remains equal to the current-session real subagent total
- AND no additional non-real rows are added to `Σ`

### Requirement: Visible completed counter

The system MUST report `done` as the count of visible completed rows only.

#### Scenario: Hidden completed rows do not contribute to done

- GIVEN completed subagent rows exist but are hidden by the default visibility filter
- WHEN the collapsed/default header is rendered
- THEN `done` excludes the hidden completed rows
- AND `Σ` may still include them when they are real current-session subagents

#### Scenario: Visible completed history contributes to done

- GIVEN completed subagent rows become visible after the completed-history toggle
- WHEN counters are rendered
- THEN `done` includes only the visible completed rows

### Requirement: Wrapper row exclusion

The system MUST NOT count technical wrapper or call rows as real subagent executions.

#### Scenario: Delegation wrapper is excluded

- GIVEN a row title starts with `Delegation:` and represents a wrapper/call artifact
- WHEN historical counters are computed
- THEN that row does not increment `Σ`
- AND it is not treated as a real subagent execution

#### Scenario: Tool-only wrapper is excluded

- GIVEN a hydrated row represents a tool or call wrapper without a real child subagent execution
- WHEN historical counters are computed
- THEN the row does not increment `Σ`

### Requirement: Current-session hydration source

The system MUST hydrate and count history only for the current sidebar session, and SHALL use `ctx.session_id` as the source of truth when the route session is unclear or missing.

#### Scenario: Context session fallback hydrates history

- GIVEN the route session is missing or unclear
- AND sidebar context provides `ctx.session_id`
- WHEN historical subagent hydration runs
- THEN hydration uses `ctx.session_id`
- AND `Σ` reflects real subagents for that session

#### Scenario: Session isolation is preserved

- GIVEN hydrated data exists for another session
- WHEN counters are computed for the current sidebar session
- THEN rows from the other session do not affect `Σ` or `done`

#### Scenario: No session source is available

- GIVEN neither route session nor `ctx.session_id` is available
- WHEN hydration and counters are computed
- THEN the system SHALL NOT mix unknown-session history into the sidebar
- AND counters remain based only on already-scoped visible state
