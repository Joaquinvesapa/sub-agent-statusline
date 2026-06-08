# Installation and usage

`opencode-subagent-statusline` is installed as an OpenCode TUI plugin. Once active, it adds a subagent section to the sidebar and a compact summary on the home screen when there is activity.

## Quick install

Add the package to OpenCode's TUI configuration file:

```json
{
  "$schema": "https://opencode.ai/tui.json",
  "plugin": ["opencode-subagent-statusline"]
}
```

The usual path is:

```txt
~/.config/opencode/tui.json
```

Then restart OpenCode.

## What you should see

When subagent activity exists, the plugin can show:

- running subagents;
- recently completed subagents;
- failed subagents;
- elapsed duration;
- token/context usage when OpenCode exposes it;
- an aggregate home summary;
- a navigable sidebar list.

Conceptual example:

```txt
Subagentes
  ● Review current diff       00:42
  ✓ Run tests                 01:10
  ✕ Typecheck                 00:08

↳ 1 running · 1 done · 1 error · Σ 3 total
```

Exact text can vary depending on state, OpenCode version, and available event data.

## Test a local build

For local development or testing:

```sh
pnpm install
pnpm build
```

Then point OpenCode at the built file:

```json
{
  "$schema": "https://opencode.ai/tui.json",
  "plugin": ["/absolute/path/to/sub-agent-statusline/dist/tui.js"]
}
```

Use an absolute path. Do not copy only `dist/tui.js` elsewhere unless you understand the dependency/runtime context: the plugin expects to run inside the package/project context or OpenCode's package cache.

## Daily use

The plugin does not require commands to start collecting activity. Once loaded:

1. OpenCode emits session, message, and part events.
2. The plugin detects subagent activity.
3. The sidebar shows relevant rows.
4. The bottom home summary appears when activity or counts exist.
5. If a row has an associated real session, it can be opened from the UI.

## Visible statuses

| Status    | Meaning                                                 |
| --------- | ------------------------------------------------------- |
| `running` | Evidence of active, pending, or in-progress work.       |
| `done`    | The work completed or became idle successfully.         |
| `error`   | Error, failure, cancellation, or abort evidence exists. |

OpenCode can emit many different status words. The plugin normalizes them to these three internal statuses.

## Executed total

The `Σ total` value is not a count of visible rows.

It represents real subagent executions.

These situations are normal:

| Situation                                                   | Correct result                          |
| ----------------------------------------------------------- | --------------------------------------- |
| A `task` wrapper and a real session represent the same work | Count 1.                                |
| There are three internal entries but one visible row        | It may count 1.                         |
| An old `done` row is no longer visible                      | The historical total does not decrease. |
| Tokens/context are missing                                  | The row is shown without those details. |

For details, see [State model and counters](./05-state-model-and-counters.md).

## Basic navigation

The sidebar supports keyboard navigation while the list is focused.

| Shortcut           | Action                                                    |
| ------------------ | --------------------------------------------------------- |
| `Alt+B`            | Toggle focus between the subagent list and the prompt.    |
| `j` / `ArrowDown`  | Move selection to the next visible subagent.              |
| `k` / `ArrowUp`    | Move selection to the previous subagent.                  |
| `Enter`            | Open the selected session, if a navigable session exists. |
| `c`                | Toggle completed history for retained `done` rows.        |
| `h` / `ArrowLeft`  | Collapse the section.                                     |
| `l` / `ArrowRight` | Expand the section.                                       |
| `Esc`              | Leave list focus mode and return to the prompt.           |

You can also use OpenCode's command palette:

```txt
Subagents: Focus sidebar list
Subagents: Toggle sidebar section
Subagents: Toggle completed history
```

## When a row can be opened

A row can be opened when the plugin knows a real `targetSessionID`, usually shaped like `ses_*`.

If a row only comes from a technical wrapper or a subtask without a known session, it may be visible but not navigable yet.

## Tokens and context

The plugin shows token/context details only when it finds reliable evidence.

Possible sources include:

- event payloads;
- live TUI state;
- OpenCode's SQLite database;
- recent logs.

If OpenCode does not expose those details, the plugin omits them without breaking the row.

## Common problems

### The plugin does not show up

Check OpenCode logs:

```sh
grep -n "subagent-statusline\|failed to load tui plugin" ~/.local/share/opencode/log/*.log
```

Then verify:

- `~/.config/opencode/tui.json` is valid JSON;
- the field is named `plugin`;
- OpenCode was restarted;
- a local path, if used, is absolute and points to `dist/tui.js`.

### A new version was installed but the old one still appears

OpenCode can cache packages.

Try clearing:

```txt
~/.cache/opencode/packages/
```

Then restart OpenCode.

### Token/context usage is missing

This can be normal. Availability depends on what OpenCode exposes through events, state, SQLite, or logs.

The plugin is designed to keep working when that information is absent.

## Next reading

For UI behavior and navigation, continue with:

- [TUI interface](./07-tui-interface.md)

For advanced configuration, debugging, and paths:

- [Advanced configuration](./08-advanced-configuration.md)
