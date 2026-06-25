## Exploration: Fix delegated subagent history duplication and aggregate counters

### Current State
The TUI sidebar builds its rows through `resolveSidebarSubagentSnapshot()` in `src/tui.tsx`. It scopes `state.children` to the current session, passes them through `visibleSubagentWorkItems()` from `src/render.ts`, then counts only rows accepted by `isVisibleSubagentCounterEligible()` from `src/state.ts`. `Σ` is computed separately with `countHistoricalSubagentExecutions()` over all scoped children, not just currently visible rows.

`visibleSubagentWorkItems()` first calls `collapseSubagentWorkItems()`. Collapse can merge/hide synthetic rows and real session rows when it has strong correlation: `targetSessionID`, reciprocal target, matching `messageID`, or title/agent similarity. Delegate history can bypass this because `session.children()` hydration creates a `source: "session"` technical row titled `Delegation: ...`, while `message.part.updated` hydration creates a `source: "tool", toolName: "delegate"` row titled from the prompt/description. When target/message IDs are missing and titles do not correlate, both rows survive, producing the wrapper-vs-real duplicate in completed-history mode.

Counters are stricter than row visibility. `isVisibleSubagentCounterEligible()` excludes synthetic `source: "tool"` rows unless they look like task proxies; `toolName: "delegate"` is explicitly not a task proxy. `countHistoricalSubagentExecutions()` also excludes all synthetic tool wrappers and any technical `Delegation:` title. Therefore a real local delegate represented only by a `toolName: "delegate"` row can be visible but contribute `run 0 · ✓ 0 done · × 0 err · Σ 0`.

Hydration in `hydratePreviousSubagents()` reads both `session.children()` and parent `session.messages()`. Child sessions become fake `session.created` events; parent message parts become fake `message.part.updated` events. This preserves both identities instead of reconciling them at event time. Existing retry/session scoping already uses `resolveHydrationSessionID()` to prefer route session and fall back to sidebar context, so this change is mainly about delegate identity and counter semantics, not route discovery.

### Affected Areas
- `src/render.ts` — `collapseSubagentWorkItems()`, `sessionMatchesSynthetic()`, and `visibleSubagentWorkItems()` define wrapper-vs-real row collapse and completed-history visibility.
- `src/state.ts` — `isVisibleSubagentCounterEligible()`, `countHistoricalSubagentExecutions()`, `historicalIdentityForChild()`, and `resolveExecutionCountIdentity()` define visible-counter and historical `Σ` eligibility.
- `src/tui.tsx` — `resolveSidebarSubagentSnapshot()`, `resolveHomeBottomStatusSnapshot()`, and `hydratePreviousSubagents()` combine row visibility, aggregate counters, and historical hydration sources.
- `src/events.ts` — `extractToolChild()`, `extractCreatedChild()`, and `applySubagentEvent()` produce the `toolName: "delegate"` row and the technical session row identities that later need reconciliation.
- `src/render.test.ts` — current collapse coverage includes task wrappers and generic delegate wrappers but not technical `Delegation:` session plus real delegate tool rows.
- `src/state.test.ts` — current counter coverage verifies delegate/tool exclusion but not countable local delegate executions after collapse.
- `src/tui.test.ts` — sidebar snapshot tests already cover hidden-history totals and wrapper exclusions; needs regression coverage for visible delegate rows and history-mode duplicates.
- `src/events.test.ts` — delegate extraction is covered for preserving `toolName: "delegate"`; may need event-shape fixtures if identity hints are added earlier.

### Approaches
1. **Count delegate tool rows directly without changing collapse** — Treat `toolName: "delegate"` rows as countable in visible counters and/or historical totals.
   - Pros: Smallest implementation; directly fixes `Σ 0` and `done 0` for visible real delegate rows.
   - Cons: Does not fix duplicated history rows; high risk of re-counting pure call/wrapper artifacts that the previous counting fix intentionally excluded.
   - Effort: Low

2. **Dedupe wrapper-vs-real first, then count collapsed survivors** — Strengthen collapse for same-parent technical `Delegation:` session rows and real delegate tool rows, then compute visible counters and historical `Σ` from the collapsed identity set with delegate-specific eligibility.
   - Pros: Fixes both user symptoms; keeps UI row identity and counters aligned; lets technical `Delegation:` wrappers be hidden while the prompt/description row survives; avoids counting rows that collapse away.
   - Cons: Requires careful delegate-only matching so unrelated delegates in the same parent are not merged; historical `Σ` must remain independent of default recency visibility while still using collapsed all-history rows.
   - Effort: Medium

3. **Event-time reconciliation to merge identities earlier** — During `applySubagentEvent()` or `hydratePreviousSubagents()`, attach target/message IDs or rekey the technical session and delegate tool into one state child before render/counter code sees them.
   - Pros: Most canonical state model; downstream render and counter functions become simpler; can benefit navigation if a target session is recovered.
   - Cons: Highest risk and coupling to OpenCode event shapes; hydration order and partial data make false merges expensive; more test surface across events, state, render, and TUI.
   - Effort: High

### Recommendation
Use approach 2. First collapse the technical `Delegation:` session row against the corresponding delegate tool row when correlation is safe, favoring the real prompt/description title for display and preserving target/status/timing from the session when available. Then compute sidebar/home/statusline counters from the same collapsed all-history identity set: visible `run/done/err` from currently visible survivors, and `Σ` from all collapsed survivors for the current session. Make delegate tool rows countable only when they survive collapse as the real work item, not when they are generic or hidden wrappers.

This is the best balance: it fixes the duplicate row and the zero aggregate together, preserves the earlier non-goal of not counting pure wrappers, and avoids pushing brittle OpenCode event reconciliation into the ingestion path before the exact delegate event contracts are fully known.

### Risks
- Same-parent delegate rows without message/target IDs can be ambiguous; fail closed rather than merging multiple possible matches.
- Counting every `toolName: "delegate"` row would regress wrapper exclusion; eligibility should depend on collapsed survivor status and non-technical display identity.
- `Σ` should remain current-session historical total and must not depend on whether completed history is toggled on.
- Hiding the technical session row must not remove navigation data; if the session row has the only `ses_...` target, merge/preserve it onto the surviving delegate row.
- Existing tests intentionally expect some delegate/tool rows to produce `Σ 0`; new tests must distinguish generic wrappers from real local delegate executions.

### Ready for Proposal
Yes — propose a focused bug fix that defines delegate tool rows as countable real work only after wrapper-vs-real collapse, hides technical `Delegation:` duplicates, preserves session/navigation metadata when available, and adds regression tests for sidebar snapshot, historical visibility, and aggregate `Σ` semantics.

---

### Focused Deepening: Wrapper Signatures vs Real Executions

#### 1. Invocation/call wrapper vs real execution signatures

- **Real execution**: `session.created` / `session.updated` events are parsed by `extractCreatedChild()` and stored through `applySubagentEvent()` as `ChildSessionState` with `source: "session"`, `id: "ses_*"`, `parentID` from `properties.info.parentID`, and `targetSessionID` set to the same session id. Hydration creates the same shape from `api.client.session.children({ sessionID })` by replaying fake `session.created` events. This is the strongest real-execution signal, even when `title` is a technical placeholder such as `Delegation: ...`.
- **Tool invocation wrapper**: `message.part.updated` with `part.type: "tool"` and `part.tool: "delegate" | "task"` is parsed by `extractToolChild()` and stored as `id: "tool:<part.id>"`, `source: "tool"`, `toolName`, `parentID` from `part.sessionID` or event `sessionID`, `messageID` from the part, and status from `part.state.status`. This is an invocation/call record until it has real-session evidence.
- **Subtask-style invocation/proxy**: `message.part.updated` with `part.type: "subtask"` is parsed by `extractSubtaskChild()` and stored as `id: "subtask:<part.id>"`, `source: "subtask"`, `parentID`, `messageID`, title/agent metadata, and optional `targetSessionID`. Current state treats targetless subtasks as provisional countable fallbacks, but the updated domain rule means targetless subtask rows should be treated as invocation/proxy evidence, not real executions.

#### 2. Async `delegate` vs sync `task` / subtask representation

- **Async delegate path**: represented in this codebase as a `source: "tool"`, `toolName: "delegate"` wrapper from parent `message.part.updated`, plus a real child session from `session.children()` / `session.created` when OpenCode exposes the child. Delegate-specific extraction currently has no `task_id`/metadata parser beyond recursive session-id candidates in the part payload. Terminal delegate tool status only closes the tool row; it does not prove a real execution by itself.
- **Sync task/subtask path**: may appear as `source: "subtask"` parts, `source: "tool"`, `toolName: "task"` parts, and/or a real `source: "session"` child. `extractTaskToolEvidence()` has stronger target recovery than delegate: `state.metadata.sessionId`, a unique `task_id: ses_*` in output, or a single session-id candidate found in the part. Completed task tools can update matching subtasks through `mapTaskToolToSubtaskID()`.
- **Background task note**: current OpenCode docs show `task` has a `background?: boolean` parameter. This plugin does not currently store that input flag in `ChildSessionState`; classification therefore cannot rely on sync/async intent flags and should rely on real-session evidence instead.

#### 3. Reliable classification fields

- `source` is the best internal discriminator after event parsing: `session` = real session evidence; `tool` = tool invocation; `subtask` = message-part proxy/invocation evidence.
- `id` prefix is a useful fallback (`ses_*`, `tool:*`, `subtask:*`), but `source` should remain primary when present.
- `toolName` is reliable for distinguishing `task` from `delegate` tool wrappers; it is more reliable than display text.
- `targetSessionID` is reliable only when sanitized to `ses_*` and obtained from explicit metadata, unique parsed output, unique session-id candidates, or unambiguous backfill. It should classify a synthetic row as a proxy for a real execution, not as an independent execution.
- `parentID` is reliable for session scoping but insufficient alone for correlation.
- `messageID` is strong when both sides have it, but real child sessions often lack it, especially from `session.children()` hydration.
- Session child metadata from `session.children()` (`id`, `parentID`, status/timestamps) is strong real-execution evidence; `title` from that metadata is not.
- Status transitions (`session.status`, `session.idle`, `session.error`) are reliable for lifecycle state, not for deciding whether a row is a wrapper or a real execution.

#### 4. Unreliable fields

- `title` / placeholder text is not reliable. A real session may be titled `Delegation: ...`, and a wrapper may have a useful prompt-derived title. Title must not decide visibility or counting alone.
- `Delegation:` prefix is only a display hint. It must not exclude a `source: "session"` / `ses_*` row from counting.
- `kind` is not a persisted field in `ChildSessionState`; OpenCode part `type` is consumed at event time and becomes `source`/`toolName`.
- Timestamps and elapsed duration are not classification evidence. Wrappers can be non-zero duration, and real sessions can have placeholder timestamps.
- Agent/title similarity is weak correlation only. Use it only after same-parent uniqueness and stronger identifiers fail closed.
- Terminal `completed`/`error` tool status proves the call finished, not that the child execution should be counted unless a target session is known.

#### 5. Recommended classification ownership

Classification should be centralized in one pure helper layer used by state, render, and TUI snapshots. The cleanest implementation is a small shared module or exported state helper, for example `classifySubagentWorkItem()` / `resolveSubagentExecutionIdentity()`, that returns an internal classification such as:

```ts
type SubagentWorkClassification =
  | { kind: "real-execution"; executionID: string; targetSessionID: string }
  | { kind: "execution-proxy"; executionID: string; targetSessionID: string }
  | { kind: "invocation-wrapper" }
  | { kind: "unknown" };
```

`collapseSubagentWorkItems()`, `isVisibleSubagentCounterEligible()`, `countHistoricalSubagentExecutions()`, `renderStatusLine()`, `resolveSidebarSubagentSnapshot()`, and `resolveHomeBottomStatusSnapshot()` should all consume that shared classification instead of reimplementing wrapper/real logic. This prevents the current mismatch where render can show a delegate row while counters still treat it as uncountable wrapper evidence.

#### 6. Proposed model and regression tests

Model:

1. Targetless `source: "tool"` and targetless `source: "subtask"` rows are invocation/proxy evidence only: do not show and do not count them as real subagents.
2. `source: "session"` or `id: "ses_*"` is a real execution and counts, regardless of `title`.
3. Synthetic rows with a trusted `targetSessionID: "ses_*"` are execution proxies for that target; they may contribute display metadata but must count under the target session identity and must not double count if the real session row also exists.
4. When a tool/subtask proxy and a real session correlate by `targetSessionID`, shared `messageID`, or unambiguous same-parent uniqueness, render exactly one work item and preserve navigable `targetSessionID`.
5. Historical view and `Σ` must operate over the same classified/collapsed execution identities as the visible TUI, with history toggles changing only recency visibility, not wrapper eligibility.

Tests to add/update:

- `src/events.test.ts`: keep `toolName: "delegate"` independent of title; add a real `session.created` with `title: "Delegation: ..."` and assert it is still stored/countable as a session.
- `src/state.test.ts`: assert targetless delegate/task tool wrappers and targetless subtask proxies do not increment historical totals; assert `source: "session"` titled `Delegation: ...` increments; assert a delegate proxy plus matching session counts exactly one target identity.
- `src/render.test.ts`: assert invocation wrappers are not visible before real-session evidence; assert completed-history mode shows only the real/collapsed execution, not the wrapper; assert ambiguous same-parent wrappers fail closed.
- `src/tui.test.ts`: assert sidebar and home-bottom snapshots share the same classification for delegate/task/subtask proxies, real sessions with `Delegation:` title, and `Σ` totals.
- `src/render.test.ts` or `src/state.test.ts`: add a sync task fixture with `metadata.sessionId` / `task_id` to prove the proxy counts under the real target only after trusted target evidence exists.

#### Refined Recommendation

Move from title-based exclusion to evidence-based classification. Treat real session identity (`source: "session"` / `ses_*`) and trusted `targetSessionID` as the only countable execution evidence; treat tool/subtask rows without target evidence as invocation wrappers/proxies that should be hidden and uncounted. Then make render, sidebar, home-bottom, and historical counters consume the same classified execution identity set.
