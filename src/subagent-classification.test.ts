import { describe, expect, it } from "vitest";
import {
  classifySubagentWorkItem,
  correlateSubagentWorkItems,
  isRealSessionID,
  isTrustedTargetSessionID,
  mergeProxyMetadataWithRealExecution,
  resolveCorrelatedExecutionID,
  trustedTargetSessionID,
  type SubagentClassifiableWorkItem,
} from "./subagent-classification.js";
import type { ChildSessionState } from "./state.js";

function item(
  overrides: Partial<ChildSessionState> = {},
): ChildSessionState {
  return {
    id: "ses_child",
    title: "Child work",
    parentID: "ses_parent",
    messageID: "msg_1",
    source: "session",
    targetSessionID: "ses_child",
    status: "running",
    color: "yellow",
    startedAt: "2026-04-30T10:00:00.000Z",
    updatedAt: "2026-04-30T10:01:00.000Z",
    elapsedMs: 61000,
    tokens: { total: 42, contextPercent: 12.5 },
    ...overrides,
  };
}

describe("subagent classification", () => {
  it("classifies real Delegation-titled sessions by semantic fields", () => {
    expect(isRealSessionID("ses_child")).toBe(true);
    expect(isRealSessionID("tool:delegate")).toBe(false);

    expect(
      classifySubagentWorkItem(
        item({ title: "Delegation: inspect history counters" }),
      ),
    ).toEqual({
      kind: "real-execution",
      executionID: "ses_child",
      targetSessionID: "ses_child",
    });
  });

  it("classifies targetless delegate, task, and subtask rows as wrappers", () => {
    const wrappers: SubagentClassifiableWorkItem[] = [
      item({
        id: "tool:delegate_call",
        source: "tool",
        toolName: "delegate",
        title: "Delegation: scout",
        targetSessionID: undefined,
      }),
      item({
        id: "tool:task_call",
        source: "tool",
        toolName: "task",
        title: "task",
        targetSessionID: undefined,
      }),
      item({
        id: "subtask:part_1",
        source: "subtask",
        title: "Investigate bug",
        targetSessionID: undefined,
      }),
    ];

    expect(wrappers.map(classifySubagentWorkItem)).toEqual([
      { kind: "invocation-wrapper" },
      { kind: "invocation-wrapper" },
      { kind: "invocation-wrapper" },
    ]);
  });

  it("classifies trusted target session rows as execution proxies", () => {
    const proxy = item({
      id: "tool:task_call",
      source: "tool",
      toolName: "task",
      targetSessionID: "ses_child",
    });

    expect(isTrustedTargetSessionID(proxy.targetSessionID)).toBe(true);
    expect(trustedTargetSessionID(proxy)).toBe("ses_child");
    expect(classifySubagentWorkItem(proxy)).toEqual({
      kind: "execution-proxy",
      executionID: "ses_child",
      targetSessionID: "ses_child",
    });
  });

  it("correlates proxies using trusted target and shared message evidence", () => {
    const real = item({ id: "ses_real", targetSessionID: "ses_real" });
    const targetedProxy = item({
      id: "tool:targeted",
      source: "tool",
      targetSessionID: "ses_real",
    });
    const messageWrapper = item({
      id: "subtask:message_match",
      source: "subtask",
      targetSessionID: undefined,
      messageID: "msg_1",
    });

    expect(resolveCorrelatedExecutionID(targetedProxy, [real])).toBe(
      "ses_real",
    );
    expect(resolveCorrelatedExecutionID(messageWrapper, [real])).toBe(
      "ses_real",
    );
    expect(
      correlateSubagentWorkItems([targetedProxy, messageWrapper, real]),
    ).toEqual([
      {
        executionID: "ses_real",
        real,
        proxies: [targetedProxy, messageWrapper],
      },
    ]);
  });

  it("fails closed for ambiguous same-parent wrappers", () => {
    const wrapper = item({
      id: "tool:ambiguous",
      source: "tool",
      targetSessionID: undefined,
      messageID: undefined,
    });
    const firstReal = item({
      id: "ses_first",
      targetSessionID: "ses_first",
      messageID: "msg_a",
    });
    const secondReal = item({
      id: "ses_second",
      targetSessionID: "ses_second",
      messageID: "msg_b",
    });

    expect(
      resolveCorrelatedExecutionID(wrapper, [firstReal, secondReal]),
    ).toBeUndefined();
    expect(
      correlateSubagentWorkItems([wrapper, firstReal, secondReal]),
    ).toEqual([
      { executionID: "ses_first", real: firstReal, proxies: [] },
      { executionID: "ses_second", real: secondReal, proxies: [] },
    ]);
  });

  it("fails closed when a trusted proxy target is missing from real candidates", () => {
    const proxy = item({
      id: "tool:missing-target",
      source: "tool",
      targetSessionID: "ses_missing",
      messageID: "msg_shared",
    });
    const unrelatedReal = item({
      id: "ses_unrelated",
      targetSessionID: "ses_unrelated",
      messageID: "msg_shared",
    });
    const sameParentOnlyProxy = item({
      id: "tool:missing-target-same-parent",
      source: "tool",
      targetSessionID: "ses_other_missing",
      messageID: undefined,
    });
    const sameParentReal = item({
      id: "ses_same_parent",
      targetSessionID: "ses_same_parent",
      messageID: "msg_other",
    });

    expect(resolveCorrelatedExecutionID(proxy, [unrelatedReal])).toBeUndefined();
    expect(correlateSubagentWorkItems([proxy, unrelatedReal])).toEqual([
      { executionID: "ses_unrelated", real: unrelatedReal, proxies: [] },
    ]);
    expect(
      resolveCorrelatedExecutionID(sameParentOnlyProxy, [sameParentReal]),
    ).toBeUndefined();
    expect(
      correlateSubagentWorkItems([sameParentOnlyProxy, sameParentReal]),
    ).toEqual([
      { executionID: "ses_same_parent", real: sameParentReal, proxies: [] },
    ]);
  });

  it("merges safe proxy display metadata without replacing real execution state", () => {
    const real = item({
      id: "ses_real",
      targetSessionID: "ses_real",
      title: "Delegation: generated title",
      status: "done",
      color: "green",
      endedAt: "2026-04-30T10:05:00.000Z",
      elapsedMs: 300000,
    });
    const proxy = item({
      id: "tool:proxy",
      source: "tool",
      title: "Review classifier behavior",
      summary: "Check wrapper semantics",
      agentName: "reviewer",
      targetSessionID: "ses_real",
      status: "running",
      color: "yellow",
      tokens: { total: 999 },
    });

    expect(mergeProxyMetadataWithRealExecution(real, proxy)).toMatchObject({
      id: "ses_real",
      source: "session",
      targetSessionID: "ses_real",
      title: "Review classifier behavior",
      summary: "Check wrapper semantics",
      agentName: "reviewer",
      status: "done",
      color: "green",
      endedAt: "2026-04-30T10:05:00.000Z",
      elapsedMs: 300000,
      tokens: { total: 42, contextPercent: 12.5 },
    });
  });
});
