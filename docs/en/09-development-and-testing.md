# Development and testing

This guide explains how to set up the project locally, which commands to run, and how to think about tests for `opencode-subagent-statusline`.

Practical rule:

> The deterministic core is tested with Vitest. The full UI inside the OpenCode/OpenTUI host is validated with manual smoke tests when visual behavior changes.

## Requirements

According to `CONTRIBUTING.md`, the project expects:

- Node.js 20+
- pnpm 9+

Note: PR CI uses pnpm 10, while contribution docs say pnpm 9+. For normal development, use pnpm 9+ and respect the lockfile.

## Local install

```sh
pnpm install
```

## Main commands

| Command | Purpose |
| --- | --- |
| `pnpm build` | Build the package with `tsup`. |
| `pnpm dev` | Run `tsup --watch`. |
| `pnpm typecheck` | Run TypeScript checks without emitting files. |
| `pnpm test` | Run the Vitest suite once. |
| `pnpm test:watch` | Run Vitest in watch mode. |
| `pnpm test:coverage` | Generate V8 coverage. |
| `pnpm pack --dry-run` | Simulate the npm package contents. |

Recommended pre-PR checklist:

```sh
pnpm typecheck
pnpm test
pnpm build
```

If packaging or published files changed:

```sh
pnpm pack --dry-run
```

## Build outputs

`tsup.config.ts` creates two main outputs:

| Source | Output | Use |
| --- | --- | --- |
| `src/tui.tsx` | `dist/tui.js` + types | Main TUI plugin. |
| `src/index.ts` | `dist/index.js` + types | Runtime file-based plugin. |

Package entrypoints:

```txt
opencode-subagent-statusline
opencode-subagent-statusline/tui
opencode-subagent-statusline/runtime
```

## TypeScript files

| File | Role |
| --- | --- |
| `tsconfig.json` | Base source config. NodeNext, ES2022, strict, JSX for `@opentui/solid`. |
| `tsconfig.test.json` | Test config for Vitest and setup files. |
| `tsup.config.ts` | Runtime and TUI build config. |

## Test strategy

The project uses Vitest with two main layers:

1. **Unit tests** for deterministic logic.
2. **Runtime integration tests** for filesystem and OpenCode-style event handling.

Deep visual TUI E2E automation is intentionally deferred to avoid brittle host-driven tests.

## Test map

| File | Validates |
| --- | --- |
| `src/events.test.ts` | Event parsing, ID extraction, correlation, malformed payload safety. |
| `src/state.test.ts` | State, counters, transitions, pruning, persistence, normalization. |
| `src/render.test.ts` | Text rendering, collapse, visibility, duration, tokens, color/no-color. |
| `src/reconcile.test.ts` | Status normalization, stale-running, backoff, fail-closed behavior. |
| `src/text-width.test.ts` | Terminal column width for CJK/full-width text, combining marks, and truncation. |
| `src/tui.test.ts` | Command registration, `Alt+B` keybinding, legacy fallback. |
| `test/index.integration.test.ts` | Runtime plugin, `state.json`, `status.txt`, preserve-state, filesystem failures. |
| `test/helpers/runtime-harness.ts` | Helpers for temp dirs, fixtures, env vars, and fake time. |
| `test/setup.ts` | Global cleanup for timers, mocks, env vars, and temp dirs. |

## Coverage

Configured in `vitest.config.ts`:

```ts
coverage: {
  provider: "v8",
  reporter: ["text", "lcov"],
  include: ["src/**/*.ts"],
  exclude: ["src/**/*.test.ts", "src/tui.tsx"],
}
```

Important:

> `src/tui.tsx` is excluded from coverage. Do not claim the complete visual TUI is automatically covered.

Coverage focuses on deterministic `.ts` modules: events, state, render, reconcile, text width helpers, commands, and runtime.

## Arrange / Act / Assert

Tests should follow this structure:

```ts
it("persists a supported event", async () => {
  // Arrange
  const harness = await createRuntimeHarness();
  const plugin = await SubagentStatusline({} as Parameters<typeof SubagentStatusline>[0]);
  const event = await readJsonFixture("session-created");

  // Act
  await plugin.event?.({ event } as never);

  // Assert
  const state = await readRuntimeState(harness.statePath);
  expect(state.children.ses_child_1.status).toBe("running");
});
```

Prefer semantic assertions over large snapshots.

Good:

```ts
expect(output).toContain("1 running");
expect(output).toContain("Review auth changes");
```

More brittle:

```ts
expect(output).toMatchSnapshot();
```

## Adding a unit test

1. Identify the behavior to protect.
2. Pick the colocated test file:
   - `src/events.test.ts`
   - `src/state.test.ts`
   - `src/render.test.ts`
   - `src/reconcile.test.ts`
   - `src/tui.test.ts`
3. Build minimal inputs.
4. Call the public function or helper under test.
5. Assert visible behavior, not accidental implementation detail.

Conceptual example:

```ts
it("does not count tool wrappers", () => {
  const state = createEmptyState();

  upsertRunningChild(state, {
    id: "tool:prt_1",
    source: "tool",
  });

  expect(state.totalExecuted).toBe(0);
});
```

## Adding a runtime integration test

Integration tests live in `test/**/*.integration.test.ts`.

Use the harness to isolate filesystem and env vars:

```ts
it("writes runtime output after an event", async () => {
  const harness = await createRuntimeHarness();
  const plugin = await SubagentStatusline({} as Parameters<typeof SubagentStatusline>[0]);
  const event = await readJsonFixture("session-created");

  await plugin.event?.({ event } as never);

  expect(await readStatusText(harness.textPath)).toContain("Review auth changes");
});
```

Useful helpers:

| Helper | Use |
| --- | --- |
| `createRuntimeHarness()` | Creates temp dir and isolated state. |
| `readJsonFixture(name)` | Reads `test/fixtures/events/<name>.json`. |
| `readRuntimeState(path)` | Reads `state.json`. |
| `readStatusText(path)` | Reads `status.txt`. |
| `pathExists(path)` | Checks existence without throwing. |
| `useFrozenTime(iso)` | Freezes time with fake timers. |

## Fixtures

Fixtures live in:

```txt
test/fixtures/events/
```

Keep them small and representative. Avoid huge dumps unless payload size is part of the behavior under test.

## Fake timers

For time-dependent tests:

- freeze time explicitly in Arrange;
- avoid shared global state;
- let `test/setup.ts` restore real timers after the test.

```ts
useFrozenTime("2026-01-01T00:00:00.000Z");
```

## Test environment variables

`test/setup.ts` restores plugin env vars after each test.

If a new env var is mutated by tests, add it to the cleanup list in `test/setup.ts`.

## What not to test yet

Do not add deep automation yet for:

- full OpenTUI visual snapshots;
- complete host-driven OpenCode navigation;
- broad E2E over `src/tui.tsx`.

For real UI changes, prefer:

1. unit tests for extractable logic;
2. command tests if registration/keybindings changed;
3. manual OpenCode smoke test.

## Manual TUI smoke test

When changing `src/tui.tsx`, `src/render.ts`, or visible behavior:

1. Build:

   ```sh
   pnpm build
   ```

2. Configure OpenCode with an absolute path:

   ```json
   {
     "$schema": "https://opencode.ai/tui.json",
     "plugin": ["/absolute/path/to/sub-agent-statusline/dist/tui.js"]
   }
   ```

3. Restart OpenCode.
4. Run a delegation/subagent.
5. Verify sidebar, statuses, and duration.
6. Test `Alt+B`, `j/k`, arrows, `Enter`, and `Esc`.
7. If token/context data exists, confirm it does not break the row.
8. Check logs if the plugin does not load.

## CI

PR workflow: `.github/workflows/ci.yml`.

It runs:

```sh
pnpm install --frozen-lockfile
pnpm typecheck
pnpm test
```

It does not run `pnpm build` or `pnpm pack --dry-run`.

If your change touches build, package exports, published assets, or `package.json.files`, run those commands manually.

## Contribution practices

From `CONTRIBUTING.md`:

- prefer issue-first for non-trivial changes;
- keep PRs small and reviewable;
- use Conventional Commits;
- never commit secrets;
- explain what changed, why, and how it was validated.

Example commits:

```txt
feat: add runtime summary grouping
fix: handle missing token metadata
docs: clarify local setup
```

## Quick checklist by change type

| Change | Minimum recommended validation |
| --- | --- |
| Docs only | Check links and Markdown formatting. |
| Events/state/render | `pnpm test`, focused tests. |
| TypeScript/API | `pnpm typecheck`, `pnpm test`. |
| Visual TUI | `pnpm build`, manual OpenCode smoke test. |
| Packaging | `pnpm build`, `pnpm pack --dry-run`. |
| CI/release | Review workflows and document impact. |
