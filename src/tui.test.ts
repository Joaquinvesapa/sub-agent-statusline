import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { TuiPluginApi } from "@opencode-ai/plugin/tui";
import { describe, expect, it, vi } from "vitest";
import { readOpenCodeLogFileIfSmall } from "./logs.js";
import {
  backfillHydratedTargetSessionIDs,
  formatChildModelLine,
  hydratePreviousSubagents,
  preservedSidebarAnchorScrollTop,
  preservedSidebarScrollTop,
  resolveSidebarSubagentSnapshot,
  probeRunningEvidence,
  resolveTuiSubagentSnapshot,
  subagentRowHeight,
  wrapCompactText,
} from "./tui.js";
import { textColumns } from "./text-width.js";
import {
  focusPromptWithDeferredRetry,
  resolveSidebarReturnFocusAction,
  resolveSiblingSidebarRefocus,
  shouldReleaseSidebarListFocus,
} from "./tui-focus.js";
import { registerSubagentCommands } from "./tui-commands.js";
import type { ChildSessionState, StatuslineState } from "./state.js";

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
    updatedAt: "2026-04-30T10:01:00.000Z",
    ...overrides,
  };
}

function stateWith(
  children: ChildSessionState[],
  countedChildIDs = children
    .filter((item) => item.source === "session" || item.id.startsWith("ses_"))
    .map((item) => item.targetSessionID ?? item.id),
): StatuslineState {
  return {
    children: Object.fromEntries(children.map((item) => [item.id, item])),
    countedChildIDs: Object.fromEntries(
      countedChildIDs.map((id) => [id, true]),
    ),
    totalExecuted: 99,
    updatedAt: "2026-04-30T10:20:00.000Z",
  };
}

async function hydrateState(input: {
  children: unknown[];
  parentMessages?: unknown[];
  childMessages?: Record<string, unknown[]>;
  statuses?: Record<string, unknown>;
}): Promise<StatuslineState> {
  let state = stateWith([]);
  const dir = await mkdtemp(join(tmpdir(), "subagent-statusline-hydrate-"));
  const childMessages = input.childMessages ?? {};
  const api = {
    state: { path: { directory: dir } },
    client: {
      session: {
        children: vi.fn(async () => ({ data: input.children })),
        messages: vi.fn(async ({ sessionID }: { sessionID: string }) => ({
          data:
            sessionID === "ses_parent"
              ? (input.parentMessages ?? [])
              : (childMessages[sessionID] ?? []),
        })),
        status: vi.fn(async () => ({ data: input.statuses ?? {} })),
      },
    },
  } as unknown as TuiPluginApi;

  await hydratePreviousSubagents(
    api,
    "ses_parent",
    join(dir, "state.json"),
    join(dir, "status.txt"),
    (update) => {
      state = update(state);
    },
  );

  return state;
}

describe("TUI subagent snapshots", () => {
  it("wraps unbroken Japanese text within odd terminal column budgets", () => {
    const lines = wrapCompactText("日本語の概要を表示しています追加確認", 25, 2);

    expect(lines).toHaveLength(2);
    expect(lines.every((line) => textColumns(line) <= 25)).toBe(true);
  });

  it("truncates unbroken Japanese text within narrow terminal column budgets", () => {
    const lines = wrapCompactText("日本語の概要を表示しています", 8, 2);

    expect(lines).toHaveLength(2);
    expect(lines.every((line) => textColumns(line) <= 8)).toBe(true);
  });

  it("matches running row height to rendered secondary-line presence", () => {
    const nowMs = Date.parse("2026-04-30T10:20:00.000Z");

    expect(
      subagentRowHeight({ child: child({ title: "Short task" }), nowMs }),
    ).toBe(2);
    expect(
      subagentRowHeight({
        child: child({ title: "Short task", agentName: "reviewer" }),
        nowMs,
      }),
    ).toBe(3);
    expect(
      subagentRowHeight({
        child: child({ title: "Short task", status: "done" }),
        nowMs,
      }),
    ).toBe(2);
  });

  it("shows model metadata only with a variant and accounts for layout height", () => {
    const nowMs = Date.parse("2026-04-30T10:20:00.000Z");
    const plain = child({ title: "Short task" });
    const modeled = child({
      title: "Short task",
      model: { providerID: "openai", modelID: "gpt-5.6", variant: "high" },
    });
    const providers = [{
      id: "openai",
      models: { "gpt-5.6": { name: "GPT 5.6" } },
    }] as unknown as TuiPluginApi["state"]["provider"];

    expect(formatChildModelLine(plain, providers, 20)).toBeUndefined();
    expect(
      formatChildModelLine(
        child({ model: { providerID: "openai", modelID: "gpt-5.6" } }),
        providers,
        20,
      ),
    ).toBeUndefined();
    expect(subagentRowHeight({ child: plain, nowMs })).toBe(2);
    expect(formatChildModelLine(modeled, providers, 20)).toBe("GPT 5.6 · high");
    expect(subagentRowHeight({ child: modeled, nowMs })).toBe(3);
    expect(
      formatChildModelLine(
        child({ model: { providerID: "missing", modelID: "長いモデル識別子", variant: "最大" } }),
        providers,
        12,
      ),
    ).toSatisfy((line: string | undefined) => !!line && textColumns(line) <= 12);
    expect(
      formatChildModelLine(
        child({ model: { providerID: "missing", modelID: "fallback-model", variant: "fast" } }),
        providers,
        40,
      ),
    ).toBe("fallback-model · fast");
  });

  it("preserves sidebar scroll with the visible row anchor first", () => {
    expect(
      preservedSidebarAnchorScrollTop({
        expanded: true,
        anchor: {
          childIDs: ["ses_5", "ses_6", "ses_7"],
          intraRowOffset: 1,
        },
        rows: [
          { id: "ses_1", height: 3 },
          { id: "ses_2", height: 3 },
          { id: "ses_5", height: 3 },
          { id: "ses_6", height: 3 },
          { id: "ses_7", height: 3 },
        ],
        scrollTop: 0,
        scrollHeight: 15,
        viewportHeight: 5,
      }),
    ).toBe(7);

    expect(
      preservedSidebarScrollTop({
        expanded: true,
        offsetTop: 99,
        anchor: {
          childIDs: ["ses_removed", "ses_6", "ses_7"],
          intraRowOffset: 1,
        },
        rows: [
          { id: "ses_1", height: 3 },
          { id: "ses_2", height: 3 },
          { id: "ses_6", height: 3 },
          { id: "ses_7", height: 3 },
        ],
        scrollTop: 0,
        scrollHeight: 12,
        viewportHeight: 5,
      }),
    ).toBe(6);
  });

  it("does not fall back to stale numeric offset when anchor already matches top", () => {
    expect(
      preservedSidebarScrollTop({
        expanded: true,
        offsetTop: 6,
        anchor: {
          childIDs: ["ses_1", "ses_2"],
          intraRowOffset: 0,
        },
        rows: [
          { id: "ses_1", height: 3 },
          { id: "ses_2", height: 3 },
        ],
        scrollTop: 0,
        scrollHeight: 8,
        viewportHeight: 5,
      }),
    ).toBeUndefined();
  });

  it("falls back to bounded numeric sidebar scroll preservation", () => {
    expect(
      preservedSidebarScrollTop({
        expanded: true,
        offsetTop: 99,
        scrollTop: 0,
        scrollHeight: 12,
        viewportHeight: 5,
      }),
    ).toBe(7);
    expect(
      preservedSidebarScrollTop({
        expanded: false,
        offsetTop: 6,
        scrollTop: 0,
        scrollHeight: 12,
        viewportHeight: 5,
      }),
    ).toBeUndefined();
    expect(
      preservedSidebarScrollTop({
        expanded: true,
        offsetTop: 6,
        scrollTop: 6,
        scrollHeight: 12,
        viewportHeight: 5,
      }),
    ).toBeUndefined();
  });

  it("does not show other-session rows by default when current session has no executions", () => {
    const nowMs = Date.parse("2026-04-30T10:20:00.000Z");
    const state = stateWith([
      child({
        id: "ses_other_running",
        title: "Other session running",
        source: "session",
        parentID: "ses_other",
        targetSessionID: "ses_other_running",
        messageID: "msg_other_running",
        status: "running",
        startedAt: "2026-04-30T10:10:00.000Z",
        updatedAt: "2026-04-30T10:10:00.000Z",
      }),
    ]);

    const snapshot = resolveTuiSubagentSnapshot({
      state,
      sessionID: "ses_current",
      nowMs,
    });

    expect(snapshot.showingOtherSessions).toBe(false);
    expect(snapshot.visibleChildren).toEqual([]);
    expect(snapshot.visibleCounts).toEqual({ running: 0, done: 0, error: 0 });
    expect(snapshot.totalExecuted).toBe(0);
  });

  it("keeps retained terminal counters separate from default visible rows", () => {
    const nowMs = Date.parse("2026-04-30T10:20:00.000Z");
    const retainedDone = Array.from({ length: 6 }, (_, index) =>
      child({
        id: `ses_done_${index}`,
        title: `Retained done ${index}`,
        source: "session",
        targetSessionID: `ses_done_${index}`,
        messageID: `msg_done_${index}`,
        status: "done",
        color: "green",
        endedAt: "2026-04-30T10:02:00.000Z",
        updatedAt: "2026-04-30T10:02:00.000Z",
      }),
    );
    const retainedErrors = Array.from({ length: 7 }, (_, index) =>
      child({
        id: `ses_error_${index}`,
        title: `Retained error ${index}`,
        source: "session",
        targetSessionID: `ses_error_${index}`,
        messageID: `msg_error_${index}`,
        status: "error",
        color: "red",
        endedAt: "2026-04-30T10:02:00.000Z",
        updatedAt: "2026-04-30T10:02:00.000Z",
      }),
    );
    const state = stateWith([
      child({
        id: "ses_running",
        title: "Active child",
        source: "session",
        targetSessionID: "ses_running",
        messageID: "msg_running",
        status: "running",
        startedAt: "2026-04-30T10:10:00.000Z",
        updatedAt: "2026-04-30T10:10:00.000Z",
      }),
      ...retainedDone,
      ...retainedErrors,
    ]);

    const defaultSnapshot = resolveTuiSubagentSnapshot({
      state,
      sessionID: "ses_parent",
      nowMs,
    });
    const historySnapshot = resolveTuiSubagentSnapshot({
      state,
      sessionID: "ses_parent",
      nowMs,
      showCompletedHistory: true,
    });

    expect(defaultSnapshot.visibleChildren.map((item) => item.id)).toEqual([
      "ses_running",
    ]);
    expect(defaultSnapshot.visibleCounts).toEqual({
      running: 1,
      done: 6,
      error: 7,
    });
    expect(defaultSnapshot.totalExecuted).toBe(14);
    expect(historySnapshot.visibleChildren).toHaveLength(14);
    expect(historySnapshot.visibleChildren.map((item) => item.id)).toEqual(
      expect.arrayContaining(["ses_done_0", "ses_error_0"]),
    );
    expect(historySnapshot.visibleCounts).toEqual(defaultSnapshot.visibleCounts);
    expect(historySnapshot.totalExecuted).toBe(defaultSnapshot.totalExecuted);
  });

  it("keeps rows and counters in the current session scope when current history is hidden", () => {
    const nowMs = Date.parse("2026-04-30T10:20:00.000Z");
    const state = stateWith([
      child({
        id: "ses_current_done_old",
        title: "Current retained done",
        source: "session",
        parentID: "ses_current",
        targetSessionID: "ses_current_done_old",
        messageID: "msg_current_done",
        status: "done",
        color: "green",
        endedAt: "2026-04-30T10:02:00.000Z",
        updatedAt: "2026-04-30T10:02:00.000Z",
      }),
      child({
        id: "ses_current_error_old",
        title: "Current retained error",
        source: "session",
        parentID: "ses_current",
        targetSessionID: "ses_current_error_old",
        messageID: "msg_current_error",
        status: "error",
        color: "red",
        endedAt: "2026-04-30T10:03:00.000Z",
        updatedAt: "2026-04-30T10:03:00.000Z",
      }),
      child({
        id: "ses_other_running",
        title: "Other session running",
        source: "session",
        parentID: "ses_other",
        targetSessionID: "ses_other_running",
        messageID: "msg_other_running",
        status: "running",
        startedAt: "2026-04-30T10:10:00.000Z",
        updatedAt: "2026-04-30T10:10:00.000Z",
      }),
    ]);

    const defaultSnapshot = resolveTuiSubagentSnapshot({
      state,
      sessionID: "ses_current",
      nowMs,
    });
    const historySnapshot = resolveTuiSubagentSnapshot({
      state,
      sessionID: "ses_current",
      nowMs,
      showCompletedHistory: true,
    });

    expect(defaultSnapshot.showingOtherSessions).toBe(false);
    expect(defaultSnapshot.visibleChildren.map((item) => item.id)).toEqual([]);
    expect(defaultSnapshot.visibleCounts).toEqual({
      running: 0,
      done: 1,
      error: 1,
    });
    expect(defaultSnapshot.totalExecuted).toBe(2);
    expect(historySnapshot.visibleChildren).toHaveLength(2);
    expect(historySnapshot.visibleChildren.map((item) => item.id)).toEqual(
      expect.arrayContaining([
        "ses_current_error_old",
        "ses_current_done_old",
      ]),
    );
    expect(historySnapshot.visibleCounts).toEqual(defaultSnapshot.visibleCounts);
    expect(historySnapshot.totalExecuted).toBe(defaultSnapshot.totalExecuted);
  });

  it("does not fall back to other-session rows when current session has no retained executions", () => {
    const nowMs = Date.parse("2026-04-30T10:20:00.000Z");
    const state = stateWith([
      child({
        id: "tool_current_wrapper",
        title: "Current wrapper only",
        source: "tool",
        parentID: "ses_current",
        targetSessionID: undefined,
        messageID: "msg_current_wrapper",
        status: "done",
        color: "green",
        endedAt: "2026-04-30T10:19:00.000Z",
        updatedAt: "2026-04-30T10:19:00.000Z",
      }),
      child({
        id: "ses_other_running",
        title: "Other session running",
        source: "session",
        parentID: "ses_other",
        targetSessionID: "ses_other_running",
        messageID: "msg_other_running",
        status: "running",
        startedAt: "2026-04-30T10:10:00.000Z",
        updatedAt: "2026-04-30T10:10:00.000Z",
      }),
      child({
        id: "ses_other_done_old",
        title: "Other retained done",
        source: "session",
        parentID: "ses_other",
        targetSessionID: "ses_other_done_old",
        messageID: "msg_other_done",
        status: "done",
        color: "green",
        endedAt: "2026-04-30T10:02:00.000Z",
        updatedAt: "2026-04-30T10:02:00.000Z",
      }),
    ]);

    const defaultSnapshot = resolveTuiSubagentSnapshot({
      state,
      sessionID: "ses_current",
      nowMs,
    });

    expect(defaultSnapshot.showingOtherSessions).toBe(false);
    expect(defaultSnapshot.visibleChildren.map((item) => item.id)).toEqual([]);
    expect(defaultSnapshot.visibleCounts).toEqual({
      running: 0,
      done: 0,
      error: 0,
    });
    expect(defaultSnapshot.totalExecuted).toBe(0);
  });

  it("keeps the sidebar snapshot scoped to the current session", () => {
    const nowMs = Date.parse("2026-04-30T10:20:00.000Z");
    const state = stateWith([
      child({
        id: "tool_current_wrapper",
        title: "Current wrapper only",
        source: "tool",
        parentID: "ses_current",
        targetSessionID: undefined,
        messageID: "msg_current_wrapper",
        status: "done",
        color: "green",
        endedAt: "2026-04-30T10:19:00.000Z",
        updatedAt: "2026-04-30T10:19:00.000Z",
      }),
      child({
        id: "ses_other_running",
        title: "Other session running",
        source: "session",
        parentID: "ses_other",
        targetSessionID: "ses_other_running",
        messageID: "msg_other_running",
        status: "running",
        startedAt: "2026-04-30T10:10:00.000Z",
        updatedAt: "2026-04-30T10:10:00.000Z",
      }),
    ]);

    const snapshot = resolveSidebarSubagentSnapshot({
      state,
      sessionID: "ses_current",
      nowMs,
    });

    expect(snapshot.showingOtherSessions).toBe(false);
    expect(snapshot.visibleChildren.map((item) => item.id)).toEqual([]);
    expect(snapshot.visibleCounts).toEqual({ running: 0, done: 0, error: 0 });
    expect(snapshot.totalExecuted).toBe(0);
  });

  it("computes sidebar total from counted current-session execution identities", () => {
    const nowMs = Date.parse("2026-04-30T10:20:00.000Z");
    const state = stateWith(
      [
        child({
          id: "tool_current_proxy",
          title: "task",
          source: "tool",
          parentID: "ses_current",
          targetSessionID: "ses_current_child",
          messageID: "msg_current",
          status: "done",
          color: "green",
          endedAt: "2026-04-30T10:19:00.000Z",
          updatedAt: "2026-04-30T10:19:00.000Z",
        }),
        child({
          id: "ses_current_child",
          title: "Current child",
          source: "session",
          parentID: "ses_current",
          targetSessionID: "ses_current_child",
          messageID: "msg_current",
          status: "done",
          color: "green",
          endedAt: "2026-04-30T10:19:00.000Z",
          updatedAt: "2026-04-30T10:19:00.000Z",
        }),
        child({
          id: "ses_current_uncounted",
          title: "Uncounted current child",
          source: "session",
          parentID: "ses_current",
          targetSessionID: "ses_current_uncounted",
          messageID: "msg_uncounted",
          status: "done",
          color: "green",
          endedAt: "2026-04-30T10:19:00.000Z",
          updatedAt: "2026-04-30T10:19:00.000Z",
        }),
        child({
          id: "ses_other_child",
          title: "Other child",
          source: "session",
          parentID: "ses_other",
          targetSessionID: "ses_other_child",
          status: "done",
          color: "green",
          endedAt: "2026-04-30T10:19:00.000Z",
          updatedAt: "2026-04-30T10:19:00.000Z",
        }),
      ],
      ["ses_current_child", "ses_other_child"],
    );

    const snapshot = resolveSidebarSubagentSnapshot({
      state,
      sessionID: "ses_current",
      nowMs,
      showCompletedHistory: true,
    });

    expect(snapshot.visibleChildren.map((item) => item.id)).toEqual([
      "ses_current_child",
      "ses_current_uncounted",
    ]);
    expect(snapshot.visibleCounts).toEqual({ running: 0, done: 2, error: 0 });
    expect(snapshot.totalExecuted).toBe(1);
  });

  it("resolves sidebar and home snapshots from classified real executions only", () => {
    const nowMs = Date.parse("2026-04-30T10:20:00.000Z");
    const state = stateWith([
      child({
        id: "tool:delegate-wrapper",
        title: "Delegation: inspect counters",
        source: "tool",
        toolName: "delegate",
        targetSessionID: undefined,
        messageID: "msg_delegate",
      }),
      child({
        id: "tool:task-proxy",
        title: "task",
        source: "tool",
        toolName: "task",
        targetSessionID: "ses_real_running",
        messageID: "msg_real_running",
      }),
      child({
        id: "ses_real_running",
        title: "Delegation: real child still counts",
        source: "session",
        targetSessionID: "ses_real_running",
        messageID: "msg_real_running",
        status: "running",
      }),
      child({
        id: "ses_real_done_old",
        title: "Completed child",
        source: "session",
        targetSessionID: "ses_real_done_old",
        status: "done",
        color: "green",
        endedAt: "2026-04-30T10:02:00.000Z",
        updatedAt: "2026-04-30T10:02:00.000Z",
      }),
    ]);

    const sidebar = resolveTuiSubagentSnapshot({
      state,
      sessionID: "ses_parent",
      nowMs,
    });
    const home = resolveTuiSubagentSnapshot({ state, nowMs });

    expect(sidebar.visibleChildren.map((item) => item.id)).toEqual([
      "ses_real_running",
    ]);
    expect(sidebar.visibleCounts).toEqual({ running: 1, done: 1, error: 0 });
    expect(sidebar.totalExecuted).toBe(2);
    expect(home.visibleChildren.map((item) => item.id)).toEqual([
      "ses_real_running",
    ]);
    expect(home.visibleCounts).toEqual(sidebar.visibleCounts);
    expect(home.totalExecuted).toBe(2);
  });

  it("shows completed real history without adding wrappers to visible counts", () => {
    const nowMs = Date.parse("2026-04-30T10:20:00.000Z");
    const state = stateWith([
      child({
        id: "tool:old-wrapper",
        title: "delegate",
        source: "tool",
        toolName: "delegate",
        targetSessionID: undefined,
      }),
      child({
        id: "ses_real_done_old",
        title: "Delegation: old but real",
        source: "session",
        targetSessionID: "ses_real_done_old",
        status: "done",
        color: "green",
        endedAt: "2026-04-30T10:02:00.000Z",
        updatedAt: "2026-04-30T10:02:00.000Z",
      }),
    ]);

    const snapshot = resolveTuiSubagentSnapshot({
      state,
      sessionID: "ses_parent",
      nowMs,
      showCompletedHistory: true,
    });

    expect(snapshot.visibleChildren.map((item) => item.id)).toEqual([
      "ses_real_done_old",
    ]);
    expect(snapshot.visibleCounts).toEqual({ running: 0, done: 1, error: 0 });
    expect(snapshot.totalExecuted).toBe(1);
  });

  it("keeps stale errors historical while retaining status counters", () => {
    const nowMs = Date.parse("2026-04-30T10:20:00.000Z");
    const state = stateWith([
      child({
        id: "ses_real_running",
        title: "Active child",
        source: "session",
        targetSessionID: "ses_real_running",
        status: "running",
        startedAt: "2026-04-30T10:10:00.000Z",
        updatedAt: "2026-04-30T10:10:00.000Z",
      }),
      child({
        id: "ses_real_error_old",
        title: "Old failed child",
        source: "session",
        targetSessionID: "ses_real_error_old",
        status: "error",
        color: "red",
        endedAt: "2026-04-30T10:02:00.000Z",
        updatedAt: "2026-04-30T10:02:00.000Z",
      }),
    ]);

    const defaultSnapshot = resolveTuiSubagentSnapshot({
      state,
      sessionID: "ses_parent",
      nowMs,
    });
    const historySnapshot = resolveTuiSubagentSnapshot({
      state,
      sessionID: "ses_parent",
      nowMs,
      showCompletedHistory: true,
    });

    expect(defaultSnapshot.visibleChildren.map((item) => item.id)).toEqual([
      "ses_real_running",
    ]);
    expect(defaultSnapshot.visibleCounts).toEqual({
      running: 1,
      done: 0,
      error: 1,
    });
    expect(defaultSnapshot.totalExecuted).toBe(2);
    expect(historySnapshot.visibleChildren.map((item) => item.id)).toEqual([
      "ses_real_running",
      "ses_real_error_old",
    ]);
    expect(historySnapshot.visibleCounts).toEqual({
      running: 1,
      done: 0,
      error: 1,
    });
    expect(historySnapshot.totalExecuted).toBe(2);
  });

  it("excludes recent unrelated errors from active rows while retaining counters", () => {
    const nowMs = Date.parse("2026-04-30T10:20:00.000Z");
    const state = stateWith([
      child({
        id: "ses_real_running",
        title: "Active child",
        source: "session",
        targetSessionID: "ses_real_running",
        messageID: "msg_active",
        status: "running",
        startedAt: "2026-04-30T10:10:00.000Z",
        updatedAt: "2026-04-30T10:10:00.000Z",
      }),
      child({
        id: "ses_real_error_active",
        title: "Active failed child",
        source: "session",
        targetSessionID: "ses_real_error_active",
        messageID: "msg_active",
        status: "error",
        color: "red",
        endedAt: "2026-04-30T10:19:00.000Z",
        updatedAt: "2026-04-30T10:19:00.000Z",
      }),
      child({
        id: "ses_real_error_recent_unrelated",
        title: "Recent unrelated failed child",
        source: "session",
        targetSessionID: "ses_real_error_recent_unrelated",
        messageID: "msg_unrelated",
        status: "error",
        color: "red",
        endedAt: "2026-04-30T10:19:30.000Z",
        updatedAt: "2026-04-30T10:19:30.000Z",
      }),
    ]);

    const defaultSnapshot = resolveTuiSubagentSnapshot({
      state,
      sessionID: "ses_parent",
      nowMs,
    });
    const historySnapshot = resolveTuiSubagentSnapshot({
      state,
      sessionID: "ses_parent",
      nowMs,
      showCompletedHistory: true,
    });

    expect(defaultSnapshot.visibleChildren.map((item) => item.id)).toEqual([
      "ses_real_running",
      "ses_real_error_active",
    ]);
    expect(defaultSnapshot.visibleCounts).toEqual({
      running: 1,
      done: 0,
      error: 2,
    });
    expect(defaultSnapshot.totalExecuted).toBe(3);
    expect(historySnapshot.visibleChildren.map((item) => item.id)).toEqual([
      "ses_real_running",
      "ses_real_error_active",
      "ses_real_error_recent_unrelated",
    ]);
    expect(historySnapshot.visibleCounts).toEqual({
      running: 1,
      done: 0,
      error: 2,
    });
    expect(historySnapshot.totalExecuted).toBe(3);
  });

  it("backfills hydrated targets only when the real session match is unique", () => {
    const ambiguous = stateWith([
      child({
        id: "tool:ambiguous",
        source: "tool",
        toolName: "task",
        targetSessionID: undefined,
        messageID: "msg_wrapper",
      }),
      child({ id: "ses_first", targetSessionID: "ses_first" }),
      child({ id: "ses_second", targetSessionID: "ses_second" }),
    ]);

    expect(backfillHydratedTargetSessionIDs(ambiguous, "ses_parent")).toBe(
      false,
    );
    expect(ambiguous.children["tool:ambiguous"]?.targetSessionID).toBeUndefined();

    const unique = stateWith([
      child({
        id: "tool:matched",
        source: "tool",
        toolName: "task",
        targetSessionID: undefined,
        messageID: "msg_real",
      }),
      child({
        id: "ses_first",
        targetSessionID: "ses_first",
        messageID: "msg_other",
      }),
      child({
        id: "ses_second",
        targetSessionID: "ses_second",
        messageID: "msg_real",
      }),
    ]);

    expect(backfillHydratedTargetSessionIDs(unique, "ses_parent")).toBe(true);
    expect(unique.children["tool:matched"]?.targetSessionID).toBe("ses_second");
  });
});

describe("hydratePreviousSubagents", () => {
  const hydratedChild = {
    id: "ses_child",
    parentID: "ses_parent",
    title: "Hydrated child",
    agent: "sdd-propose",
    time: { created: "2026-04-30T10:00:00.000Z" },
  };

  it("skips child-session stubs with no status, messages, or parent evidence", async () => {
    const state = await hydrateState({
      children: [hydratedChild],
      childMessages: { ses_child: [] },
      statuses: {},
    });

    expect(state.children).not.toHaveProperty("ses_child");
    expect(
      resolveTuiSubagentSnapshot({ state, sessionID: "ses_parent" })
        .visibleCounts,
    ).toEqual({ running: 0, done: 0, error: 0 });
  });

  it("hydrates a child with explicit running status", async () => {
    const state = await hydrateState({
      children: [hydratedChild],
      childMessages: { ses_child: [] },
      statuses: { ses_child: { status: "running" } },
    });

    expect(state.children["ses_child"]?.status).toBe("running");
    expect(
      resolveTuiSubagentSnapshot({ state, sessionID: "ses_parent" })
        .visibleCounts,
    ).toEqual({ running: 1, done: 0, error: 0 });
  });

  it("hydrates model metadata from direct and enveloped child messages", async () => {
    const state = await hydrateState({
      children: [
        hydratedChild,
        { ...hydratedChild, id: "ses_envelope" },
      ],
      childMessages: {
        ses_child: [{
          sessionID: "ses_child",
          role: "assistant",
          providerID: "openai",
          modelID: "gpt-5.6",
          variant: "high",
          time: { created: 10 },
        }],
        ses_envelope: [{
          info: {
            sessionID: "ses_envelope",
            role: "assistant",
            providerID: "anthropic",
            modelID: "claude-sonnet",
            variant: "max",
            time: { created: 20 },
          },
          parts: [],
        }],
      },
      statuses: {
        ses_child: { status: "running" },
        ses_envelope: { status: "running" },
      },
    });

    expect(state.children.ses_child.model).toEqual({
      providerID: "openai",
      modelID: "gpt-5.6",
      variant: "high",
    });
    expect(state.children.ses_envelope.model).toEqual({
      providerID: "anthropic",
      modelID: "claude-sonnet",
      variant: "max",
    });
  });

  it("hydrates terminal done and error evidence", async () => {
    const errorAt = new Date().toISOString();
    const state = await hydrateState({
      children: [
        { ...hydratedChild, id: "ses_done", title: "Done child" },
        { ...hydratedChild, id: "ses_error", title: "Error child" },
      ],
      childMessages: {
        ses_done: [],
        ses_error: [
          {
            info: {
              role: "assistant",
              error: { detail: "Unsupported content type" },
              time: { updated: errorAt },
            },
            parts: [],
          },
        ],
      },
      statuses: { ses_done: { status: "idle" } },
    });

    expect(state.children["ses_done"]?.status).toBe("done");
    expect(state.children["ses_error"]?.status).toBe("error");
    expect(
      resolveTuiSubagentSnapshot({ state, sessionID: "ses_parent" })
        .visibleCounts,
    ).toEqual({ running: 0, done: 1, error: 1 });
  });

  it("hydrates a child linked by parent tool evidence", async () => {
    const state = await hydrateState({
      children: [hydratedChild],
      parentMessages: [
        {
          id: "msg_parent",
          info: { id: "msg_parent", role: "assistant" },
          parts: [
            {
              id: "part_task",
              type: "tool",
              tool: "task",
              sessionID: "ses_parent",
              state: {
                status: "running",
                metadata: { sessionId: "ses_child" },
                input: {
                  description: "Hydrated child",
                  subagent_type: "sdd-propose",
                },
              },
            },
          ],
        },
      ],
      childMessages: { ses_child: [] },
      statuses: {},
    });

    expect(state.children["ses_child"]?.status).toBe("running");
    expect(state.children["tool:part_task"]?.targetSessionID).toBe(
      "ses_child",
    );
  });

  it("hydrates terminal parent task evidence onto the real child session", async () => {
    const completedAt = new Date().toISOString();
    const state = await hydrateState({
      children: [hydratedChild],
      parentMessages: [
        {
          id: "msg_parent",
          info: {
            id: "msg_parent",
            role: "assistant",
            time: { completed: completedAt },
          },
          parts: [
            {
              id: "part_task",
              type: "tool",
              tool: "task",
              sessionID: "ses_parent",
              state: {
                status: "completed",
                metadata: { sessionId: "ses_child" },
                input: {
                  description: "Hydrated child",
                  subagent_type: "sdd-propose",
                },
              },
            },
          ],
        },
      ],
      childMessages: { ses_child: [] },
      statuses: {},
    });

    expect(state.children["ses_child"]?.status).toBe("done");
    expect(state.children["tool:part_task"]?.status).toBe("done");
  });

  it("does not hydrate an empty child from an incidental parent text mention", async () => {
    const state = await hydrateState({
      children: [hydratedChild],
      parentMessages: [
        {
          id: "msg_parent",
          info: { id: "msg_parent", role: "assistant" },
          parts: [
            {
              id: "part_text",
              type: "text",
              text: "The log mentioned ses_child, but no task metadata linked it.",
            },
            {
              id: "part_task",
              type: "tool",
              tool: "task",
              sessionID: "ses_parent",
              state: {
                status: "completed",
                output: "unstructured log mentioned ses_child",
                input: { description: "Unrelated task" },
              },
            },
          ],
        },
      ],
      childMessages: { ses_child: [] },
      statuses: {},
    });

    expect(state.children).not.toHaveProperty("ses_child");
  });
});

describe("probeRunningEvidence", () => {
  it("lets client status nested error evidence override direct done status", async () => {
    const api = {
      state: {
        session: {
          status: vi.fn(() => "done"),
        },
      },
      client: {
        session: {
          status: vi.fn(async () => ({
            data: {
              ses_child: {
                status: "idle",
                info: { error: { detail: "Unsupported content type" } },
              },
            },
          })),
          messages: vi.fn(async () => ({ data: [] })),
        },
      },
    } as unknown as TuiPluginApi;

    const evidence = await probeRunningEvidence({
      api,
      targetSessionID: "ses_child",
      directory: "/repo",
      candidateAgeMs: 60_000,
      nowMs: Date.now(),
    });

    expect(evidence.status).toBe("error");
    expect(api.client.session.status).toHaveBeenCalledOnce();
    expect(api.client.session.messages).not.toHaveBeenCalled();
  });
});

describe("TUI subagent hydration", () => {
  async function hydrateWith(input: {
    initialChildren?: ChildSessionState[];
    children: unknown[];
    statuses?: Record<string, unknown>;
    messagesBySession?: Record<string, unknown[]>;
    failMessagesFor?: string[];
    failStatus?: boolean;
  }): Promise<StatuslineState> {
    let state = stateWith(input.initialChildren ?? []);
    const directory = await mkdtemp(join(tmpdir(), "subagent-tui-hydrate-"));
    const api = {
      state: {
        path: { directory },
        session: {
          status: vi.fn(),
          messages: vi.fn(),
        },
        part: vi.fn(),
      },
      client: {
        session: {
          children: vi.fn(async () => ({ data: input.children })),
          messages: vi.fn(async ({ sessionID }: { sessionID: string }) => {
            if (input.failMessagesFor?.includes(sessionID)) {
              throw new Error(`failed to read messages for ${sessionID}`);
            }
            return { data: input.messagesBySession?.[sessionID] ?? [] };
          }),
          status: vi.fn(async () => {
            if (input.failStatus) {
              throw new Error("failed to read statuses");
            }
            return { data: input.statuses ?? {} };
          }),
        },
      },
    };

    await hydratePreviousSubagents(
      api as never,
      "ses_parent",
      join(directory, "state.json"),
      join(directory, "status.txt"),
      (fn) => {
        state = fn(state);
      },
    );

    return state;
  }

  it("does not leave visible running rows from historical children without status evidence", async () => {
    const state = await hydrateWith({
      initialChildren: [
        child({
          id: "ses_child_historical",
          parentID: "ses_parent",
          title: "Historical child",
          source: "session",
          targetSessionID: "ses_child_historical",
          status: "running",
        }),
      ],
      children: [
        {
          id: "ses_child_historical",
          parentID: "ses_parent",
          title: "Historical child",
          time: { created: "2026-04-30T10:00:00.000Z" },
        },
      ],
      statuses: {},
    });

    const snapshot = resolveTuiSubagentSnapshot({
      state,
      sessionID: "ses_parent",
      nowMs: Date.parse("2026-04-30T10:20:00.000Z"),
    });

    expect(Object.keys(state.children)).toEqual([]);
    expect(snapshot.visibleChildren).toEqual([]);
    expect(snapshot.visibleCounts).toEqual({ running: 0, done: 0, error: 0 });
    expect(snapshot.totalExecuted).toBe(0);
  });

  it("preserves an existing running row when child-message evidence fails", async () => {
    const state = await hydrateWith({
      initialChildren: [
        child({
          id: "ses_child_running",
          parentID: "ses_parent",
          title: "Running child",
          source: "session",
          targetSessionID: "ses_child_running",
          status: "running",
        }),
      ],
      children: [
        {
          id: "ses_child_running",
          parentID: "ses_parent",
          title: "Running child",
          time: { created: "2026-04-30T10:00:00.000Z" },
        },
      ],
      statuses: {},
      failMessagesFor: ["ses_child_running"],
    });

    expect(state.children.ses_child_running?.status).toBe("running");
  });

  it("preserves an existing running row when parent-message evidence fails", async () => {
    const state = await hydrateWith({
      initialChildren: [
        child({
          id: "ses_child_running",
          parentID: "ses_parent",
          title: "Running child",
          source: "session",
          targetSessionID: "ses_child_running",
          status: "running",
        }),
      ],
      children: [
        {
          id: "ses_child_running",
          parentID: "ses_parent",
          title: "Running child",
          time: { created: "2026-04-30T10:00:00.000Z" },
        },
      ],
      statuses: {},
      failMessagesFor: ["ses_parent"],
    });

    expect(state.children.ses_child_running?.status).toBe("running");
  });

  it("preserves an existing current-session running row when status hydration fails", async () => {
    const state = await hydrateWith({
      initialChildren: [
        child({
          id: "ses_child_running",
          parentID: "ses_parent",
          title: "Running child",
          source: "session",
          targetSessionID: "ses_child_running",
          status: "running",
        }),
      ],
      children: [
        {
          id: "ses_child_running",
          parentID: "ses_parent",
          title: "Running child",
          time: { created: "2026-04-30T10:00:00.000Z" },
        },
      ],
      messagesBySession: {
        ses_parent: [],
        ses_child_running: [],
      },
      failStatus: true,
    });

    const snapshot = resolveTuiSubagentSnapshot({
      state,
      sessionID: "ses_parent",
      nowMs: Date.parse("2026-04-30T10:20:00.000Z"),
    });

    expect(state.children.ses_child_running?.status).toBe("running");
    expect(snapshot.visibleChildren.map((item) => item.id)).toEqual([
      "ses_child_running",
    ]);
  });

  it("hydrates a visible running row when child status is explicitly busy", async () => {
    const state = await hydrateWith({
      children: [
        {
          id: "ses_child_running",
          parentID: "ses_parent",
          title: "Running child",
          time: { created: "2026-04-30T10:00:00.000Z" },
        },
      ],
      statuses: { ses_child_running: { status: "busy" } },
    });

    const snapshot = resolveTuiSubagentSnapshot({
      state,
      sessionID: "ses_parent",
      nowMs: Date.parse("2026-04-30T10:20:00.000Z"),
    });

    expect(snapshot.visibleChildren.map((item) => item.id)).toEqual([
      "ses_child_running",
    ]);
    expect(snapshot.visibleCounts).toEqual({ running: 1, done: 0, error: 0 });
    expect(snapshot.totalExecuted).toBe(1);
  });

  it("hydrates terminal child statuses without leaving them running", async () => {
    const updatedAt = new Date().toISOString();
    const state = await hydrateWith({
      children: [
        {
          id: "ses_child_done",
          parentID: "ses_parent",
          title: "Done child",
          time: {
            created: "2026-04-30T10:00:00.000Z",
            updated: updatedAt,
          },
        },
      ],
      statuses: { ses_child_done: { status: "idle" } },
    });

    expect(state.children.ses_child_done?.status).toBe("done");
    expect(state.children.ses_child_done?.endedAt).toBe(updatedAt);
  });
});

describe("registerSubagentCommands", () => {
  it("registers both keymap and legacy commands when both APIs are available", () => {
    const keymapDispose = vi.fn();
    const legacyDispose = vi.fn();
    const registerLayer = vi.fn(() => keymapDispose);
    const commandRegister = vi.fn(() => legacyDispose);
    const toggleSection = vi.fn();
    const focusSidebarList = vi.fn();
    const toggleCompletedHistory = vi.fn();

    const result = registerSubagentCommands({
      api: {
        keymap: { registerLayer },
        command: { register: commandRegister },
      },
      sectionEnabled: () => true,
      toggleSection,
      focusSidebarList,
      toggleCompletedHistory,
    });

    expect(commandRegister).toHaveBeenCalledOnce();
    expect(registerLayer).toHaveBeenCalledOnce();
    expect(registerLayer).toHaveBeenCalledWith({
      commands: [
        expect.objectContaining({
          name: "subagent-statusline.toggle-sidebar-section",
          title: expect.stringContaining("Subagents"),
          run: expect.any(Function),
        }),
        expect.objectContaining({
          name: "subagent-statusline.focus-sidebar-list",
          title: "Subagents: Focus sidebar list",
          run: expect.any(Function),
        }),
        expect.objectContaining({
          name: "subagent-statusline.toggle-completed-history",
          title: "Subagents: Toggle completed history",
          run: expect.any(Function),
        }),
      ],
      bindings: [
        {
          key: "alt+b",
          cmd: "subagent-statusline.focus-sidebar-list",
        },
      ],
    });

    const layer = registerLayer.mock.calls[0]?.[0];
    layer?.commands?.[0]?.run();
    layer?.commands?.[1]?.run();
    layer?.commands?.[2]?.run();

    const legacyCommands = commandRegister.mock.calls[0]?.[0]?.();
    legacyCommands?.[0]?.onSelect?.();
    legacyCommands?.[1]?.onSelect?.();
    legacyCommands?.[2]?.onSelect?.();

    expect(toggleSection).toHaveBeenNthCalledWith(1, false);
    expect(toggleSection).toHaveBeenNthCalledWith(2, false);
    expect(focusSidebarList).toHaveBeenCalledTimes(2);
    expect(toggleCompletedHistory).toHaveBeenCalledTimes(2);

    expect(legacyCommands).toEqual([
      expect.objectContaining({
        value: "subagent-statusline.toggle-sidebar-section",
        description: "Toggle the entire subagent sidebar section",
        category: "Subagents",
      }),
      expect.objectContaining({
        title: "Subagents: Focus sidebar list",
        value: "subagent-statusline.focus-sidebar-list",
        keybind: "alt+b",
      }),
      expect.objectContaining({
        title: "Subagents: Toggle completed history",
        value: "subagent-statusline.toggle-completed-history",
        description: expect.stringContaining("Shortcut: c"),
      }),
    ]);

    result();
    expect(keymapDispose).toHaveBeenCalledOnce();
    expect(legacyDispose).toHaveBeenCalledOnce();

    result();
    expect(keymapDispose).toHaveBeenCalledOnce();
    expect(legacyDispose).toHaveBeenCalledOnce();
  });

  it("registers only keymap when legacy API is unavailable", () => {
    const dispose = vi.fn();
    const registerLayer = vi.fn(() => dispose);
    const toggleSection = vi.fn();
    const focusSidebarList = vi.fn();
    const toggleCompletedHistory = vi.fn();

    const result = registerSubagentCommands({
      api: {
        keymap: { registerLayer },
      },
      sectionEnabled: () => true,
      toggleSection,
      focusSidebarList,
      toggleCompletedHistory,
    });

    expect(registerLayer).toHaveBeenCalledOnce();
    const layer = registerLayer.mock.calls[0]?.[0];
    expect(layer?.bindings).toEqual([
      {
        key: "alt+b",
        cmd: "subagent-statusline.focus-sidebar-list",
      },
    ]);

    layer?.commands?.[0]?.run();
    layer?.commands?.[1]?.run();
    layer?.commands?.[2]?.run();
    expect(toggleSection).toHaveBeenCalledWith(false);
    expect(focusSidebarList).toHaveBeenCalledOnce();
    expect(toggleCompletedHistory).toHaveBeenCalledOnce();

    result();
    expect(dispose).toHaveBeenCalledOnce();
  });

  it("falls back to the legacy command API when keymap is unavailable", () => {
    const dispose = vi.fn();
    const register = vi.fn(() => dispose);
    const toggleSection = vi.fn();
    const focusSidebarList = vi.fn();
    const toggleCompletedHistory = vi.fn();

    const result = registerSubagentCommands({
      api: { command: { register } },
      sectionEnabled: () => false,
      toggleSection,
      focusSidebarList,
      toggleCompletedHistory,
    });

    expect(register).toHaveBeenCalledOnce();
    const legacyCommands = register.mock.calls[0]?.[0]?.();
    expect(legacyCommands).toEqual([
      expect.objectContaining({
        title: "Subagents: Enable sidebar section",
        value: "subagent-statusline.toggle-sidebar-section",
      }),
      expect.objectContaining({
        value: "subagent-statusline.focus-sidebar-list",
        keybind: "alt+b",
      }),
      expect.objectContaining({
        value: "subagent-statusline.toggle-completed-history",
        description: expect.stringContaining("sidebar list is focused"),
      }),
    ]);

    legacyCommands?.[0]?.onSelect?.();
    legacyCommands?.[1]?.onSelect?.();
    legacyCommands?.[2]?.onSelect?.();
    expect(toggleSection).toHaveBeenCalledWith(true);
    expect(focusSidebarList).toHaveBeenCalledOnce();
    expect(toggleCompletedHistory).toHaveBeenCalledOnce();

    result();
    expect(dispose).toHaveBeenCalledOnce();
  });

  it("returns a safe no-op disposer when neither API is available", () => {
    const result = registerSubagentCommands({
      api: {},
      sectionEnabled: () => false,
      toggleSection: vi.fn(),
      focusSidebarList: vi.fn(),
      toggleCompletedHistory: vi.fn(),
    });

    expect(() => result()).not.toThrow();
    expect(() => result()).not.toThrow();
  });

  it("disposes all created registrations even if one dispose throws", () => {
    const keymapDispose = vi.fn(() => {
      throw new Error("keymap dispose failed");
    });
    const legacyDispose = vi.fn();
    const registerLayer = vi.fn(() => keymapDispose);
    const register = vi.fn(() => legacyDispose);

    const result = registerSubagentCommands({
      api: {
        keymap: { registerLayer },
        command: { register },
      },
      sectionEnabled: () => false,
      toggleSection: vi.fn(),
      focusSidebarList: vi.fn(),
      toggleCompletedHistory: vi.fn(),
    });

    expect(() => result()).not.toThrow();
    expect(keymapDispose).toHaveBeenCalledOnce();
    expect(legacyDispose).toHaveBeenCalledOnce();

    result();
    expect(keymapDispose).toHaveBeenCalledOnce();
    expect(legacyDispose).toHaveBeenCalledOnce();
  });
});

describe("readOpenCodeLogFileIfSmall", () => {
  it("skips oversized OpenCode logs before reading them synchronously", async () => {
    const dir = await mkdtemp(join(tmpdir(), "subagent-statusline-logs-"));
    const smallLog = join(dir, "small.log");
    const hugeLog = join(dir, "huge.log");

    await writeFile(smallLog, "small log", "utf8");
    await writeFile(hugeLog, `${"x".repeat(1024 * 1024)}x`, "utf8");

    expect(readOpenCodeLogFileIfSmall(smallLog)).toBe("small log");
    expect(readOpenCodeLogFileIfSmall(hugeLog)).toBeUndefined();
  });
});

describe("resolveSidebarReturnFocusAction", () => {
  const pendingSidebarRefocus = {
    parentSessionID: "parent",
    childSessionID: "child",
    childRowID: "row-1",
  };

  it("returns focus-prompt for remembered child -> parent return", () => {
    expect(
      resolveSidebarReturnFocusAction({
        pendingSidebarRefocus,
        previousRouteSessionID: "child",
        routeSessionID: "parent",
      }),
    ).toBe("focus-prompt");
  });

  it("returns focus-prompt while preserving showCompletedHistory", () => {
    expect(
      resolveSidebarReturnFocusAction({
        pendingSidebarRefocus: {
          ...pendingSidebarRefocus,
          showCompletedHistory: true,
        },
        previousRouteSessionID: "child",
        routeSessionID: "parent",
      }),
    ).toBe("focus-prompt");
  });

  it("returns clear-pending when route leaves remembered child path", () => {
    expect(
      resolveSidebarReturnFocusAction({
        pendingSidebarRefocus,
        previousRouteSessionID: "child",
        routeSessionID: "another",
      }),
    ).toBe("clear-pending");
  });

  it("returns none for unrelated transitions while still on child", () => {
    expect(
      resolveSidebarReturnFocusAction({
        pendingSidebarRefocus,
        previousRouteSessionID: "parent",
        routeSessionID: "child",
      }),
    ).toBe("none");
  });

  it("returns none when no pending sidebar navigation exists", () => {
    expect(
      resolveSidebarReturnFocusAction({
        previousRouteSessionID: "child",
        routeSessionID: "parent",
      }),
    ).toBe("none");
  });
});

describe("shouldReleaseSidebarListFocus", () => {
  it("releases active list focus when the last running subagent completes", () => {
    expect(
      shouldReleaseSidebarListFocus({
        previousRunningCount: 1,
        runningCount: 0,
        listFocusModeActive: true,
      }),
    ).toBe(true);
  });

  it("preserves list focus without a running-to-terminal transition", () => {
    expect(
      shouldReleaseSidebarListFocus({
        previousRunningCount: 0,
        runningCount: 0,
        listFocusModeActive: true,
      }),
    ).toBe(false);
    expect(
      shouldReleaseSidebarListFocus({
        previousRunningCount: 1,
        runningCount: 0,
        listFocusModeActive: false,
      }),
    ).toBe(false);
  });
});

describe("resolveSiblingSidebarRefocus", () => {
  const pendingSidebarRefocus = {
    parentSessionID: "parent",
    childSessionID: "child-a",
    childRowID: "row-a",
  };

  it("returns updated child row ID when navigating to a sibling subagent", () => {
    expect(
      resolveSiblingSidebarRefocus({
        pendingSidebarRefocus,
        routeSessionID: "child-b",
        children: {
          "row-a": { id: "row-a", parentID: "parent", targetSessionID: "child-a" },
          "row-b": { id: "row-b", parentID: "parent", targetSessionID: "child-b" },
        },
      }),
    ).toEqual({ childSessionID: "child-b", childRowID: "row-b" });
  });

  it("returns undefined when route returns to parent", () => {
    expect(
      resolveSiblingSidebarRefocus({
        pendingSidebarRefocus,
        routeSessionID: "parent",
        children: {
          "row-a": { id: "row-a", parentID: "parent", targetSessionID: "child-a" },
        },
      }),
    ).toBeUndefined();
  });

  it("returns undefined when route stays on recorded child", () => {
    expect(
      resolveSiblingSidebarRefocus({
        pendingSidebarRefocus,
        routeSessionID: "child-a",
        children: {
          "row-a": { id: "row-a", parentID: "parent", targetSessionID: "child-a" },
        },
      }),
    ).toBeUndefined();
  });

  it("returns undefined when target session is not a sibling", () => {
    expect(
      resolveSiblingSidebarRefocus({
        pendingSidebarRefocus,
        routeSessionID: "other-child",
        children: {
          "row-a": { id: "row-a", parentID: "parent", targetSessionID: "child-a" },
          "row-other": { id: "row-other", parentID: "other-parent", targetSessionID: "other-child" },
        },
      }),
    ).toBeUndefined();
  });
});

describe("focusPromptWithDeferredRetry", () => {
  it("retries once when prompt focus is initially unavailable", () => {
    const queue: Array<() => void> = [];
    const schedule = (callback: () => void): void => {
      queue.push(callback);
    };
    let hasPromptRef = false;
    const focus = vi.fn(() => {
      if (!hasPromptRef) {
        hasPromptRef = true;
        return false;
      }
      return true;
    });

    focusPromptWithDeferredRetry(focus, schedule);
    expect(queue).toHaveLength(1);
    queue.shift()?.();
    expect(focus).toHaveBeenCalledTimes(1);
    expect(queue).toHaveLength(1);
    queue.shift()?.();
    expect(focus).toHaveBeenCalledTimes(2);
  });
});
