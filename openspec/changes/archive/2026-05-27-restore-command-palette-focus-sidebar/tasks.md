# Tasks: Restore command palette focus sidebar

## Review Workload Forecast

| Field | Value |
|-------|-------|
| Estimated changed lines | 180-300 |
| 400-line budget risk | Medium |
| Chained PRs recommended | No |
| Suggested split | Single PR with 2 work units (implementation+tests, docs+evidence) |
| Delivery strategy | ask-on-risk |
| Chain strategy | pending |

Decision needed before apply: Yes
Chained PRs recommended: No
Chain strategy: pending
400-line budget risk: Medium

### Suggested Work Units

| Unit | Goal | Likely PR | Notes |
|------|------|-----------|-------|
| 1 | Restore additive registration and safe composite disposer with full unit coverage | PR 1 | Keep RED→GREEN→REFACTOR cycle in same unit; include `src/tui-commands.ts` + tests |
| 2 | Align docs and produce issue #54 evidence summary | PR 1 | Same PR unless diff grows near 400; if so, split as chained doc/evidence follow-up |

## Phase 1: Foundation and test design

- [x] 1.1 Map current command registration branches in `src/tui-commands.ts` and note exact early-return path to replace with additive flow.
- [x] 1.2 Define expected command metadata/callback shared shape (IDs, labels, descriptions, category) to avoid keymap/legacy drift.
- [x] 1.3 Plan RED tests in `src/tui.test.ts` for dual API, keymap-only, legacy-only, neither API, and idempotent composite dispose behavior.

## Phase 2: Core implementation plan

- [x] 2.1 Refactor `registerSubagentCommands` in `src/tui-commands.ts` to attempt `api.keymap.registerLayer` and `api.command.register` independently when present.
- [x] 2.2 Keep `Alt+B` bound to `subagent-statusline.focus-sidebar-list` through keymap layer while preserving legacy palette registration for discoverability.
- [x] 2.3 Introduce a collected-disposer strategy returning one idempotent composite disposer that runs all created cleanups safely.
- [x] 2.4 Confirm `src/tui.tsx` lifecycle wiring still consumes one `TuiCommandDispose` without required interface changes.

## Phase 3: TDD verification tasks

- [x] 3.1 RED: add failing tests in `src/tui.test.ts` proving both APIs register in same invocation and cleanup runs both disposers.
- [x] 3.2 GREEN: make tests pass for partial availability paths (keymap-only, legacy-only, neither) and Alt+B continuity checks.
- [x] 3.3 TRIANGULATE/REFACTOR: add disposer double-call and throwing-disposer safety checks; refactor helpers while keeping behavior locked.
- [x] 3.4 Run verification commands: `pnpm test`, `pnpm typecheck`, and `pnpm build` (or exact equivalents from `package.json` scripts if names differ).

## Phase 4: Docs and issue evidence

- [x] 4.1 Update `docs/en/07-tui-interface.md` to describe keymap shortcut plus compatibility legacy command registration.
- [x] 4.2 Update `docs/es/07-interfaz-tui.md` with the same compatibility wording and keep terminology aligned with command IDs.
- [x] 4.3 Inspect `README.md` and update only if command palette behavior wording is now inaccurate.
- [x] 4.4 Prepare issue-response evidence for GitHub issue #54: root cause (keymap early return skipped legacy registration), fix summary (additive dual registration + composite disposer), and test proof references.
