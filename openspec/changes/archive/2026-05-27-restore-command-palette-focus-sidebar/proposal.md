# Proposal: Restore command palette focus sidebar command

## Intent

Restore command palette visibility for `Subagents: Focus sidebar list` while preserving `Alt+B` via keymap registration and avoiding crashes when deprecated legacy command APIs are absent.

## Scope

### In Scope
- Register keymap layer when available so `Alt+B` and modern command dispatch remain supported.
- Also register legacy `api.command.register` commands when available to restore palette discovery.
- Compose cleanup for all registrations behind the existing single disposer.
- Update tests and docs that currently describe keymap-preferred/legacy-fallback behavior.

### Out of Scope
- Replacing OpenCode command palette internals.
- Removing deprecated API support entirely.
- Adding new shortcuts or command names.

## Capabilities

### New Capabilities
- `tui-command-registration`: TUI command registration behavior for keymap shortcuts, command palette visibility, fallback paths, and cleanup.

### Modified Capabilities
- None.

## Approach

Use compatibility dual-registration: call `api.keymap.registerLayer` when present, then call `api.command.register` when present. Keep command identifiers and callbacks synchronized. Return a composed disposer that safely cleans both registrations exactly once. Keep no-op cleanup when neither API exists.

## Affected Areas

| Area | Impact | Description |
|------|--------|-------------|
| `src/tui-commands.ts` | Modified | Change keymap-only early return into optional dual registration and composed disposal. |
| `src/tui.test.ts` | Modified | Replace “legacy skipped when keymap exists” expectation with dual-registration and cleanup coverage. |
| `src/tui.tsx` | Modified | Confirm existing single disposer contract still holds; likely no behavior change. |
| `docs/en/07-tui-interface.md`, `docs/es/07-interfaz-tui.md`, `README.md` | Modified | Document keymap for shortcuts plus legacy command registration for palette compatibility. |

## Risks

| Risk | Likelihood | Mitigation |
|------|------------|------------|
| Duplicate palette entries if OpenCode surfaces keymap commands too | Medium | Keep identical labels/IDs; document as compatibility and verify in issue context. |
| Deprecated `api.command` changes or disappears | Low | Guard every legacy call with optional chaining and keep keymap path primary. |
| One disposer failure prevents cleanup | Low | Compose cleanup defensively in implementation and test both disposers. |

## Rollback Plan

Revert `src/tui-commands.ts`, related tests, and doc changes to the current keymap-preferred fallback behavior. This restores `Alt+B` while accepting missing palette visibility in affected OpenCode versions.

## Dependencies

- OpenCode runtime exposes `api.keymap.registerLayer` and/or `api.command.register` as optional plugin APIs.

## Success Criteria

- [ ] `Subagents: Focus sidebar list` is registered through legacy command API when available.
- [ ] `Alt+B` still maps to `subagent-statusline.focus-sidebar-list` through keymap registration.
- [ ] Runtimes with only keymap, only legacy command, or neither API do not crash.
- [ ] Tests cover dual registration, fallback behavior, command callbacks, and composed disposal.
