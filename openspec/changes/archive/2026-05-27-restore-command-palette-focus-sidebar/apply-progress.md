# Apply Progress: restore-command-palette-focus-sidebar

## Mode

Standard (strict_tdd from preflight: false)

## Workload / PR Boundary

- Delivery path: single PR work unit (implementation + tests + docs + evidence).
- 400-line budget risk: Medium (accepted by preflight, chained PR not required).
- Scope stayed bounded to `src/tui-commands.ts`, `src/tui.test.ts`, docs compatibility wording, and change artifacts.

## Completed Tasks

- [x] 1.1 Mapped and removed the early return in `registerSubagentCommands` that previously skipped legacy registration when keymap existed.
- [x] 1.2 Introduced shared command metadata/builders to keep keymap and legacy command IDs/descriptions/category aligned.
- [x] 1.3 Added test coverage plan and implementation for dual API, keymap-only, legacy-only, neither API, and composite disposal behavior.
- [x] 2.1 Refactored registration flow to attempt keymap and legacy registration independently.
- [x] 2.2 Preserved `Alt+B` keymap binding to `subagent-statusline.focus-sidebar-list` while restoring command-palette registration via legacy API.
- [x] 2.3 Added idempotent composite disposer that executes all collected disposers and tolerates dispose-time exceptions.
- [x] 2.4 Confirmed `src/tui.tsx` still consumes a single `TuiCommandDispose`; no interface changes required.
- [x] 3.1 Added coverage proving both APIs register in one invocation and both disposers run.
- [x] 3.2 Added coverage for keymap-only, legacy-only, neither API, and `Alt+B` continuity checks.
- [x] 3.3 Added double-dispose idempotency and throwing-disposer safety checks.
- [x] 3.4 Ran verification commands from package scripts.
- [x] 4.1 Updated English TUI docs compatibility wording.
- [x] 4.2 Updated Spanish TUI docs compatibility wording.
- [x] 4.3 Inspected README command palette wording; no change required.
- [x] 4.4 Captured issue #54 evidence summary below.

## Files Changed

- `src/tui-commands.ts`
  - Replaced keymap-first early return with additive optional registration.
  - Added shared command metadata constants/builders.
  - Added composite idempotent disposer that cleans up all collected registrations safely.
- `src/tui.test.ts`
  - Replaced obsolete expectation that legacy API is skipped when keymap exists.
  - Added scenarios: both APIs, keymap-only, legacy-only, neither API, and dispose safety/idempotency.
- `docs/en/07-tui-interface.md`
  - Clarified dual registration compatibility behavior.
- `docs/es/07-interfaz-tui.md`
  - Clarified dual registration compatibility behavior.
- `openspec/changes/restore-command-palette-focus-sidebar/tasks.md`
  - Marked all tasks complete.
- `openspec/changes/restore-command-palette-focus-sidebar/apply-progress.md`
  - Recorded apply evidence and verification outcomes.

## Verification Evidence

Commands run:

1. `pnpm test`
2. `pnpm typecheck`
3. `pnpm build`

Results:

- ✅ `pnpm test` passed (`6` test files, `86` tests).
- ✅ `pnpm typecheck` passed.
- ✅ `pnpm build` passed (tsup ESM + DTS outputs for runtime and TUI entries).

## Issue #54 Evidence Summary

- Root cause: `registerSubagentCommands` returned immediately after keymap registration, so `api.command.register` never ran when keymap existed, hiding palette entries.
- Fix: switched to additive registration (`keymap.registerLayer` + `command.register` when available), preserved `Alt+B`, and returned one safe idempotent composite disposer.
- Proof: updated `src/tui.test.ts` now asserts dual registration and verifies cleanup for both registrations; also covers partial API availability and no-API no-op safety.

## Deviations From Design

None — implementation matches design.

## Remaining Tasks

None for apply. Ready for SDD verify.
