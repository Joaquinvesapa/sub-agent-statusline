# subagent-history-counters Specification

## Purpose

Define sidebar/statusline subagent counter semantics for current-session history, visible rows, wrapper exclusion, and session-scoped hydration.

## Requirements

### Requirement: Historical total counter

The system MUST report `Σ` as count of classified current-session real executions, independent of row visibility.
(Previously: `Σ` used weaker wrapper/proxy classification.)

#### Scenario: Hidden completed history contributes to total

- GIVEN the current session has completed real subagent rows hidden by the default collapsed view
- WHEN the sidebar/statusline header is rendered
- THEN `Σ` includes those hidden real subagent rows
- AND visible rows remain collapsed by visibility rules

#### Scenario: History toggle does not redefine total

- GIVEN real historical subagent rows exist
- WHEN completed history is toggled from hidden to visible
- THEN `Σ` remains equal to the current-session real execution total
- AND no invocation wrappers are added to `Σ`

### Requirement: Visible completed counter

The system MUST report `done` as count of visible completed real executions only. Visible counters MUST classify each visible real execution into `running`, `done`, or `err`.
(Previously: `done` counted visible completed rows without explicit real execution identity.)

#### Scenario: Hidden completed rows do not contribute to done

- GIVEN completed subagent rows exist but are hidden by the default visibility filter
- WHEN the collapsed/default header is rendered
- THEN `done` excludes the hidden completed rows
- AND `Σ` may still include real current-session rows

#### Scenario: Visible completed history contributes to done

- GIVEN completed real execution rows become visible after the completed-history toggle
- WHEN counters are rendered
- THEN `done` includes only the visible completed real execution rows

### Requirement: Wrapper row exclusion

The system MUST NOT show or count wrappers as real executions. Title text, `Delegation:` prefix, timestamps, duration, or terminal tool status MUST NOT determine visibility or countability.
(Previously: wrapper exclusion referenced `Delegation:` title text as wrapper evidence.)

#### Scenario: Delegation wrapper is excluded

- GIVEN a targetless delegate call wrapper exists before real-session evidence
- WHEN sidebar rows, historical view, or counters are computed
- THEN it is hidden and does not increment `running`, `done`, `err`, or `Σ`

#### Scenario: Tool-only wrapper is excluded

- GIVEN a hydrated row represents a tool or call wrapper without a real child subagent execution
- WHEN historical counters are computed
- THEN the row does not increment `Σ`

#### Scenario: Title does not exclude real execution

- GIVEN a real execution title or placeholder contains `Delegation:`
- WHEN visible rows and counters are computed
- THEN the real execution remains visible when allowed by history filters
- AND it contributes to exactly one of `running`, `done`, or `err`, plus `Σ`

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

### Requirement: Evidence-based execution classification

The system MUST classify work items by semantic fields, not display text. `source: "session"` or `id: "ses_*"` MUST be real execution. Tool/subtask rows with trusted `targetSessionID: "ses_*"` MUST be proxies. Targetless tool/subtask rows MUST be wrappers.

#### Scenario: Real delegation-titled session counts

- GIVEN an item has `source: "session"` or `id: "ses_*"`
- AND its title contains `Delegation:`
- WHEN classification runs
- THEN it is classified as a real execution

#### Scenario: Targetless invocation wrapper is not execution

- GIVEN a delegate, task, or subtask row has no trusted `ses_*` target
- WHEN classification runs
- THEN it is classified as an invocation wrapper
- AND it is hidden and uncounted

### Requirement: Fail-closed correlation

The system MUST correlate wrappers/proxies to executions only with trusted unique evidence: target session, shared message, or unambiguous same-parent correlation. Ambiguous correlation MUST fail closed.

#### Scenario: Ambiguous same-parent wrapper is ignored

- GIVEN one targetless wrapper and multiple real executions share a parent
- WHEN rows are correlated
- THEN the wrapper is not merged
- AND only real executions remain visible/countable

#### Scenario: Trusted proxy does not double count

- GIVEN a proxy targets `ses_child` and the real `ses_child` row also exists
- WHEN rows and counters are computed
- THEN exactly one execution identity is visible/countable
