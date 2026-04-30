# Testing

This project uses **Vitest** for automated tests and **@vitest/coverage-v8** for coverage reports. The goal is to keep the fast, deterministic behavior covered in tests while avoiding brittle host-driven TUI automation too early.

## Strategy overview

The suite has two layers:

- **Unit tests** cover pure logic in `src/events.ts`, `src/state.ts`, and `src/render.ts`. These tests should be fast, table-friendly, and focused on behavior: parsed session data, state transitions, counters, formatting, and safe handling of malformed input.
- **Runtime integration tests** cover `src/index.ts`, where the plugin touches the filesystem and OpenCode-style event handling. These tests instantiate the plugin against isolated temporary directories and assert persisted state/output.

Deep TUI and full OpenCode host end-to-end automation are intentionally deferred. The current priority is a reliable core runtime layer before adding expensive or brittle UI automation.

## Test file map

| File                              | What it validates                                                                                                                                                  |
| --------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `src/events.test.ts`              | Event parsing, session ID extraction, event-to-state updates, details/token normalization, and malformed event safety.                                             |
| `src/state.test.ts`               | State invariants, counters, transitions, pruning, persistence helpers, environment path resolution, and detail merging.                                            |
| `src/render.test.ts`              | Statusline rendering, visibility rules, collapse behavior, duration/token formatting, and color/no-color output semantics.                                         |
| `test/index.integration.test.ts`  | Runtime plugin initialization, event handling, `state.json` persistence, `status.txt` writes, preserve-state behavior, malformed events, and write-failure safety. |
| `test/helpers/runtime-harness.ts` | Reusable helpers for temp dirs, env overrides, fixtures, filesystem assertions, and fake-time setup.                                                               |
| `test/setup.ts`                   | Global cleanup after each test: timers, mocks, selected env vars, and registered temp directories.                                                                 |
| `test/fixtures/events/*.json`     | Canonical valid and malformed event payloads used by tests.                                                                                                        |

## Arrange / Act / Assert

Use the **Arrange / Act / Assert** pattern to keep tests readable:

```ts
it("persists a supported event", async () => {
  // Arrange
  const harness = await createRuntimeHarness();
  const plugin = await SubagentStatusline(
    {} as Parameters<typeof SubagentStatusline>[0],
  );
  const event = await readJsonFixture("session-created");

  // Act
  await plugin.event?.({ event } as never);

  // Assert
  const state = await readRuntimeState(harness.statePath);
  expect(state.children.ses_child_1.status).toBe("running");
});
```

Keep assertions semantic. Prefer checking meaningful counters, titles, statuses, file contents, or rendered text over snapshots of large objects.

## Running tests

Install dependencies first:

```sh
pnpm install
```

Run the full suite once:

```sh
pnpm test
```

Run tests in watch mode while developing:

```sh
pnpm test:watch
```

Generate coverage:

```sh
pnpm test:coverage
```

Run TypeScript checks:

```sh
pnpm typecheck
```

## Adding a unit test

1. Pick the module behavior you want to protect.
2. Add or extend the co-located test file: `src/events.test.ts`, `src/state.test.ts`, or `src/render.test.ts`.
3. Arrange minimal inputs. Reuse existing helpers or fixtures only when they make the test clearer.
4. Act by calling the public function under test.
5. Assert behavior, not implementation details.

Example shape:

```ts
it("renders an empty summary", () => {
  const state = createEmptyState();

  const output = renderStatusline(state);

  expect(output).toContain("0 running");
  expect(output).toContain("0 done");
});
```

If a case depends on time, use `useFrozenTime(...)` from `test/helpers/runtime-harness.ts` or Vitest fake timers directly, and let `test/setup.ts` restore real timers after the test.

## Adding a runtime integration test

Runtime integration tests should live in `test/index.integration.test.ts` or another `test/*.integration.test.ts` file.

Use the harness so each test gets isolated filesystem state:

```ts
it("writes runtime output after an event", async () => {
  const harness = await createRuntimeHarness();
  const plugin = await SubagentStatusline(
    {} as Parameters<typeof SubagentStatusline>[0],
  );
  const event = await readJsonFixture("session-created");

  await plugin.event?.({ event } as never);

  expect(await readStatusText(harness.textPath)).toContain(
    "Review auth changes",
  );
});
```

Useful helpers:

- `createRuntimeHarness({ preserveState?: boolean })` creates a temp directory and sets the plugin env vars for that test.
- `readJsonFixture(name)` loads `test/fixtures/events/<name>.json`.
- `readRuntimeState(path)` reads persisted `state.json`.
- `readStatusText(path)` reads persisted status text.
- `pathExists(path)` checks filesystem output without throwing.
- `useFrozenTime(isoTimestamp)` enables fake timers and pins the current time.

Add new event fixtures under `test/fixtures/events/` when the same payload is useful across tests. Keep fixtures small and representative.

## What not to test yet

Do not add deep TUI/e2e automation for `src/tui.tsx` yet. Full OpenCode host automation, visual snapshots, and broad OpenTUI rendering assertions are deferred until the runtime layer and future TUI seams are stable.

For now, prefer:

- unit tests for pure formatting and state behavior;
- integration tests for plugin runtime persistence and event handling;
- manual smoke testing in OpenCode when changing the actual TUI surface.

## Troubleshooting and gotchas

### Fake timers

If a test uses fake timers, make sure it is explicit in the Arrange step. `test/setup.ts` calls `vi.useRealTimers()` after each test, but a test should still avoid leaking timer state through shared module-level values.

### Temporary directories

Use `createRuntimeHarness()` instead of hard-coded paths. It registers temp directories for cleanup and points `OPENCODE_SUBAGENT_STATUSLINE_STATE` at an isolated `state.json`.

### Environment variables

The setup file restores the plugin-related env vars after each test. If you add a new env var that tests mutate, add it to `envKeys` in `test/setup.ts`.

### Avoid brittle snapshots

Snapshots can hide intent and break on harmless formatting changes. Prefer focused assertions like:

```ts
expect(output).toContain("1 running");
expect(output).toContain("Review auth changes");
```

Use snapshots only when the whole rendered shape is the behavior being protected and the output is intentionally stable.

### Write failures

Integration tests can simulate filesystem write failures by making the expected state path a directory. Keep these tests small and assert that plugin event handling does not throw.
