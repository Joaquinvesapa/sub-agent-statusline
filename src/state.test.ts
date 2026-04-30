import { mkdir, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  createEmptyState,
  getCounts,
  loadState,
  markChildStatus,
  pruneTerminalChildren,
  refreshDerivedFields,
  resolveStatePath,
  resolveTextPath,
  saveState,
  shouldPreserveStateOnStartup,
  upsertChildDetails,
  upsertRunningChild,
  type ChildSessionState,
} from "./state.js";
import {
  createRuntimeHarness,
  readRuntimeState,
  useFrozenTime,
} from "../test/helpers/runtime-harness.js";

function child(overrides: Partial<ChildSessionState> = {}): ChildSessionState {
  return {
    id: "ses_child",
    title: "Child work",
    parentID: "ses_parent",
    source: "session",
    targetSessionID: "ses_child",
    status: "running",
    color: "yellow",
    startedAt: "2026-04-30T10:00:00.000Z",
    updatedAt: "2026-04-30T10:00:00.000Z",
    ...overrides,
  };
}

describe("state", () => {
  it("upserts running children, counts work once, and marks terminal statuses", () => {
    useFrozenTime("2026-04-30T10:05:00.000Z");
    const state = createEmptyState();

    expect(
      upsertRunningChild(state, {
        id: "tool:part_1",
        title: "Run tests",
        parentID: "ses_parent",
        source: "tool",
        startedAt: "2026-04-30T10:00:00.000Z",
      }),
    ).toBe(true);
    expect(state.totalExecuted).toBe(1);

    expect(
      upsertRunningChild(state, {
        id: "tool:part_1",
        title: "Run tests",
        parentID: "ses_parent",
        source: "tool",
      }),
    ).toBe(false);
    expect(state.totalExecuted).toBe(1);

    expect(markChildStatus(state, "tool:part_1", "done", "2026-04-30T10:03:00.000Z")).toBe(
      true,
    );
    expect(state.children["tool:part_1"]).toMatchObject({
      status: "done",
      color: "green",
      endedAt: "2026-04-30T10:03:00.000Z",
    });
    expect(getCounts(state)).toEqual({ running: 0, done: 1, error: 0 });
  });

  it("merges details, sanitizes tokens, and refreshes elapsed fields", () => {
    useFrozenTime("2026-04-30T10:02:00.000Z");
    const state = createEmptyState();
    state.children.ses_child = child();

    expect(
      upsertChildDetails(state, "ses_child", {
        title: "Better title",
        summary: "Better title",
        agentName: "(planner)",
        tokens: { input: 10, output: 5, contextPercent: 33.3 },
      }),
    ).toBe(true);
    refreshDerivedFields(state);

    expect(state.children.ses_child).toMatchObject({
      title: "Better title",
      summary: undefined,
      agentName: "planner",
      elapsedMs: 120000,
      tokens: { input: 10, output: 5, contextPercent: 33.3 },
    });
  });

  it("prunes old terminal children without losing running children", () => {
    const state = createEmptyState();
    state.children.running = child({ id: "running" });
    state.children.oldDone = child({
      id: "oldDone",
      status: "done",
      color: "green",
      endedAt: "2026-04-30T08:00:00.000Z",
      updatedAt: "2026-04-30T08:00:00.000Z",
    });
    state.children.recentDone = child({
      id: "recentDone",
      status: "done",
      color: "green",
      endedAt: "2026-04-30T09:30:00.000Z",
      updatedAt: "2026-04-30T09:30:00.000Z",
    });

    expect(pruneTerminalChildren(state, new Date("2026-04-30T10:00:01.000Z"))).toBe(1);
    expect(Object.keys(state.children).sort()).toEqual(["recentDone", "running"]);
  });

  it("resolves env paths and preserve-state flag", async () => {
    const harness = await createRuntimeHarness({ preserveState: true });

    expect(resolveStatePath()).toBe(harness.statePath);
    expect(resolveTextPath(harness.statePath)).toBe(harness.textPath);
    expect(shouldPreserveStateOnStartup()).toBe(true);
  });

  it("saves and loads state safely, falling back on invalid JSON", async () => {
    const harness = await createRuntimeHarness();
    const state = createEmptyState();
    state.children.ses_child = child();
    state.totalExecuted = 1;
    state.countedChildIDs.ses_child = true;

    await saveState(harness.statePath, state);
    expect(await readRuntimeState(harness.statePath)).toMatchObject({ totalExecuted: 1 });
    expect(await loadState(harness.statePath)).toMatchObject({ totalExecuted: 1 });

    const badPath = join(harness.dir, "nested", "bad.json");
    await mkdir(dirname(badPath), { recursive: true });
    await writeFile(badPath, "not json", "utf8");
    expect(await loadState(badPath)).toMatchObject({ children: {}, totalExecuted: 0 });
  });
});
