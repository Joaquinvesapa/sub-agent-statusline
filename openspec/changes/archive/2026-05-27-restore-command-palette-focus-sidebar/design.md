# Design: Restore command palette focus sidebar command

## Technical Approach

Modify `registerSubagentCommands` so command registration is additive instead of keymap-preferred early return. The keymap layer remains the primary shortcut path for `Alt+B`; the guarded legacy command registration is also attempted when available so `Subagents: Focus sidebar list` remains visible in command-palette flows. Keep `src/tui.tsx` unchanged unless type fallout appears: it already treats command cleanup as one disposer.

## Architecture Decisions

| Decision | Choice | Alternatives considered | Rationale |
|---|---|---|---|
| Dual registration | Independently call `api.keymap.registerLayer` and `api.command.register` when each function exists. | Keep fallback-only legacy registration; prefer legacy first. | Current early return preserves `Alt+B` but hides palette commands when both APIs exist. Independent guarded calls support keymap+palette compatibility and runtimes with either API. |
| Command object source | Create shared command metadata/callback builders inside `src/tui-commands.ts`. | Duplicate keymap and legacy command objects inline. | The same IDs, titles, descriptions, category, and callbacks must not drift. Legacy needs dynamic toggle title, so share constants and small builders rather than forcing one incompatible object shape. |
| Composite disposer | Return one idempotent disposer that invokes every collected disposer once. | Return nested disposer without idempotency; let exceptions abort cleanup. | `src/tui.tsx` calls one disposer during lifecycle cleanup. Idempotency makes accidental double cleanup safe, and `try/finally`-style iteration should ensure one failing cleanup does not skip the rest. |
| Neither API | Return a no-op disposer. | Throw or warn. | OpenCode API shape is optional in this compatibility area; absence must not crash the TUI. |

## Data Flow

```txt
TUI plugin setup
  -> registerSubagentCommands(input)
     -> build shared command metadata and callbacks
     -> if keymap.registerLayer: register layer with Alt+B binding
     -> if command.register: register palette commands
     -> return composite dispose()
  -> api.lifecycle.onDispose calls composite dispose once
```

## File Changes

| File | Action | Description |
|---|---|---|
| `src/tui-commands.ts` | Modify | Replace early return with optional dual registration, shared command builders, and safe composite disposer. |
| `src/tui.test.ts` | Modify | Update command registration tests for dual and fallback API shapes plus disposer behavior. |
| `src/tui.tsx` | Inspect/no expected change | Existing single-disposer lifecycle contract should remain valid. |
| `docs/en/07-tui-interface.md` | Modify | Replace fallback-only wording with keymap shortcut plus legacy command-palette compatibility. |
| `docs/es/07-interfaz-tui.md` | Modify | Same documentation update in Spanish. |
| `README.md` | Modify if needed | Keep user-facing `Alt+B` and command-palette wording accurate; likely a small note only. |

## Interfaces / Contracts

No public package API changes. Internal contract for `registerSubagentCommands` remains:

```ts
export function registerSubagentCommands(input): TuiCommandDispose;
```

Implementation contract: every optional registration may contribute a disposer; returned cleanup MUST be safe when zero, one, or two registrations occurred and SHOULD ignore repeated calls after first cleanup.

## Testing Strategy

| Layer | What to Test | Approach |
|---|---|---|
| Unit | keymap+legacy | In `src/tui.test.ts`, provide both APIs; assert both are called, `Alt+B` binding targets `subagent-statusline.focus-sidebar-list`, callbacks run, and returned cleanup invokes both disposers. |
| Unit | keymap-only | Assert only `registerLayer` is called, callbacks still toggle/focus, and cleanup calls only keymap disposer. |
| Unit | legacy-only | Assert legacy register receives both commands, focus command has `keybind: "alt+b"`, dynamic toggle title reflects `sectionEnabled`, callbacks work, and cleanup calls legacy disposer. |
| Unit | neither API | Pass `{}`; assert no throw and returned disposer is callable. |
| Unit | disposer safety | Call composite disposer twice and assert underlying disposers each run once; include a throwing disposer case to assert the other disposer still runs if implementation swallows or aggregates cleanup errors. |

## Migration / Rollout

No migration required. Rollout is a small compatibility patch covered by `pnpm test` and `pnpm typecheck`, with manual OpenCode smoke testing for command palette visibility.

## Open Questions

- [ ] Whether OpenCode surfaces keymap-registered commands in the palette on some versions, which could create duplicate entries despite shared IDs/labels.
