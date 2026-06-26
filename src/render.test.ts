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

  it("collapses proxy work items into one canonical real session row", () => {
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
        id: "ses_child",
        source: "session",
        status: "done",
        color: "green",
        targetSessionID: "ses_child",
        elapsedMs: 240000,
      }),
    ]);
  });

  it("hides a targetless generic task wrapper while keeping the real session", () => {
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
      "ses_sync_child",
    ]);
  });

  it("emits canonical session rows for multiple targeted generic proxies", () => {
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
      "ses_ping_1",
      "ses_ping_2",
    ]);
    expect(collapsed).toEqual([
      expect.objectContaining({
        source: "session",
        status: "done",
        targetSessionID: "ses_ping_1",
      }),
      expect.objectContaining({
        source: "session",
        status: "done",
        targetSessionID: "ses_ping_2",
      }),
    ]);
  });

  it("shows completed real session history without wrapper rows", () => {
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
    ).toEqual(["ses_old_ping_1", "ses_old_ping_2"]);
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
        targetSessionID: "ses_child_1",
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

    expect(collapsed.map((item) => item.id)).toEqual(["ses_child_1"]);
    expect(collapsed[0]).toMatchObject({
      source: "session",
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

  it("applies done-row recency parity to stale and recent error rows", () => {
    const now = Date.parse("2026-04-30T10:20:00.000Z");
    const recentError = child({
      id: "error_recent",
      targetSessionID: "error_recent",
      messageID: "msg_error_recent",
      status: "error",
      color: "red",
      endedAt: "2026-04-30T10:15:00.000Z",
      updatedAt: "2026-04-30T10:15:00.000Z",
    });
    const staleError = child({
      id: "error_old",
      targetSessionID: "error_old",
      messageID: "msg_error_old",
      status: "error",
      color: "red",
      endedAt: undefined,
      updatedAt: "2026-04-30T10:00:00.000Z",
    });
    const staleDone = child({
      id: "done_old",
      targetSessionID: "done_old",
      messageID: "msg_done_old",
      status: "done",
      color: "green",
      endedAt: "2026-04-30T10:00:00.000Z",
      updatedAt: "2026-04-30T10:00:00.000Z",
    });

    expect(
      visibleSubagentWorkItems([recentError, staleError, staleDone], now).map(
        (item) => item.id,
      ),
    ).toEqual(["error_recent"]);
  });

  it("keeps running work visible without re-admitting stale error rows", () => {
    const nowMs = Date.parse("2026-04-30T12:15:00.000Z");
    const children: ChildSessionState[] = [
      child({
        id: "ses_active",
        title: "Long running active work",
        source: "session",
        targetSessionID: "ses_active",
        messageID: "msg_active",
        status: "running",
      }),
      child({
        id: "ses_error_old",
        title: "Historical failure",
        source: "session",
        targetSessionID: "ses_error_old",
        messageID: "msg_old",
        status: "error",
        color: "red",
        endedAt: "2026-04-30T12:00:00.000Z",
        updatedAt: "2026-04-30T12:00:00.000Z",
      }),
    ];

    expect(
      visibleSubagentWorkItems(children, nowMs).map((item) => item.id),
    ).toEqual(["ses_active"]);
  });

  it("keeps unrelated recent terminal rows hidden while active work is running", () => {
    const nowMs = Date.parse("2026-04-30T12:15:00.000Z");
    const children: ChildSessionState[] = [
      child({
        id: "ses_active",
        title: "Long running active work",
        source: "session",
        targetSessionID: "ses_active",
        messageID: "msg_active",
        status: "running",
      }),
      child({
        id: "ses_active_done",
        title: "Active thread completion",
        source: "session",
        targetSessionID: "ses_active_done",
        messageID: "msg_active",
        status: "done",
        color: "green",
        endedAt: "2026-04-30T12:14:00.000Z",
        updatedAt: "2026-04-30T12:14:00.000Z",
      }),
      child({
        id: "ses_active_error",
        title: "Active thread failure",
        source: "session",
        targetSessionID: "ses_active_error",
        messageID: "msg_active",
        status: "error",
        color: "red",
        endedAt: "2026-04-30T12:14:30.000Z",
        updatedAt: "2026-04-30T12:14:30.000Z",
      }),
      child({
        id: "ses_unrelated_error_recent",
        title: "Recent unrelated failure",
        source: "session",
        targetSessionID: "ses_unrelated_error_recent",
        messageID: "msg_other",
        status: "error",
        color: "red",
        endedAt: "2026-04-30T12:14:45.000Z",
        updatedAt: "2026-04-30T12:14:45.000Z",
      }),
      child({
        id: "ses_unrelated_done_recent",
        title: "Recent unrelated completion",
        source: "session",
        targetSessionID: "ses_unrelated_done_recent",
        messageID: "msg_other",
        status: "done",
        color: "green",
        endedAt: "2026-04-30T12:14:45.000Z",
        updatedAt: "2026-04-30T12:14:45.000Z",
      }),
    ];

    expect(
      visibleSubagentWorkItems(children, nowMs).map((item) => item.id),
    ).toEqual(["ses_active", "ses_active_done", "ses_active_error"]);
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

  it("shows retained stale done and error rows only when completed history is enabled", () => {
    const now = Date.parse("2026-04-30T10:20:00.000Z");
    const staleDone = child({
      id: "done_old_history",
      targetSessionID: "done_old_history",
      messageID: "msg_done_old_history",
      status: "done",
      color: "green",
      endedAt: "2026-04-30T10:00:00.000Z",
      updatedAt: "2026-04-30T10:00:00.000Z",
    });
    const staleError = child({
      id: "error_old_history",
      targetSessionID: "error_old_history",
      messageID: "msg_error_old_history",
      status: "error",
      color: "red",
      endedAt: "2026-04-30T10:00:00.000Z",
      updatedAt: "2026-04-30T10:00:00.000Z",
    });

    expect(visibleSubagentWorkItems([staleDone, staleError], now)).toEqual([]);
    expect(
      visibleSubagentWorkItems([staleDone, staleError], now, {
        showCompletedHistory: true,
      }).map((item) => item.id),
    ).toEqual(["done_old_history", "error_old_history"]);
  });

  it("keeps active running work visible and deprioritizes unrelated done rows", () => {
    const nowMs = Date.parse("2026-04-30T12:15:00.000Z");
    const children: ChildSessionState[] = [
      child({
        id: "ses_active",
        title: "Long running active work",
        source: "session",
        targetSessionID: "ses_active",
        messageID: "msg_active",
        status: "running",
      }),
      child({
        id: "ses_active_done",
        title: "Recent completion in active thread",
        source: "session",
        targetSessionID: "ses_active_done",
        messageID: "msg_active",
        status: "done",
        color: "green",
        endedAt: "2026-04-30T12:14:00.000Z",
        updatedAt: "2026-04-30T12:14:00.000Z",
      }),
      child({
        id: "ses_historical",
        title: "Historical completion",
        source: "session",
        targetSessionID: "ses_historical",
        messageID: "msg_old",
        status: "done",
        color: "green",
        endedAt: "2026-04-30T12:14:00.000Z",
        updatedAt: "2026-04-30T12:14:00.000Z",
      }),
    ];

    const visible = visibleSubagentWorkItems(children, nowMs);

    expect(visible.map((item) => item.id)).toEqual([
      "ses_active",
      "ses_active_done",
    ]);
    expect(visible.some((item) => item.id === "ses_historical")).toBe(
      false,
    );
  });

  it("shows unrelated done rows during active work when completed history is enabled", () => {
    const nowMs = Date.parse("2026-04-30T12:15:00.000Z");
    const children: ChildSessionState[] = [
      child({
        id: "ses_active",
        title: "Long running active work",
        source: "session",
        targetSessionID: "ses_active",
        messageID: "msg_active",
        status: "running",
      }),
      child({
        id: "ses_active_done",
        title: "Recent completion in active thread",
        source: "session",
        targetSessionID: "ses_active_done",
        messageID: "msg_active",
        status: "done",
        color: "green",
        endedAt: "2026-04-30T12:14:00.000Z",
        updatedAt: "2026-04-30T12:14:00.000Z",
      }),
      child({
        id: "ses_historical",
        title: "Historical completion",
        source: "session",
        targetSessionID: "ses_historical",
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
      "ses_active",
      "ses_active_done",
      "ses_historical",
    ]);
  });

  it("hides targetless delegate wrappers before real-session evidence exists", () => {
    const nowMs = Date.parse("2026-04-30T12:15:00.000Z");
    const wrapper = child({
      id: "tool:delegate-wrapper",
      title: "Delegation: inspect counters",
      source: "tool",
      toolName: "delegate",
      targetSessionID: undefined,
      messageID: "msg_delegate",
      status: "running",
    });

    expect(collapseSubagentWorkItems([wrapper])).toEqual([]);
    expect(visibleSubagentWorkItems([wrapper], nowMs)).toEqual([]);
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
          id: "ses_running",
          targetSessionID: "ses_running",
          title: "Run tests",
          status: "running",
          color: "yellow",
        }),
        error: child({
          id: "ses_error",
          targetSessionID: "ses_error",
          title: "Fix bug",
          status: "error",
          color: "red",
          updatedAt: new Date().toISOString(),
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

  it("renders retained terminal status counts while active rows stay filtered", () => {
    process.env.NO_COLOR = "1";
    const terminalDone = Array.from({ length: 6 }, (_, index) =>
      child({
        id: `ses_done_${index}`,
        targetSessionID: `ses_done_${index}`,
        messageID: `msg_done_${index}`,
        title: `Retained done ${index}`,
        status: "done",
        color: "green",
        endedAt: "2026-04-30T10:00:00.000Z",
        updatedAt: "2026-04-30T10:00:00.000Z",
      }),
    );
    const terminalErrors = Array.from({ length: 7 }, (_, index) =>
      child({
        id: `ses_error_${index}`,
        targetSessionID: `ses_error_${index}`,
        messageID: `msg_error_${index}`,
        title: `Retained error ${index}`,
        status: "error",
        color: "red",
        endedAt: "2026-04-30T10:00:00.000Z",
        updatedAt: "2026-04-30T10:00:00.000Z",
      }),
    );
    const state: StatuslineState = {
      children: Object.fromEntries(
        [
          child({
            id: "ses_running",
            targetSessionID: "ses_running",
            messageID: "msg_running",
            title: "Active work",
            status: "running",
            color: "yellow",
          }),
          ...terminalDone,
          ...terminalErrors,
        ].map((item) => [item.id, item]),
      ),
      countedChildIDs: {},
      totalExecuted: 13,
      updatedAt: "2026-04-30T10:20:00.000Z",
    };

    const statusLine = renderStatusLine(state);

    expect(statusLine).toContain(
      "↳ 1 running · 6 done · 7 error · Σ 13 total",
    );
    expect(statusLine).toContain("Active work 01:01");
    expect(statusLine).not.toContain("Retained done 0");
    expect(statusLine).not.toContain("Retained error 0");
  });
});
