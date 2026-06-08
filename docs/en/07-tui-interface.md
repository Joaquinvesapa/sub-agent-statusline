# TUI interface

The plugin's main interface is a section in the OpenCode sidebar. Its goal is to show subagent activity without pulling you out of your current workflow.

## Visual surfaces

The plugin registers several TUI surfaces:

| Surface | Use |
| --- | --- |
| `sidebar_content` | Main subagent list. |
| `home_bottom` | Compact home-screen summary. |
| `home_prompt` | Prompt wrapper for focus preservation. |
| `session_prompt` | Session prompt wrapper. |

Users mainly interact with `sidebar_content` and `home_bottom`.

## Subagent sidebar

The sidebar shows a compact list of subagent-related work items.

It can include:

- human-readable task title;
- status;
- duration;
- tokens/context when available;
- navigable session indicator;
- current-session or other-session grouping.

Conceptual example:

```txt
Subagentes

● Review current diff        00:42
✓ Run focused tests          01:10 · 1.5k ctx 12%
✕ Typecheck                  00:08
```

## Current session and other sessions

The sidebar tries to prioritize subagents related to the current OpenCode session.

If there are no current-session subagents, or if relevant activity exists elsewhere, it can show activity from other sessions. This helps when navigating between sessions or when hydration reconstructs previous activity.

## Visual statuses

| Internal status | UI meaning |
| --- | --- |
| `running` | Active or pending work. Should remain visible. |
| `done` | Recently completed work. May be hidden later. |
| `error` | Failed work. Should remain visible. |

Old `done` rows may disappear so the sidebar does not become an infinite history.

## Home summary

When relevant activity exists, the plugin can show a compact home summary:

```txt
↳ 1 running · 1 done · 0 error · Σ 2 total
```

This gives a quick signal without opening the sidebar.

## List focus

The sidebar has a focus mode for keyboard navigation.

Main shortcut:

```txt
Alt+B
```

It toggles between:

- focus on the subagent list;
- focus back on the prompt.

When the list is focused, navigation shortcuts apply to the list. Otherwise, the prompt keeps normal control.

## Keyboard shortcuts

| Shortcut | Action |
| --- | --- |
| `Alt+B` | Toggle focus between list and prompt. |
| `j` | Select the next visible subagent. |
| `ArrowDown` | Select the next visible subagent. |
| `k` | Select the previous subagent. |
| `ArrowUp` | Select the previous subagent. |
| `Enter` | Open the selected session if navigable. |
| `c` | Toggle completed history for retained `done` rows. |
| `h` | Collapse the section. |
| `ArrowLeft` | Collapse the section. |
| `l` | Expand the section. |
| `ArrowRight` | Expand the section. |
| `Esc` | Leave list focus mode and return to the prompt. |

## Registered commands

| Command | Action |
| --- | --- |
| `Subagents: Focus sidebar list` | Focus the subagent list. |
| `Subagents: Toggle sidebar section` | Enable or disable the section. |
| `Subagents: Toggle completed history` | Toggle retained completed rows in the sidebar. |

Internally, the plugin registers both APIs when available: `keymap.registerLayer`
keeps `Alt+B` dispatch fast, and `command.register` keeps commands visible in the
OpenCode command palette. If only one API exists, the plugin safely uses that one.

## Opening a child session

`Enter` or click can open a child session when the row has a navigable `targetSessionID`.

Typical condition:

```txt
targetSessionID = "ses_..."
```

If the plugin only knows a `tool:*` wrapper or a subtask without a real session, the row may be visible but not navigable.

When a child session is opened from this sidebar list, returning with OpenCode
`Up` (`session_parent`) shifts keyboard focus to the parent prompt instead of
keeping list focus.

## Expansion and preferences

The section can be expanded/collapsed and enabled/disabled.

Clicking `Σ`, pressing `c` while the list is focused, or running
`Subagents: Toggle completed history` toggles completed history. This shows
retained stale `done` rows and retained `done` rows that are unrelated to active
work. The toggle is transient and is not stored in `api.kv`.

Preferences are stored through OpenCode `api.kv`:

| Preference | Use |
| --- | --- |
| `subagents.sidebar.expanded` | Remembers whether the section is expanded. |
| `subagents.sidebar.enabled` | Remembers whether the section is enabled. |

These preferences belong to the TUI environment, not the runtime plugin's `state.json`.

Completed history is bounded by state retention: terminal rows are retained for
up to 3 days with a 1,500-row cap. Rows already pruned from state are not
restored.

## Scroll and selection

Expected behavior:

- selection moves within visible rows;
- if a row disappears because of deduplication/filtering, selection adjusts;
- scroll tries to preserve context;
- `Esc` returns control to the prompt.

## Relation to deduplication

The sidebar consumes rows after render/deduplication processing.

Example:

```txt
Internal state:
- tool:prt_task
- subtask:prt_1
- ses_child

Sidebar:
- Review current diff
```

The UI answers “what delegated work is happening?”, not “how many technical signals arrived?”.

## Tokens/context

Rows can show compact context usage when data exists:

```txt
1.5k ctx 12%
12.3% used
```

Missing data means only that OpenCode or available sources did not expose it to the plugin.

## Hydration

When changing sessions, the TUI tries to reconstruct previous subagents through OpenCode APIs.

```txt
route/session change
  ↓
query children/messages/status
  ↓
create internal synthetic events
  ↓
apply normal pipeline
  ↓
update sidebar
```

This lets the sidebar show activity that happened before the plugin saw live events in the current session.

## Periodic maintenance

The TUI periodically:

- refreshes visible duration;
- tries to hydrate tokens/context;
- persists auxiliary snapshots;
- reconciles old `running` subagents.

Reconciliation is conservative: old rows are not closed by time alone.

## Current limits

The state/render/command logic that feeds the UI is tested, but there is no deep E2E automation for the complete visual UI inside OpenCode/OpenTUI.

Automatically covered:

- command registration;
- legacy command fallback;
- `Alt+B` binding;
- state/render/reconcile logic feeding the UI.

For full visual changes, run a manual OpenCode smoke test.

## Suggested manual smoke test

1. Build locally:

   ```sh
   pnpm build
   ```

2. Configure OpenCode with an absolute path to `dist/tui.js`.
3. Restart OpenCode.
4. Run a delegation/subagent.
5. Verify it appears in the sidebar.
6. Test `Alt+B`.
7. Test `j/k`, arrows, `c`, and `Esc`.
8. Click `Σ` and verify completed history toggles.
9. If a row is navigable, test `Enter`.
10. Confirm recent completions appear without polluting the default view indefinitely.

## Related files

| File | What to inspect |
| --- | --- |
| `src/tui.tsx` | UI, slots, hydration, reconciliation, and navigation. |
| `src/tui-commands.ts` | Commands and keybindings. |
| `src/render.ts` | Visible rows and deduplication before UI. |
| `src/tui.test.ts` | Command registration tests. |
| `README.md` | User shortcut table. |
