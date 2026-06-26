# opencode-subagent-statusline

![Subagents Monitor banner](https://raw.githubusercontent.com/Joaquinvesapa/sub-agent-statusline/main/assets/subagents_monitor_banner.webp)

**Subagent Monitor for OpenCode.**

See what your subagents are doing without losing track of them: running, done, failed, elapsed time, and token/context usage when OpenCode exposes it.

This package works as a **TUI sidebar plugin** for OpenCode.

---

## Why?

When you delegate work to subagents, they can disappear into the background. That is powerful, but it also makes it easy to lose visibility:

- Is the review agent still running?
- Did the test agent finish?
- Which child session failed?
- How much context did a subagent use?

`opencode-subagent-statusline` adds a compact **Subagent Monitor** inside OpenCode so you can keep that information visible while you work.

---

## Screenshot

![Subagent Monitor inside OpenCode](https://raw.githubusercontent.com/Joaquinvesapa/sub-agent-statusline/main/assets/opencode_full.webp)

Focused sidebar view:

![Subagent Monitor sidebar](https://raw.githubusercontent.com/Joaquinvesapa/sub-agent-statusline/main/assets/opencode_sidebar.webp)

---

## Install

Add the plugin to your OpenCode TUI config:

```json
{
  "$schema": "https://opencode.ai/tui.json",
  "plugin": ["opencode-subagent-statusline"]
}
```

Your TUI config usually lives at:

```txt
~/.config/opencode/tui.json
```

Restart OpenCode after editing the file.

---

## What you get

The TUI plugin adds a sidebar section that shows:

- running subagents
- recent completed subagents, with a manual completed history toggle for retained older completions
- failed subagents
- elapsed time
- token/context usage when available

It also adds a small home/footer summary when there is active subagent activity.

## 1.0 public contract

For 1.x releases, the stable user-facing contract is:

- npm package name: `opencode-subagent-statusline`;
- TUI plugin entrypoints: `opencode-subagent-statusline` and `opencode-subagent-statusline/tui`;
- OpenCode `tui.json` plugin configuration;
- visible sidebar and home/footer behavior;
- command palette entry, `Alt+B`, and focused-list navigation;
- local privacy and persistence behavior described in this README;
- Node, peer dependency, and install contract declared in `package.json`.

Experimental or internal surfaces may change in 1.x without a SemVer-major bump:

- `opencode-subagent-statusline/runtime`, intended for diagnostics and file-based runtime experiments;
- diagnostic environment variables;
- exact `state.json` schema and `status.txt` format;
- internal source modules and source-level exports.

Use the TUI plugin entrypoints for normal OpenCode usage.

## Keyboard navigation

Run `Subagents: Focus sidebar list` from the OpenCode command palette, or press
`Alt+B`, to focus the subagent sidebar list without using the mouse. List
navigation shortcuts are handled only while the sidebar list is focused.

| Shortcut           | Action                                                         |
| ------------------ | -------------------------------------------------------------- |
| `Alt+B`            | Toggle focus between the subagent sidebar list and the prompt. |
| `j` / `ArrowDown`  | Move selection to the next visible subagent.                   |
| `k` / `ArrowUp`    | Move selection to the previous visible subagent.               |
| `Enter`            | Open the selected subagent session.                            |
| `c`                | Toggle retained completed history in the sidebar.              |
| `h` / `ArrowLeft`  | Collapse the subagent section.                                 |
| `l` / `ArrowRight` | Expand the subagent section.                                   |
| `Esc`              | Leave list focus mode and return to the prompt.                |

Opening a selected session is a no-op when there is no visible or navigable
subagent.

Click `Σ` in the sidebar aggregate row to toggle completed history with the
mouse. The toggle is not persisted; it resets when OpenCode or the plugin is
reloaded. Completed history is bounded retained history, not a full database:
terminal rows are kept for up to 3 days with a 1,500-row cap, and rows already
pruned from state are not restored.

When a child session is opened from the sidebar, returning with OpenCode `Up`
(`session_parent`) moves keyboard focus to the parent prompt so you can type
immediately.

---

## Documentation

For a deeper explanation of how the plugin works, see the structured docs:

- [English documentation](docs/en/00-index.md)
- [Documentación en español](docs/es/00-indice.md)

They cover installation, architecture, event flow, state/counters, rendering,
TUI behavior, advanced configuration, development/testing, and troubleshooting.

---

## Local development

Install dependencies with lifecycle scripts disabled by default:

```sh
pnpm install --ignore-scripts
```

Build the plugin:

```sh
pnpm build
```

Test the local TUI build by pointing OpenCode directly at `dist/tui.js`:

```json
{
  "$schema": "https://opencode.ai/tui.json",
  "plugin": ["/absolute/path/to/sub-agent-statusline/dist/tui.js"]
}
```

## Development notes

This project ships the OpenCode TUI sidebar plugin from `src/tui.tsx`.

The TUI bundle is built with `tsup` and `esbuild-plugin-solid` in Solid `universal` mode for OpenTUI compatibility.

Package entrypoints:

```txt
opencode-subagent-statusline          -> TUI plugin
opencode-subagent-statusline/tui      -> TUI plugin
opencode-subagent-statusline/runtime  -> experimental/diagnostic runtime mode
```

Useful commands:

```sh
pnpm build
pnpm typecheck
pnpm test
pnpm test:watch
pnpm test:coverage
pnpm pack --dry-run
```

## Security hardening for maintainers

Recommended local npm/pnpm hygiene, following guidance from Gentle AI and Liran Tal:

- install project dependencies with lifecycle scripts disabled when possible, for example `pnpm install --ignore-scripts`;
- consider setting user-level `ignore-scripts=true` for npm/pnpm and temporarily opt in only when a trusted package needs scripts;
- enable dependency age/cooldown policies where supported, for example `npm config set min-release-age 3` or equivalent Renovate/Dependabot cooldowns;
- block or review git, tarball, URL, and other exotic dependency specs, for example `npm config set allow-git none` where supported;
- optionally screen new packages with tools such as `npq` or Socket Firewall before adding them.

These are maintainer/developer controls, not runtime enforcement by this plugin.

Release maintainers should also keep npm trusted publishing/OIDC enabled for this package, require npm 2FA on maintainer accounts, restrict and revoke legacy npm tokens once OIDC publishing is active, and protect the release branch in GitHub.

## Testing

Automated tests use Vitest with `@vitest/coverage-v8`:

```sh
pnpm test
pnpm test:watch
pnpm test:coverage
pnpm typecheck
```

For the testing strategy, file map, examples, and current TUI/e2e boundaries, see
[`docs/testing.md`](docs/testing.md).

---

## Troubleshooting

### The plugin does not show up

Check OpenCode logs:

```sh
grep -n "subagent-statusline\|failed to load tui plugin" ~/.local/share/opencode/log/*.log
```

Then restart OpenCode after changing `tui.json`.

### I installed a new version but OpenCode still behaves like the old one

OpenCode may be using a cached package. Try clearing the cached package directory under:

```txt
~/.cache/opencode/packages/
```

Then restart OpenCode.

### Token/context usage is missing

OpenCode event payloads can vary by version and by event type. The plugin shows token/context usage when it is available and safely omits it when it is not.

## Local privacy and persistence

The plugin persists a local JSON state file and `status.txt` snapshot under `XDG_RUNTIME_DIR` or the system temp directory by default. Those files can include OpenCode-derived subagent titles and summaries, which may contain short fragments derived from prompts or task descriptions. Files are written best-effort with owner-only permissions and atomic temp-file replacement where Node and the host filesystem support them.

`OPENCODE_SUBAGENT_STATUSLINE_STATE` overrides the state file path. Treat that environment variable as trusted local configuration because the plugin will write status data to the configured path.

For token/context backfill, the TUI reads recent local OpenCode SQLite/log data only from the user's OpenCode data directory. Very large log files are skipped to avoid blocking the TUI.

---

## License

MIT
