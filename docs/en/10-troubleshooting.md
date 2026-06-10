# Troubleshooting

This guide covers common issues when installing, using, or developing `opencode-subagent-statusline`.

General strategy:

> First verify that OpenCode is loading the expected plugin. Then inspect events, state, cache, and available data.

## The plugin does not appear

### 1. Check TUI configuration

Usual file:

```txt
~/.config/opencode/tui.json
```

Minimal configuration:

```json
{
  "$schema": "https://opencode.ai/tui.json",
  "plugin": ["opencode-subagent-statusline"]
}
```

Local build configuration:

```json
{
  "$schema": "https://opencode.ai/tui.json",
  "plugin": ["/absolute/path/to/sub-agent-statusline/dist/tui.js"]
}
```

Verify:

- JSON is valid;
- the field is named `plugin`;
- local paths are absolute;
- `pnpm build` was run before pointing at `dist/tui.js`;
- OpenCode was restarted after config changes.

### 2. Check OpenCode logs

```sh
grep -n "subagent-statusline\|failed to load tui plugin" ~/.local/share/opencode/log/*.log
```

Look for:

- package not found;
- invalid path;
- wrong entrypoint;
- missing peer dependency;
- exception during TUI initialization.

## OpenCode still uses an old version

OpenCode can cache packages.

Try clearing:

```txt
~/.cache/opencode/packages/
```

Then restart OpenCode.

If testing locally, make sure `tui.json` points to local `dist/tui.js`, not the cached npm package.

## Subagents are running but not visible

Possible causes:

1. OpenCode has not emitted an interpretable event yet.
2. Activity belongs to another session, so it is not shown in the current-session sidebar.
3. The row exists but was collapsed with another representation.
4. The session does not have a navigable `targetSessionID` yet.
5. The plugin did not load correctly.

Check:

- OpenCode logs;
- whether the sidebar is enabled;
- whether the section is collapsed;
- whether activity appears in the global home summary or after navigating to the owning session;
- whether `Alt+B` focuses the list;
- whether the issue reproduces with a new delegation.

For deeper debugging:

```sh
OPENCODE_SUBAGENT_STATUSLINE_DEBUG_EVENTS=1 opencode
```

## Fewer rows appear than expected

This may be correct.

The plugin deduplicates technical representations of the same work.

Internal example:

```txt
tool:prt_task
subtask:prt_1
ses_child
```

Visible row:

```txt
Review current diff
```

This prevents `task`/`delegate` wrappers from appearing as duplicate independent subagents.

See:

- [State model and counters](./05-state-model-and-counters.md)
- [Rendering and deduplication](./06-rendering-and-deduplication.md)

## Total does not match visible rows

This can also be correct.

`Σ total` counts real executions, not visible rows. In the sidebar it is scoped
to the current session; in the home summary and text statusline it remains
global across sessions.

| Case | Why it happens |
| --- | --- |
| More internal entries than rows | Rendering collapsed duplicates. |
| Total is larger than visible rows | Old `done` rows were hidden or pruned. |
| A wrapper appears but does not increment | `source: "tool"` is evidence, not execution. |
| A subtask and session count once | Counter reconciled toward the real session. |

## Old subagents remain `running`

The plugin is conservative about closing old rows.

It does not mark a subagent as `done` only because time passed. It first looks for evidence in:

- live TUI state;
- OpenCode session status;
- child messages;
- recent parent activity;
- stale-running threshold.

If a row remains `running`, terminal evidence may not be safe enough yet.

For diagnosis:

```sh
OPENCODE_SUBAGENT_STATUSLINE_STALE_RUNNING_MS=3600000 opencode
```

Avoid very low values as permanent configuration.

## Tokens/context are missing

This is common.

The plugin shows tokens/context only if it finds data in:

- OpenCode events;
- live TUI state;
- OpenCode SQLite;
- recent logs.

If OpenCode does not expose that information or the format changed, the row is shown without tokens.

Optional DB override:

```sh
OPENCODE_SUBAGENT_STATUSLINE_OPENCODE_DB=/path/to/opencode.db opencode
```

Missing token data does not necessarily mean the plugin is broken.

## `Alt+B` does not focus the list

Verify:

1. the plugin loaded;
2. the sidebar is enabled;
3. visible rows or the section exist;
4. OpenCode is not capturing the shortcut elsewhere;
5. the OpenCode version exposes the expected keymap API or legacy fallback.

Try the command palette:

```txt
Subagents: Focus sidebar list
```

If the command works but the shortcut does not, the issue is probably keybinding/focus-layer related.

## `Enter` does not open a session

A row can open only when it has a real navigable session.

Typical condition:

```txt
targetSessionID = "ses_..."
```

Rows from `tool:*`, `subtask:*` without real session, or incomplete evidence may be visible but not navigable.

This is intentional. The UI does not invent a destination session.

## The section disappears or collapses

The TUI stores preferences in `api.kv`:

- `subagents.sidebar.expanded`
- `subagents.sidebar.enabled`

Try:

- `Subagents: Toggle sidebar section`;
- `Alt+B`;
- restarting OpenCode;
- checking whether the issue is session-specific or global.

## Local build does not reflect changes

1. Build:

   ```sh
   pnpm build
   ```

2. Confirm `tui.json` points to:

   ```txt
   /absolute/path/to/sub-agent-statusline/dist/tui.js
   ```

3. Restart OpenCode.
4. If the npm package still appears, check OpenCode cache.

## Tests fail because of state or filesystem

Runtime tests use temp dirs and environment variables.

If a new env var is mutated in tests, restore it in `test/setup.ts`.

For file-writing tests:

- use `createRuntimeHarness()`;
- do not hardcode global paths;
- clean timers/mocks;
- prefer small fixtures.

## Time-based tests are flaky

Use explicit fake timers.

Recommended helper:

```ts
useFrozenTime("2026-01-01T00:00:00.000Z")
```

Avoid relying on the real clock when testing duration, pruning, or stale-running behavior.

## Brittle snapshots

If a snapshot fails because of minor formatting changes, ask whether the whole output is really the contract.

Prefer focused assertions:

```ts
expect(output).toContain("1 running")
expect(output).toContain("Review current diff")
```

Use snapshots only when the complete shape is intentional behavior.

## `pnpm typecheck` passes but package publishing may still be wrong

PR CI runs:

```sh
pnpm typecheck
pnpm test
```

It does not run build or pack dry-run.

If packaging, exports, assets, or `package.json.files` changed, run:

```sh
pnpm build
pnpm pack --dry-run
```

## Docs are not included in npm

With current `package.json`, npm publishes:

```txt
dist
assets
README.md
```

`docs/en/` and `docs/es/` are repository docs and would not be included in the npm package.

If they should be published later, add `docs` or specific folders to `package.json.files` and validate with:

```sh
pnpm pack --dry-run
```

## Enable event logging

```sh
OPENCODE_SUBAGENT_STATUSLINE_DEBUG_EVENTS=1 opencode
```

The log is written as JSONL under runtime/tmp, for example:

```txt
$XDG_RUNTIME_DIR/opencode-subagent-statusline/tui-events.log
```

Caution: it can grow quickly and may include session data.

## Quick checklist

1. Is OpenCode loading the plugin?
2. Does `tui.json` point to the expected package or build?
3. Did you restart OpenCode?
4. Are there log errors?
5. Are you seeing a cached version?
6. Is the sidebar enabled and expanded?
7. Are real subagent events being emitted?
8. Does the item have `targetSessionID` if navigation is expected?
9. Could missing token/context data be normal?
10. Could the behavior be correct deduplication?

## Useful files

| File | When to inspect it |
| --- | --- |
| `README.md` | Basic installation and troubleshooting. |
| `docs/en/02-installation-and-usage.md` | Normal use and local setup. |
| `docs/en/08-advanced-configuration.md` | Environment variables, paths, and debug. |
| `src/events.ts` | If an event is not interpreted. |
| `src/state.ts` | If counting or persistence looks wrong. |
| `src/render.ts` | If rows appear/disappear unexpectedly. |
| `src/reconcile.ts` | If an old `running` row does not close. |
| `src/tui.tsx` | UI, hydration, or navigation problems. |
| `src/tui-commands.ts` | Command or `Alt+B` problems. |
| `test/helpers/runtime-harness.ts` | Filesystem/env test failures. |
