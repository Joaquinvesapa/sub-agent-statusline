# Archive Report: restore-command-palette-focus-sidebar

## Summary

The change has been archived after successful verification and OpenSpec sync. The main source-of-truth spec was added to `openspec/specs/tui-command-registration/spec.md`, and the completed change folder was moved to the dated archive location.

## Archived Location

`openspec/changes/archive/2026-05-27-restore-command-palette-focus-sidebar/`

## Synced Specs

- `openspec/specs/tui-command-registration/spec.md` — created from the delta spec.

## Archive Contents

- `proposal.md`
- `exploration.md`
- `design.md`
- `tasks.md`
- `apply-progress.md`
- `verify-report.md`
- `archive-report.md`

## Verification Status

- PASS WITH WARNINGS
- Tests, typecheck, build, coverage, and diff hygiene all passed.
- Non-blocking warnings remained:
  - Engram tasks artifact was stale versus OpenSpec tasks/apply-progress.
  - Duplicate-visibility behavior is statically documented and not directly asserted by a test.
  - Unrelated dirty files remain: `package.json`, `api-audit-scout.md`.

## Engram Reconciliation

- The stale Engram tasks artifact was reconciled to match the completed OpenSpec task state.
- This archive report was persisted to Engram under `sdd/restore-command-palette-focus-sidebar/archive-report`.
