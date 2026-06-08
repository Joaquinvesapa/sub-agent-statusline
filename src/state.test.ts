import { mkdir, readdir, stat, writeFile } from "node:fs/promises";
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
  saveStatusText,
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
  it("upserts tool wrappers without counting them and marks terminal statuses", () => {
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
    expect(state.totalExecuted).toBe(0);
    expect(state.countedChildIDs["tool:part_1"]).toBeUndefined();
    expect(state.children["tool:part_1"]).toBeDefined();

    upsertRunningChild(state, {
      id: "tool:part_1",
      title: "Run tests",
      parentID: "ses_parent",
      source: "tool",
      updatedAt: "2026-04-30T10:02:00.000Z",
    });
    expect(state.totalExecuted).toBe(0);
    expect(state.countedChildIDs["tool:part_1"]).toBeUndefined();

    expect(
      markChildStatus(state, "tool:part_1", "done", "2026-04-30T10:03:00.000Z"),
    ).toBe(true);
    expect(state.children["tool:part_1"]).toMatchObject({
      status: "done",
      color: "green",
      endedAt: "2026-04-30T10:03:00.000Z",
    });
    expect(state.totalExecuted).toBe(0);
    expect(state.countedChildIDs["tool:part_1"]).toBeUndefined();
    expect(getCounts(state)).toEqual({ running: 0, done: 1, error: 0 });
  });

  it("keeps non-zero-duration tool wrappers uncounted", () => {
    const state = createEmptyState();

    expect(
      upsertRunningChild(state, {
        id: "tool:part_2",
        title: "Run longer delegated task",
        parentID: "ses_parent",
        source: "tool",
        startedAt: "2026-04-30T10:00:00.000Z",
        updatedAt: "2026-04-30T10:05:00.000Z",
      }),
    ).toBe(true);
    markChildStatus(state, "tool:part_2", "done", "2026-04-30T10:05:00.000Z");
    refreshDerivedFields(state, new Date("2026-04-30T10:05:00.000Z"));

    expect(state.children["tool:part_2"].elapsedMs).toBe(300000);
    expect(state.totalExecuted).toBe(0);
    expect(state.countedChildIDs["tool:part_2"]).toBeUndefined();
  });

  it("counts real sessions exactly once even with repeated updates", () => {
    const state = createEmptyState();

    expect(
      upsertRunningChild(state, {
        id: "ses_child",
        title: "Child work",
        parentID: "ses_parent",
        source: "session",
      }),
    ).toBe(true);
    expect(state.totalExecuted).toBe(1);
    expect(state.countedChildIDs.ses_child).toBe(true);

    upsertRunningChild(state, {
      id: "ses_child",
      title: "Child work",
      parentID: "ses_parent",
      source: "session",
      updatedAt: "2026-04-30T10:02:00.000Z",
    });
    expect(
      markChildStatus(state, "ses_child", "done", "2026-04-30T10:03:00.000Z"),
    ).toBe(true);

    expect(state.totalExecuted).toBe(1);
    expect(Object.keys(state.countedChildIDs)).toEqual(["ses_child"]);
  });

  it("counts a tool wrapper followed by a matching real session as one execution", () => {
    const state = createEmptyState();

    upsertRunningChild(state, {
      id: "tool:part_1",
      title: "Delegate work",
      parentID: "ses_parent",
      messageID: "msg_1",
      source: "tool",
      targetSessionID: "ses_child",
    });
    expect(state.totalExecuted).toBe(0);

    upsertRunningChild(state, {
      id: "ses_child",
      title: "Child work",
      parentID: "ses_parent",
      messageID: "msg_1",
      source: "session",
    });

    expect(state.totalExecuted).toBe(1);
    expect(state.countedChildIDs.ses_child).toBe(true);
    expect(state.countedChildIDs["tool:part_1"]).toBeUndefined();
  });

  it("counts subtask fallback only when it has no matching counted session", () => {
    const state = createEmptyState();

    upsertRunningChild(state, {
      id: "subtask:part_1",
      title: "Fallback work",
      parentID: "ses_parent",
      messageID: "msg_1",
      source: "subtask",
    });
    expect(state.totalExecuted).toBe(1);
    expect(state.countedChildIDs["subtask:part_1"]).toBe(true);

    upsertRunningChild(state, {
      id: "ses_other",
      title: "Other child",
      parentID: "ses_parent",
      messageID: "msg_2",
      source: "session",
    });
    upsertRunningChild(state, {
      id: "subtask:part_2",
      title: "Already counted fallback",
      parentID: "ses_parent",
      messageID: "msg_2",
      source: "subtask",
      targetSessionID: "ses_other",
    });

    expect(state.totalExecuted).toBe(2);
    expect(state.countedChildIDs.ses_other).toBe(true);
    expect(state.countedChildIDs["subtask:part_2"]).toBeUndefined();
  });

  it("rekeys counted subtask fallback when the matching session appears", () => {
    const state = createEmptyState();

    upsertRunningChild(state, {
      id: "subtask:part_1",
      title: "Fallback work",
      parentID: "ses_parent",
      messageID: "msg_1",
      source: "subtask",
    });
    expect(state.totalExecuted).toBe(1);
    expect(state.countedChildIDs["subtask:part_1"]).toBe(true);

    upsertRunningChild(state, {
      id: "ses_child",
      title: "Child work",
      parentID: "ses_parent",
      messageID: "msg_1",
      source: "session",
    });

    expect(state.totalExecuted).toBe(1);
    expect(state.countedChildIDs.ses_child).toBe(true);
    expect(state.countedChildIDs["subtask:part_1"]).toBeUndefined();
  });

  it("reconciles counted subtask fallback when details add a target session", () => {
    const state = createEmptyState();

    upsertRunningChild(state, {
      id: "subtask:part_1",
      title: "Fallback work",
      parentID: "ses_parent",
      messageID: "msg_1",
      source: "subtask",
    });
    expect(state.totalExecuted).toBe(1);

    expect(
      upsertChildDetails(state, "subtask:part_1", {
        targetSessionID: "ses_child",
      }),
    ).toBe(true);

    expect(state.totalExecuted).toBe(1);
    expect(state.countedChildIDs.ses_child).toBe(true);
    expect(state.countedChildIDs["subtask:part_1"]).toBeUndefined();
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
      endedAt: "2026-04-26T08:00:00.000Z",
      updatedAt: "2026-04-26T08:00:00.000Z",
    });
    state.children.recentDone = child({
      id: "recentDone",
      status: "done",
      color: "green",
      endedAt: "2026-04-28T09:30:00.000Z",
      updatedAt: "2026-04-28T09:30:00.000Z",
    });

    expect(
      pruneTerminalChildren(state, new Date("2026-04-30T10:00:01.000Z")),
    ).toBe(1);
    expect(Object.keys(state.children).sort()).toEqual([
      "recentDone",
      "running",
    ]);
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
    expect(await readRuntimeState(harness.statePath)).toMatchObject({
      totalExecuted: 1,
    });
    expect(await loadState(harness.statePath)).toMatchObject({
      totalExecuted: 1,
    });

    const badPath = join(harness.dir, "nested", "bad.json");
    await mkdir(dirname(badPath), { recursive: true });
    await writeFile(badPath, "not json", "utf8");
    expect(await loadState(badPath)).toMatchObject({
      children: {},
      totalExecuted: 0,
    });
  });

  it("writes state and text snapshots atomically with owner-only file modes", async () => {
    const harness = await createRuntimeHarness();
    const state = createEmptyState();
    state.children.ses_child = child();
    state.totalExecuted = 1;
    state.countedChildIDs.ses_child = true;

    await saveState(harness.statePath, state);
    await saveStatusText(join(harness.dir, "status.txt"), "subagents: 1");

    expect(await loadState(harness.statePath)).toMatchObject({
      totalExecuted: 1,
    });
    expect((await stat(harness.dir)).mode & 0o777).toBe(0o700);
    expect((await stat(harness.statePath)).mode & 0o777).toBe(0o600);
    expect((await stat(join(harness.dir, "status.txt"))).mode & 0o777).toBe(
      0o600,
    );
    expect(
      (await readdir(harness.dir)).some((file) => file.endsWith(".tmp")),
    ).toBe(false);
  });

  it("does not add newly loaded tool wrappers while preserving historical tool counts", async () => {
    const harness = await createRuntimeHarness();
    await writeFile(
      harness.statePath,
      JSON.stringify({
        children: {
          "tool:old": child({
            id: "tool:old",
            source: "tool",
            targetSessionID: undefined,
          }),
          "tool:new": child({
            id: "tool:new",
            source: "tool",
            targetSessionID: undefined,
          }),
        },
        countedChildIDs: { "tool:old": true },
        totalExecuted: 1,
        updatedAt: "2026-04-30T10:00:00.000Z",
      }),
      "utf8",
    );

    const loaded = await loadState(harness.statePath);

    expect(loaded.totalExecuted).toBe(1);
    expect(loaded.countedChildIDs["tool:old"]).toBe(true);
    expect(loaded.countedChildIDs["tool:new"]).toBeUndefined();
  });

  it("normalizes counters after loading missing counted ids", async () => {
    const harness = await createRuntimeHarness();
    await writeFile(
      harness.statePath,
      JSON.stringify({
        children: {
          ses_child: child({ id: "ses_child", source: "session" }),
        },
        countedChildIDs: {},
        totalExecuted: 0,
        updatedAt: "2026-04-30T10:00:00.000Z",
      }),
      "utf8",
    );

    const loaded = await loadState(harness.statePath);

    expect(loaded.countedChildIDs.ses_child).toBe(true);
    expect(loaded.totalExecuted).toBe(1);
  });

  it("rekeys historical counted subtasks to their loaded target session ids", async () => {
    const harness = await createRuntimeHarness();
    await writeFile(
      harness.statePath,
      JSON.stringify({
        children: {
          "subtask:old": child({
            id: "subtask:old",
            source: "subtask",
            targetSessionID: "ses_child",
          }),
        },
        countedChildIDs: { "subtask:old": true },
        totalExecuted: 1,
        updatedAt: "2026-04-30T10:00:00.000Z",
      }),
      "utf8",
    );

    const loaded = await loadState(harness.statePath);

    expect(loaded.totalExecuted).toBe(1);
    expect(loaded.countedChildIDs.ses_child).toBe(true);
    expect(loaded.countedChildIDs["subtask:old"]).toBeUndefined();
  });

  it("deduplicates historical subtask and target ids that were both counted", async () => {
    const harness = await createRuntimeHarness();
    await writeFile(
      harness.statePath,
      JSON.stringify({
        children: {
          "subtask:old": child({
            id: "subtask:old",
            source: "subtask",
            targetSessionID: "ses_child",
          }),
        },
        countedChildIDs: { "subtask:old": true, ses_child: true },
        totalExecuted: 2,
        updatedAt: "2026-04-30T10:00:00.000Z",
      }),
      "utf8",
    );

    const loaded = await loadState(harness.statePath);

    expect(loaded.totalExecuted).toBe(1);
    expect(loaded.countedChildIDs.ses_child).toBe(true);
    expect(loaded.countedChildIDs["subtask:old"]).toBeUndefined();
  });
});
