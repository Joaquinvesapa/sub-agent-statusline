# Advanced configuration

Normal plugin configuration is minimal: add it to OpenCode's `tui.json`. This page documents advanced options for development, diagnostics, debugging, and the runtime file-based mode.

If you only want to use the plugin, you probably do not need to change anything here.

## Basic TUI configuration

Usual file:

```txt
~/.config/opencode/tui.json
```

Minimal content:

```json
{
  "$schema": "https://opencode.ai/tui.json",
  "plugin": ["opencode-subagent-statusline"]
}
```

Local development:

```json
{
  "$schema": "https://opencode.ai/tui.json",
  "plugin": ["/absolute/path/to/sub-agent-statusline/dist/tui.js"]
}
```

## Environment variables

These variables are advanced diagnostic controls. They are not stable public API
for 1.x, except where the README describes user-facing privacy and persistence
behavior.

| Variable | Use | When to touch it |
| --- | --- | --- |
| `OPENCODE_SUBAGENT_STATUSLINE_STATE` | Overrides the `state.json` path. | Tests, debugging, or custom runtime. |
| `OPENCODE_SUBAGENT_STATUSLINE_INSTANCE` | Defines the state instance name. | Avoid process collisions. |
| `OPENCODE_SUBAGENT_STATUSLINE_PRESERVE_STATE=1` | Prevents runtime startup state clearing. | Persistence debugging. |
| `OPENCODE_SUBAGENT_STATUSLINE_COLOR=0` | Disables ANSI colors in text rendering. | Logs or no-color terminals. |
| `NO_COLOR=1` | Standard no-color switch. | CI/log environments. |
| `OPENCODE_SUBAGENT_STATUSLINE_DEBUG_EVENTS` | Enables TUI event JSONL logging. | Investigating OpenCode payloads. |
| `OPENCODE_SUBAGENT_STATUSLINE_OPENCODE_DB` | Overrides the OpenCode SQLite DB path. | Token/context debugging. |
| `OPENCODE_SUBAGENT_STATUSLINE_STALE_RUNNING_MS` | Changes stale-running threshold. | Diagnosing old `running` rows. |
| `XDG_RUNTIME_DIR` | Default base for runtime state. | Linux/custom environments. |
| `XDG_DATA_HOME` | Base for OpenCode data lookup. | Non-standard data paths. |

## State paths

The file locations are documented for diagnostics. The exact `state.json` schema
and `status.txt` format are experimental and may change in 1.x.

Default runtime state path:

```txt
$XDG_RUNTIME_DIR/opencode-subagent-statusline/<instance>/state.json
```

If `XDG_RUNTIME_DIR` is absent, the system temp directory is used.

The runtime plugin may also write:

```txt
status.txt
```

next to `state.json`.

## Instance name

Default instances are usually based on process PID:

```txt
pid-<process.pid>
```

Override it with:

```sh
OPENCODE_SUBAGENT_STATUSLINE_INSTANCE=debug-1 opencode
```

This separates state files between runs.

## Custom state path

```sh
OPENCODE_SUBAGENT_STATUSLINE_STATE=/tmp/subagent-statusline/state.json opencode
```

Useful for tests and reproductions.

## Preserve state

For the runtime plugin:

```sh
OPENCODE_SUBAGENT_STATUSLINE_PRESERVE_STATE=1 opencode
```

Typical use:

- inspect `state.json` across runs;
- reproduce load problems;
- verify persisted-state normalization.

Note: this applies to the runtime/file-based plugin. The TUI keeps its main state in memory and may persist auxiliary snapshots.

## Color

Disable ANSI colors in text output:

```sh
NO_COLOR=1 opencode
```

or:

```sh
OPENCODE_SUBAGENT_STATUSLINE_COLOR=0 opencode
```

This affects text outputs such as `status.txt`, not necessarily OpenTUI visual rendering.

## TUI event debug log

To inspect real OpenCode payloads:

```sh
OPENCODE_SUBAGENT_STATUSLINE_DEBUG_EVENTS=1 opencode
```

The plugin writes JSONL under a temporary path such as:

```txt
$XDG_RUNTIME_DIR/opencode-subagent-statusline/tui-events.log
```

Use with care: event logs can grow quickly and may contain session data.

## OpenCode DB for tokens/context

The TUI can hydrate token/context data from OpenCode's SQLite database.

Override the path with:

```sh
OPENCODE_SUBAGENT_STATUSLINE_OPENCODE_DB=/path/to/opencode.db opencode
```

Without an override, the plugin looks under OpenCode's data dir, usually based on:

```txt
$XDG_DATA_HOME/opencode
```

or:

```txt
~/.local/share/opencode
```

If the DB does not exist, `sqlite3` is missing, or the format does not contain expected data, token hydration fails silently and the UI keeps working.

## Stale-running threshold

Default stale-running threshold is long and conservative: about 10 hours.

Override it with:

```sh
OPENCODE_SUBAGENT_STATUSLINE_STALE_RUNNING_MS=3600000 opencode
```

This sets 1 hour. Avoid aggressive values except for diagnostics.

## Runtime plugin

Runtime mode is experimental/diagnostic in 1.x. Use the TUI plugin for normal
OpenCode usage.

Runtime entrypoint:

```txt
opencode-subagent-statusline/runtime
```

It exports `SubagentStatusline` from the runtime bundle. Source module paths and
source-level exports are internal.

This mode:

- initializes state on disk;
- processes events;
- saves `state.json`;
- writes `status.txt`;
- avoids throwing on malformed events or write errors.

The main user experience remains the TUI plugin.

## TUI vs runtime

| Capability | TUI plugin | Runtime plugin |
| --- | --- | --- |
| Visual sidebar | Yes | No |
| Home footer | Yes | No |
| Navigate to child session | Yes | No |
| Hydration from OpenCode APIs | Yes | No |
| Advanced periodic reconciliation | Yes | No |
| Token hydration from TUI/SQLite/logs | Yes | Limited/not primary |
| `state.json` | Auxiliary snapshot | Main state |
| `status.txt` | Auxiliary snapshot | Main output |

## OpenCode package cache

OpenCode can cache packages.

If a new version was installed but OpenCode still uses an old one, clear:

```txt
~/.cache/opencode/packages/
```

Then restart OpenCode.

## Logs

Check loading problems with:

```sh
grep -n "subagent-statusline\|failed to load tui plugin" ~/.local/share/opencode/log/*.log
```

Look for package resolution, invalid entrypoint, local build, absolute path, or peer dependency errors.

## Peer dependencies

The package declares peers for OpenCode/OpenTUI/Solid:

- `@opencode-ai/plugin`
- `@opentui/core`
- `@opentui/solid`
- `solid-js`

The TUI build externalizes these dependencies. Some issues can therefore depend on the OpenCode host version rather than only plugin code.

## Docs and npm package

`docs/en/` and `docs/es/` are currently repository-facing docs.

With the current `package.json`, npm publishes:

```txt
dist
assets
README.md
```

If docs should ship in the npm package later:

1. add `docs` or specific docs folders to `package.json.files`;
2. run:

   ```sh
   pnpm pack --dry-run
   ```

3. verify the included files.

## Diagnostic checklist

1. Confirm OpenCode loads the expected plugin.
2. Check OpenCode logs.
3. If using a local path, run `pnpm build`.
4. Confirm `tui.json` uses the package name or an absolute `dist/tui.js` path.
5. Clear package cache if an old version appears.
6. Enable `OPENCODE_SUBAGENT_STATUSLINE_DEBUG_EVENTS` if payloads need inspection.
7. Inspect `state.json` when testing the runtime plugin.
8. Do not assume token/context data will always be available.

## Related files

| File | What to inspect |
| --- | --- |
| `src/state.ts` | Paths, persistence, and state env vars. |
| `src/tui.tsx` | Debug events, DB lookup, hydration, stale threshold. |
| `src/index.ts` | Runtime file-based plugin. |
| `src/render.ts` | Color and text rendering. |
| `package.json` | Exports, published files, and peer dependencies. |
| `README.md` | Basic installation and troubleshooting. |
