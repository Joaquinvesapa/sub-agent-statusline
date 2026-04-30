import { describe, expect, it } from "vitest";
import {
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
    const withTokens = child({ tokens: { input: 1200, output: 300, contextPercent: 12.34 } });

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

    expect(visibleSubagentWorkItems([visibleDone, hiddenDone], now).map((item) => item.id)).toEqual([
      "done_recent",
    ]);
  });

  it("renders aggregate and detail statusline output without color when disabled", () => {
    process.env.NO_COLOR = "1";
    const state: StatuslineState = {
      children: {
        running: child({ id: "running", title: "Run tests", status: "running", color: "yellow" }),
        error: child({ id: "error", title: "Fix bug", status: "error", color: "red" }),
      },
      countedChildIDs: { running: true, error: true },
      totalExecuted: 2,
      updatedAt: "2026-04-30T10:00:00.000Z",
    };

    expect(renderStatusLine(state)).toContain("↳ 1 running · 0 done · 1 error · Σ 2 total");
    expect(renderStatusLine(state)).toContain("Run tests 01:01");
    expect(renderStatusLine(state)).not.toContain("\u001B[");
  });
});
