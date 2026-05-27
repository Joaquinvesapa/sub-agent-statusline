## Exploration: restore-command-palette-focus-sidebar

### Current State
`registerSubagentCommands()` in `src/tui-commands.ts` currently treats `api.keymap.registerLayer` as the preferred path and returns immediately after registering a keymap layer. The legacy `api.command.register` path is used only when keymap registration is unavailable.

The keymap layer registers both subagent commands plus the `Alt+B` binding for `subagent-statusline.focus-sidebar-list`. The legacy path registers the same command values for the command palette and includes `keybind: "alt+b"` on the focus command. OpenCode plugin types in `@opencode-ai/plugin@1.14.50` mark `api.command` as deprecated and recommend `api.keymap.registerLayer`, but still expose `command?: TuiCommandApi`; this means both APIs can exist in the same runtime. Issue #54 suggests the keymap layer keeps shortcut support but may not make plugin commands visible in the palette for the affected OpenCode version.

### Affected Areas
- `src/tui-commands.ts` — owns the branching between keymap and legacy command registration, command identifiers, titles, callbacks, keybinding metadata, and returned disposer.
- `src/tui.test.ts` — currently asserts that legacy command registration is not called when keymap registration exists; this test encodes the behavior suspected to cause the palette regression.
- `src/tui.tsx` — calls `registerSubagentCommands()` once during TUI initialization and stores a single disposer, so any combined-registration approach must preserve one cleanup function.
- `docs/en/07-tui-interface.md` and `docs/es/07-interfaz-tui.md` — currently document a keymap-preferred/legacy-fallback model that would become inaccurate if both paths are registered.
- `README.md` and installation/troubleshooting docs — mention command palette access and may need a small clarification if command palette visibility is intentionally restored via the legacy command API.

### Approaches
1. **Dual-register keymap and legacy command APIs when both are available** — Register the keymap layer for modern command dispatch/keybinding support and also register legacy commands for command palette visibility.
   - Pros: Directly addresses the suspected palette source while preserving `Alt+B`; works with runtimes where both APIs exist; keeps fallback behavior for old runtimes.
   - Cons: If OpenCode now merges keymap commands into the palette, duplicate palette entries are possible; both APIs expose the same command names/values, so duplicate command metadata must stay synchronized.
   - Effort: Low

2. **Prefer legacy command API and use keymap only for binding** — Register legacy commands whenever available and register a keymap layer only for `Alt+B` binding/modern dispatch.
   - Pros: Makes command palette visibility the primary contract; reduces reliance on keymap command discovery.
   - Cons: More awkward because keymap bindings reference command names from the keymap layer; omitting keymap commands may break dispatch, while including them recreates dual registration; leans on a deprecated API as the primary source.
   - Effort: Medium

3. **Keep keymap-only behavior and document/diagnose OpenCode limitation** — Do not change registration; update troubleshooting to explain that the command may not appear in some palettes.
   - Pros: Aligns with OpenCode’s deprecation guidance; avoids duplicate command risk.
   - Cons: Does not fix issue #54; contradicts README/docs that tell users to run the command from the palette.
   - Effort: Low

### Recommendation
Proceed with Approach 1 in later phases: register the keymap layer when available and also register legacy commands when `api.command.register` exists. Return a composed disposer that calls both disposers exactly once. Keep the legacy-only path for runtimes without keymap support, and keep the no-op disposer when neither API exists.

This approach best matches the user-visible contract: `Alt+B` continues to work through keymap registration, while `Subagents: Focus sidebar list` is restored to the palette for OpenCode versions whose palette still reads `api.command.register`. Tests should explicitly cover both APIs being called together and cleanup of both registrations.

### Risks
- Duplicate command palette entries may appear if an OpenCode version surfaces both keymap-layer commands and legacy commands in the same palette.
- Duplicate keybinding display may appear if legacy `keybind` metadata and keymap bindings are both rendered by the host.
- Disposal must be composed defensively so one failing disposer does not prevent the other from running, or at minimum tests must lock the expected cleanup behavior.
- Legacy `api.command` is deprecated in the installed plugin types, so this should be framed as compatibility restoration rather than a long-term primary API.

### Ready for Proposal
Yes — propose a compatibility fix that dual-registers commands through both APIs when available, with tests for combined registration, command callback behavior, fallback behavior, and composed disposal. Documentation should be updated to describe that the plugin uses keymap registration for shortcuts/modern dispatch and legacy command registration when available to preserve command palette visibility.
