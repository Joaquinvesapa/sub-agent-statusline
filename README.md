# Subagent Monitor

![Subagents Monitor banner](https://raw.githubusercontent.com/Joaquinvesapa/sub-agent-statusline/main/assets/subagents_monitor_banner.webp)

See delegated work without leaving OpenCode. **Subagent Monitor** is an MIT-licensed OpenCode TUI sidebar plugin that keeps running, completed, and failed subagents visible, with elapsed time and token/context usage when OpenCode provides it.

[![npm version](https://img.shields.io/npm/v/opencode-subagent-statusline?style=flat-square)](https://www.npmjs.com/package/opencode-subagent-statusline)
[![monthly npm downloads](https://img.shields.io/npm/dm/opencode-subagent-statusline?style=flat-square)](https://www.npmjs.com/package/opencode-subagent-statusline)
[![GitHub stars](https://img.shields.io/github/stars/Joaquinvesapa/sub-agent-statusline?style=flat-square)](https://github.com/Joaquinvesapa/sub-agent-statusline)
[![license](https://img.shields.io/github/license/Joaquinvesapa/sub-agent-statusline?style=flat-square)](LICENSE)

## Install

Pick the section that matches your OpenCode version. The 2.x line is published under the `next`
npm tag; the 1.x line stays on `latest` until V2 is promoted. The package requires Node `>=22.13`.

### OpenCode 2

The intended configuration for the 2.x line once the prerelease is published — a plain package
entry, no path:

```json
{
  "$schema": "https://opencode.ai/v2/cli.json",
  "plugins": ["opencode-subagent-statusline@next"]
}
```

The configuration usually lives at:

```txt
~/.config/opencode/cli.json
```

Restart OpenCode after saving the file. The entry resolves the package's `./tui` export, which in
the 2.x line ships the native V2 plugin. Until the `@next` prerelease is published and the
package-name installation flow is verified, use the directory entry below.

**Directory entry (available today):** OpenCode 2.x loads a CLI plugin by resolving
`<directory>/tui`; it never consults a package subpath. Point `cli.json` at a directory that
carries the built V2 module:

```json
{
  "$schema": "https://opencode.ai/v2/cli.json",
  "plugins": ["/absolute/path/to/opencode-subagent-statusline/v2"]
}
```

The repository ships `v2/tui.js`, which re-exports the built V2 bundle, so a local clone after
`pnpm build` (or an npm install, via `<...>/node_modules/opencode-subagent-statusline/v2`) loads
with the path above. The host injects `@opentui/core`, `@opentui/solid`, `solid-js` and
`@opencode/plugin/tui` at runtime, so no `node_modules` is needed beside the entry. Keep the
directory outside the config `plugins/` directory, which is the server-plugin discovery path.

### OpenCode 1

Stay on the 1.x release line with an exact version pin:

```json
{
  "$schema": "https://opencode.ai/tui.json",
  "plugin": ["opencode-subagent-statusline@1.3.0"]
}
```

The configuration usually lives at:

```txt
~/.config/opencode/tui.json
```

Restart OpenCode after saving the file. An exact pin requires a manual update to receive later
1.x fixes. Once the `legacy` dist-tag is available, `opencode-subagent-statusline@legacy` can be
used the same way.

### Migration for unpinned entries

An unversioned `opencode-subagent-statusline` entry follows the `latest` tag. While V2 is
published only under `next`, `latest` is still the 1.x line; once V2 is promoted to `latest`,
unpinned setups on OpenCode 1 would receive the V2 plugin and stop working there. Pin an exact
1.x version (or adopt the `legacy` tag when available) before that switch. See the OpenCode
[V1 to V2 migration guide](https://opencode.ai/v2/docs/build/plugins/migrate-v1) for plugin
migration details.

## Why Subagent Monitor?

Delegating work is powerful, but child sessions can disappear into the background. Without a visible status surface, you have to guess:

- Is the review agent still running?
- Did the test agent finish?
- Which child session failed?
- How much context did a subagent use?

Subagent Monitor restores that visibility inside OpenCode, so you can keep working while still knowing what your delegated agents are doing.

## What you get

The sidebar shows:

- running subagents;
- recent completed subagents;
- failed subagents;
- elapsed time;
- token/context usage when available.

When subagent activity is active, the plugin also adds a compact summary to the home/footer area.

## Built with Gentle AI

Subagent Monitor was built with [Gentle AI](https://github.com/Gentleman-Programming/gentle-ai#built-with-gentle-ai).

<a href="https://github.com/Gentleman-Programming/gentle-ai">
  <img width="220" src="https://raw.githubusercontent.com/Gentleman-Programming/gentle-ai/main/docs/assets/brand/built-with-gentle-ai.png" alt="Built with Gentle-AI" />
</a>

## Gentle AI integration

[Gentle AI](https://github.com/Gentleman-Programming/gentle-ai) offers Subagent Monitor as an optional OpenCode community plugin. Select and install it through Gentle AI to add the selected plugin to OpenCode's `tui.json`, or install this package directly using the configuration above.

This integration is optional. Subagent Monitor remains an independently installable OpenCode plugin.

## Screenshots

Full OpenCode context with demo content in Spanish:

![Subagent Monitor in the full OpenCode view](https://raw.githubusercontent.com/Joaquinvesapa/sub-agent-statusline/main/assets/opencode_full.webp)

Focused sidebar view:

![Subagent Monitor focused sidebar](https://raw.githubusercontent.com/Joaquinvesapa/sub-agent-statusline/main/assets/opencode_sidebar.webp)

## Keyboard navigation

Run `Subagents: Focus sidebar list` from the OpenCode command palette, or press `Alt+B`, to focus the subagent sidebar list without using the mouse. List navigation shortcuts are handled only while the sidebar list is focused.

| Shortcut | Action |
| --- | --- |
| `Alt+B` | Toggle focus between the subagent sidebar list and the prompt. |
| `j` / `ArrowDown` | Move selection to the next visible subagent. |
| `k` / `ArrowUp` | Move selection to the previous visible subagent. |
| `Enter` | Open the selected subagent session. |
| `c` | Toggle retained completed history in the sidebar. |
| `h` / `ArrowLeft` | Collapse the subagent section. |
| `l` / `ArrowRight` | Expand the subagent section. |
| `Esc` | Leave list focus mode and return to the prompt. |

Opening a selected session is a no-op when there is no visible or navigable subagent.

Click `Σ` in the sidebar aggregate row to toggle completed history with the mouse. The toggle is not persisted; it resets when OpenCode or the plugin is reloaded. Completed history is bounded retained history, not a full database: terminal rows are kept for up to 3 days with a 1,500-row cap, and rows already pruned from state are not restored.

When a child session is opened from the sidebar, returning with OpenCode `Up` (`session_parent`) moves keyboard focus to the parent prompt so you can type immediately.

<details>
<summary>Stable 1.x public contract</summary>

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

</details>

## Documentation

For deeper installation, architecture, event-flow, state, rendering, TUI, configuration, testing, and troubleshooting details:

- [English documentation](docs/en/00-index.md)
- [Documentación en español](docs/es/00-indice.md)
- [Testing strategy](docs/testing.md)

## Troubleshooting

### The plugin does not show up

Check OpenCode logs:

```sh
grep -n "subagent-statusline\|failed to load tui plugin" ~/.local/share/opencode/log/*.log
```

Then restart OpenCode after changing the plugin configuration file (`tui.json` on OpenCode 1,
`cli.json` on OpenCode 2).

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

<details>
<summary>Development and testing</summary>

Install dependencies with lifecycle scripts disabled by default:

```sh
pnpm install --ignore-scripts
```

Build the plugin:

```sh
pnpm build
```

Test a local V1 build by pointing OpenCode 1 directly at `dist/tui.js`:

```json
{
  "$schema": "https://opencode.ai/tui.json",
  "plugin": ["/absolute/path/to/sub-agent-statusline/dist/tui.js"]
}
```

Test a local V2 build by pointing OpenCode 2 at the repository's `v2/` directory:

```json
{
  "$schema": "https://opencode.ai/v2/cli.json",
  "plugins": ["/absolute/path/to/sub-agent-statusline/v2"]
}
```

This project ships the OpenCode V1 TUI sidebar plugin from `src/tui.tsx` and the native V2 plugin
from `src/v2/`. Both bundles are built with `tsup` and `esbuild-plugin-solid` in Solid `universal`
mode for OpenTUI compatibility.

Package entrypoints:

```txt
opencode-subagent-statusline          -> TUI plugin (2.x line: native V2 entry)
opencode-subagent-statusline/tui      -> TUI plugin (same V2 entry)
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

Automated tests use Vitest with `@vitest/coverage-v8`. For the testing strategy, file map, examples, and current TUI/e2e boundaries, see [`docs/testing.md`](docs/testing.md).

</details>

<details>
<summary>Security hardening for maintainers</summary>

Recommended local npm/pnpm hygiene, following guidance from Gentle AI and Liran Tal:

- install project dependencies with lifecycle scripts disabled when possible, for example `pnpm install --ignore-scripts`;
- consider setting user-level `ignore-scripts=true` for npm/pnpm and temporarily opt in only when a trusted package needs scripts;
- enable dependency age/cooldown policies where supported, for example `npm config set min-release-age 3` or equivalent Renovate/Dependabot cooldowns;
- block or review git, tarball, URL, and other exotic dependency specs, for example `npm config set allow-git none` where supported;
- optionally screen new packages with tools such as `npq` or Socket Firewall before adding them.

These are maintainer/developer controls, not runtime enforcement by this plugin.

Release maintainers should keep the repository `NPM_TOKEN` secret restricted, retain npm provenance, require npm 2FA on maintainer accounts, and protect the release branch in GitHub. See the [release process](docs/releasing.md) for the tag and recovery gates.

</details>

## Community and releases

- [npm package](https://www.npmjs.com/package/opencode-subagent-statusline)
- [GitHub repository](https://github.com/Joaquinvesapa/sub-agent-statusline)
- [Releases](https://github.com/Joaquinvesapa/sub-agent-statusline/releases)
- [Issues](https://github.com/Joaquinvesapa/sub-agent-statusline/issues)
- [Contributing](CONTRIBUTING.md)
- [Code of Conduct](CODE_OF_CONDUCT.md)
- [Security policy](SECURITY.md)

## License

[MIT](LICENSE)
