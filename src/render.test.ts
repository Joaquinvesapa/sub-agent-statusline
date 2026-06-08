import { describe, expect, it } from "vitest";
import {
  byPriority,
  collapseSubagentWorkItems,
  formatContext,
  formatContextCompact,
  formatContextDetails,
  formatDuration,
  renderStatusLine,
  visibleSubagentWorkItems,
} from "./render.js";
import type { ChildSessionState, StatuslineState } from "./state.js";

function child(overrides: Partial<ChildSessionState> = {}): ChildSessionState {
  return {
    id: "ses_child",
    title: "Review auth changes",
    parentID: "ses_parent",
    messageID: "msg_1",
    source: "session",
    targetSessionID: "ses_child",
    status: "running",
    color: "yellow",
    startedAt: "2026-04-30T10:00:00.000Z",
    updatedAt: "2026-04-30T10:01:00.000Z",
    elapsedMs: 61000,
    ...overrides,
  };
}

describe("render", () => {
  it("formats durations and context details semantically", () => {
    const withTokens = child({
      tokens: { input: 1200, output: 300, contextPercent: 12.34 },
    });

    expect(formatDuration(61000)).toBe("01:01");
    expect(formatDuration(3_661_000)).toBe("01:01:01");
    expect(formatContextDetails(withTokens)).toBe("1,500 tokens · 12.3% used");
    expect(formatContext(withTokens)).toBe("ctx 1,500 tokens · 12.3% used");
    expect(formatContextCompact(withTokens)).toBe("1.5k ctx 12%");
  });

  it("collapses synthetic work items with matching session children", () => {
    const synthetic = child({
      id: "tool:part_1",
      title: "Investigate flaky tests",
      source: "tool",
      targetSessionID: "ses_child",
      agentName: "tester",
    });
    const session = child({
      id: "ses_child",
      title: "Investigate flaky tests",
      source: "session",
      status: "done",
      color: "green",
      endedAt: "2026-04-30T10:04:00.000Z",
      elapsedMs: 240000,
    });

    expect(collapseSubagentWorkItems([synthetic, session])).toEqual([
      expect.objectContaining({
        id: "tool:part_1",
        status: "done",
        color: "green",
        targetSessionID: "ses_child",
        elapsedMs: 240000,
      }),
    ]);
  });

  it("does not collapse a targetless generic task wrapper without correlation", () => {
    const children: ChildSessionState[] = [
      child({
        id: "tool:sync-task",
        title: "task",
        source: "tool",
        targetSessionID: undefined,
        messageID: "msg_sync",
      }),
      child({
        id: "ses_sync_child",
        title: "Run task cleanup",
        source: "session",
        targetSessionID: "ses_sync_child",
        messageID: undefined,
        status: "running",
      }),
    ];

    expect(collapseSubagentWorkItems(children).map((item) => item.id)).toEqual([
      "tool:sync-task",
      "ses_sync_child",
    ]);
  });

  it("keeps multiple generic wrappers visible when they are the only representation", () => {
    const children: ChildSessionState[] = [
      child({
        id: "tool:ping-1",
        title: "task",
        source: "tool",
        messageID: "msg_ping_1",
        targetSessionID: "ses_ping_1",
      }),
      child({
        id: "ses_ping_1",
        title: "Ping subagent one",
        source: "session",
        messageID: "msg_ping_1",
        targetSessionID: "ses_ping_1",
        status: "done",
        color: "green",
        endedAt: "2026-04-30T10:02:00.000Z",
      }),
      child({
        id: "tool:ping-2",
        title: "delegate",
        source: "tool",
        messageID: "msg_ping_2",
        targetSessionID: "ses_ping_2",
      }),
      child({
        id: "ses_ping_2",
        title: "Ping subagent two",
        source: "session",
        messageID: "msg_ping_2",
        targetSessionID: "ses_ping_2",
        status: "done",
        color: "green",
        endedAt: "2026-04-30T10:03:00.000Z",
      }),
    ];

    const collapsed = collapseSubagentWorkItems(children);

    expect(collapsed.map((item) => item.id)).toEqual([
      "tool:ping-1",
      "tool:ping-2",
    ]);
    expect(collapsed).toEqual([
      expect.objectContaining({ status: "done", targetSessionID: "ses_ping_1" }),
      expect.objectContaining({ status: "done", targetSessionID: "ses_ping_2" }),
    ]);
  });

  it("shows retained generic completed rows when completed history is enabled", () => {
    const now = Date.parse("2026-04-30T10:20:00.000Z");
    const children: ChildSessionState[] = [
      child({
        id: "tool:old-ping-1",
        title: "task",
        source: "tool",
        messageID: "msg_old_ping_1",
        targetSessionID: "ses_old_ping_1",
      }),
      child({
        id: "ses_old_ping_1",
        title: "Old ping one",
        source: "session",
        messageID: "msg_old_ping_1",
        targetSessionID: "ses_old_ping_1",
        status: "done",
        color: "green",
        endedAt: "2026-04-30T10:02:00.000Z",
      }),
      child({
        id: "tool:old-ping-2",
        title: "delegate",
        source: "tool",
        messageID: "msg_old_ping_2",
        targetSessionID: "ses_old_ping_2",
      }),
      child({
        id: "ses_old_ping_2",
        title: "Old ping two",
        source: "session",
        messageID: "msg_old_ping_2",
        targetSessionID: "ses_old_ping_2",
        status: "done",
        color: "green",
        endedAt: "2026-04-30T10:03:00.000Z",
      }),
    ];

    expect(
      visibleSubagentWorkItems(children, now, {
        showCompletedHistory: true,
      }).map((item) => item.id),
    ).toEqual(["tool:old-ping-1", "tool:old-ping-2"]);
  });

  it("keeps one grouped row and avoids duplicate wrappers", () => {
    const children: ChildSessionState[] = [
      child({
        id: "tool:task-wrapper",
        title: "task",
        source: "tool",
        messageID: "msg_1",
      }),
      child({
        id: "subtask:work_1",
        title: "Implement grouping assertions",
        source: "subtask",
        messageID: "msg_1",
        targetSessionID: "ses_child_1",
      }),
      child({
        id: "ses_child_1",
        title: "Implement grouping assertions (coder)",
        source: "session",
        messageID: "msg_1",
        status: "done",
        color: "green",
        endedAt: "2026-04-30T12:10:00.000Z",
        updatedAt: "2026-04-30T12:10:00.000Z",
      }),
    ];

    const collapsed = collapseSubagentWorkItems(children);

    expect(collapsed.map((item) => item.id)).toEqual(["subtask:work_1"]);
    expect(collapsed[0]).toMatchObject({
      status: "done",
      color: "green",
      targetSessionID: "ses_child_1",
      endedAt: "2026-04-30T12:10:00.000Z",
    });
  });

  it("keeps recent done items visible and hides stale done items", () => {
    const now = Date.parse("2026-04-30T10:20:00.000Z");
    const visibleDone = child({
      id: "done_recent",
      status: "done",
      color: "green",
      endedAt: "2026-04-30T10:15:00.000Z",
    });
    const hiddenDone = child({
      id: "done_old",
      status: "done",
      color: "green",
      endedAt: "2026-04-30T10:00:00.000Z",
    });

    expect(
      visibleSubagentWorkItems([visibleDone, hiddenDone], now).map(
        (item) => item.id,
      ),
    ).toEqual(["done_recent"]);
  });

  it("shows stale done items when completed history is enabled", () => {
    const now = Date.parse("2026-04-30T10:20:00.000Z");
    const hiddenDone = child({
      id: "done_old",
      status: "done",
      color: "green",
      endedAt: "2026-04-30T10:00:00.000Z",
    });

    expect(
      visibleSubagentWorkItems([hiddenDone], now, {
        showCompletedHistory: true,
      }).map((item) => item.id),
    ).toEqual(["done_old"]);
  });

  it("keeps active running work visible and deprioritizes unrelated done rows", () => {
    const nowMs = Date.parse("2026-04-30T12:15:00.000Z");
    const children: ChildSessionState[] = [
      child({
        id: "subtask:active",
        title: "Long running active work",
        source: "subtask",
        messageID: "msg_active",
        status: "running",
      }),
      child({
        id: "subtask:active-done",
        title: "Recent completion in active thread",
        source: "subtask",
        messageID: "msg_active",
        status: "done",
        color: "green",
        endedAt: "2026-04-30T12:14:00.000Z",
        updatedAt: "2026-04-30T12:14:00.000Z",
      }),
      child({
        id: "subtask:historical",
        title: "Historical completion",
        source: "subtask",
        messageID: "msg_old",
        status: "done",
        color: "green",
        endedAt: "2026-04-30T12:14:00.000Z",
        updatedAt: "2026-04-30T12:14:00.000Z",
      }),
    ];

    const visible = visibleSubagentWorkItems(children, nowMs);

    expect(visible.map((item) => item.id)).toEqual([
      "subtask:active",
      "subtask:active-done",
    ]);
    expect(visible.some((item) => item.id === "subtask:historical")).toBe(
      false,
    );
  });

  it("shows unrelated done rows during active work when completed history is enabled", () => {
    const nowMs = Date.parse("2026-04-30T12:15:00.000Z");
    const children: ChildSessionState[] = [
      child({
        id: "subtask:active",
        title: "Long running active work",
        source: "subtask",
        messageID: "msg_active",
        status: "running",
      }),
      child({
        id: "subtask:active-done",
        title: "Recent completion in active thread",
        source: "subtask",
        messageID: "msg_active",
        status: "done",
        color: "green",
        endedAt: "2026-04-30T12:14:00.000Z",
        updatedAt: "2026-04-30T12:14:00.000Z",
      }),
      child({
        id: "subtask:historical",
        title: "Historical completion",
        source: "subtask",
        messageID: "msg_old",
        status: "done",
        color: "green",
        endedAt: "2026-04-30T12:14:00.000Z",
        updatedAt: "2026-04-30T12:14:00.000Z",
      }),
    ];

    const visible = visibleSubagentWorkItems(children, nowMs, {
      showCompletedHistory: true,
    });

    expect(visible.map((item) => item.id)).toEqual([
      "subtask:active",
      "subtask:active-done",
      "subtask:historical",
    ]);
  });

  it("sorts ties by id for stable priority", () => {
    const a = child({ id: "a", startedAt: "2026-04-30T12:00:00.000Z" });
    const b = child({ id: "b", startedAt: "2026-04-30T12:00:00.000Z" });
    expect([b, a].sort(byPriority).map((item) => item.id)).toEqual(["a", "b"]);
  });

  it("renders aggregate and detail statusline output without color when disabled", () => {
    process.env.NO_COLOR = "1";
    const state: StatuslineState = {
      children: {
        running: child({
          id: "running",
          title: "Run tests",
          status: "running",
          color: "yellow",
        }),
        error: child({
          id: "error",
          title: "Fix bug",
          status: "error",
          color: "red",
        }),
      },
      countedChildIDs: { running: true, error: true },
      totalExecuted: 2,
      updatedAt: "2026-04-30T10:00:00.000Z",
    };

    expect(renderStatusLine(state)).toContain(
      "↳ 1 running · 0 done · 1 error · Σ 2 total",
    );
    expect(renderStatusLine(state)).toContain("Run tests 01:01");
    expect(renderStatusLine(state)).not.toContain("\u001B[");
  });
});
