import { describe, expect, it } from "vitest";
import {
  applySubagentEvent,
  extractChildDetails,
  extractSessionID,
  extractTaskToolEvidence,
  type EventLike,
} from "./events.js";
import { createEmptyState } from "./state.js";
import { readJsonFixture } from "../test/helpers/runtime-harness.js";

function upsertSubtask(
  state: ReturnType<typeof createEmptyState>,
  input: {
    partID: string;
    parentID: string;
    messageID: string;
    description: string;
  },
) {
  applySubagentEvent(state, {
    type: "message.part.updated",
    properties: {
      sessionID: input.parentID,
      part: {
        type: "subtask",
        id: input.partID,
        sessionID: input.parentID,
        messageID: input.messageID,
        description: input.description,
      },
    },
  });
}

describe("events", () => {
  it("extracts session identifiers from supported event locations", () => {
    expect(extractSessionID({ properties: { sessionID: "ses_props" } })).toBe(
      "ses_props",
    );
    expect(extractSessionID({ sessionId: "ses_top" })).toBe("ses_top");
    expect(extractSessionID({ properties: { info: { id: "ses_info" } } })).toBe(
      "ses_info",
    );
  });

  it("applies session-created events as running children", async () => {
    const event = await readJsonFixture("session-created");
    const state = createEmptyState();

    expect(applySubagentEvent(state, event)).toBe(true);

    expect(state.children.ses_child_1).toMatchObject({
      id: "ses_child_1",
      title: "Review auth changes",
      agentName: "reviewer",
      parentID: "ses_parent_1",
      source: "session",
      targetSessionID: "ses_child_1",
      status: "running",
      color: "yellow",
    });
    expect(state.totalExecuted).toBe(1);
    expect(state.countedChildIDs.ses_child_1).toBe(true);
  });

  it("keeps real Delegation-titled sessions as session-sourced executions", () => {
    const state = createEmptyState();

    expect(
      applySubagentEvent(state, {
        type: "session.created",
        properties: {
          info: {
            id: "ses_real_delegation",
            parentID: "ses_parent",
            title: "Delegation: investigate flaky tests",
          },
        },
      }),
    ).toBe(true);

    expect(state.children.ses_real_delegation).toMatchObject({
      id: "ses_real_delegation",
      title: "Delegation: investigate flaky tests",
      source: "session",
      targetSessionID: "ses_real_delegation",
      status: "running",
    });
    expect(state.totalExecuted).toBe(1);
    expect(state.countedChildIDs.ses_real_delegation).toBe(true);
  });

  it("preserves delegate tool semantic fields without inventing execution evidence", () => {
    const state = createEmptyState();

    expect(
      applySubagentEvent(state, {
        type: "message.part.updated",
        properties: {
          sessionID: "ses_parent",
          part: {
            type: "tool",
            tool: "delegate",
            id: "delegate_1",
            sessionID: "ses_parent",
            messageID: "msg_delegate_1",
            state: {
              status: "running",
              input: {
                description: "Inspect counters",
                subagent_type: "reviewer",
              },
            },
          },
        },
      }),
    ).toBe(true);

    expect(state.children["tool:delegate_1"]).toMatchObject({
      id: "tool:delegate_1",
      title: "Inspect counters",
      parentID: "ses_parent",
      messageID: "msg_delegate_1",
      source: "tool",
      toolName: "delegate",
      targetSessionID: undefined,
    });
    expect(state.totalExecuted).toBe(0);
    expect(state.countedChildIDs["tool:delegate_1"]).toBeUndefined();
  });

  it("preserves task tool target semantics without counting the wrapper", () => {
    const state = createEmptyState();

    expect(
      applySubagentEvent(state, {
        type: "message.part.updated",
        properties: {
          sessionID: "ses_parent",
          part: {
            type: "tool",
            tool: "task",
            id: "task_1",
            sessionID: "ses_parent",
            messageID: "msg_task_1",
            state: {
              status: "completed",
              input: { description: "Run sync task" },
              metadata: { sessionId: "ses_task_child" },
              time: { end: "2026-04-30T12:00:00.000Z" },
            },
          },
        },
      }),
    ).toBe(true);

    expect(state.children["tool:task_1"]).toMatchObject({
      id: "tool:task_1",
      title: "Run sync task",
      parentID: "ses_parent",
      messageID: "msg_task_1",
      source: "tool",
      toolName: "task",
      targetSessionID: "ses_task_child",
      status: "done",
    });
    expect(state.totalExecuted).toBe(0);
    expect(state.countedChildIDs["tool:task_1"]).toBeUndefined();
  });

  it("extracts useful tool details while replacing technical delegation titles", async () => {
    const event = await readJsonFixture<EventLike>("tool-updated");

    expect(extractChildDetails(event)).toMatchObject({
      title: "Investigate flaky tests",
      summary:
        "Investigate why tests are flaky and report findings. Include commands run.",
      agentName: "tester",
      tokens: {
        input: 1000,
        output: 250,
        contextPercent: 42,
      },
    });
  });

  it("is deterministic and safe for malformed input", async () => {
    const malformed = await readJsonFixture("malformed");
    const state = createEmptyState();

    expect(applySubagentEvent(state, malformed)).toBe(false);
    expect(applySubagentEvent(state, null)).toBe(false);
    expect(state.children).toEqual({});
  });

  it("maps session.status idle evidence to done", () => {
    const state = createEmptyState();
    applySubagentEvent(state, {
      type: "session.created",
      properties: {
        info: {
          id: "ses_child_status",
          parentID: "ses_parent",
          title: "Child status",
          time: { created: "2026-05-10T10:00:00.000Z" },
        },
      },
    });

    const changed = applySubagentEvent(state, {
      type: "session.status",
      properties: {
        sessionID: "ses_child_status",
        status: "idle",
        info: { time: { updated: "2026-05-10T10:15:00.000Z" } },
      },
    });

    expect(changed).toBe(true);
    expect(state.children.ses_child_status).toMatchObject({
      status: "done",
      endedAt: "2026-05-10T10:15:00.000Z",
    });
  });

  it("maps session.status idle with structured error evidence to error", () => {
    const state = createEmptyState();
    applySubagentEvent(state, {
      type: "session.created",
      properties: {
        info: {
          id: "ses_child_status_idle_error",
          parentID: "ses_parent",
          title: "Child status idle error",
          time: { created: "2026-05-10T10:00:00.000Z" },
        },
      },
    });

    const changed = applySubagentEvent(state, {
      type: "session.status",
      properties: {
        sessionID: "ses_child_status_idle_error",
        status: "idle",
        info: {
          error: {
            message: "Bad Request",
            detail: "Unsupported content type",
          },
          time: { updated: "2026-05-10T10:15:00.000Z" },
        },
      },
    });

    expect(changed).toBe(true);
    expect(state.children.ses_child_status_idle_error).toMatchObject({
      status: "error",
      endedAt: "2026-05-10T10:15:00.000Z",
    });
  });

  it("maps session.idle with structured error evidence to error", () => {
    const state = createEmptyState();
    applySubagentEvent(state, {
      type: "session.created",
      properties: {
        info: {
          id: "ses_child_idle_error",
          parentID: "ses_parent",
          title: "Child idle error",
          time: { created: "2026-05-10T10:00:00.000Z" },
        },
      },
    });

    const changed = applySubagentEvent(state, {
      type: "session.idle",
      properties: {
        sessionID: "ses_child_idle_error",
        info: {
          error: {
            message: "Bad Request",
            detail: "Unsupported content type",
          },
          time: { updated: "2026-05-10T10:15:00.000Z" },
        },
      },
    });

    expect(changed).toBe(true);
    expect(state.children.ses_child_idle_error).toMatchObject({
      status: "error",
      endedAt: "2026-05-10T10:15:00.000Z",
    });
  });

  it.each([
    "busy",
    "retry",
  ])("keeps a running child active for session.status %s", (status) => {
    const state = createEmptyState();
    applySubagentEvent(state, {
      type: "session.created",
      properties: {
        info: {
          id: "ses_child_running",
          parentID: "ses_parent",
          title: "Child running",
        },
      },
    });

    applySubagentEvent(state, {
      type: "session.status",
      properties: {
        sessionID: "ses_child_running",
        status,
      },
    });

    expect(state.children.ses_child_running?.status).toBe("running");
    expect(state.children.ses_child_running?.endedAt).toBeUndefined();
  });

  it("maps session.status terminal errors to error", () => {
    const state = createEmptyState();
    applySubagentEvent(state, {
      type: "session.created",
      properties: {
        info: {
          id: "ses_child_error",
          parentID: "ses_parent",
          title: "Child error",
        },
      },
    });

    applySubagentEvent(state, {
      type: "session.status",
      properties: {
        sessionID: "ses_child_error",
        status: "failed",
        info: { time: { updated: "2026-05-10T10:20:00.000Z" } },
      },
    });

    expect(state.children.ses_child_error).toMatchObject({
      status: "error",
      endedAt: "2026-05-10T10:20:00.000Z",
    });
  });
});

describe("extractTaskToolEvidence", () => {
  it("extracts task tool terminal status and metadata session id", () => {
    const evidence = extractTaskToolEvidence({
      type: "message.part.updated",
      properties: {
        part: {
          type: "tool",
          tool: "task",
          state: {
            status: "completed",
            metadata: { sessionId: "ses_child_1" },
            time: { end: "2026-04-30T12:00:00.000Z" },
          },
        },
      },
    });

    expect(evidence).toMatchObject({
      status: "done",
      targetSessionID: "ses_child_1",
      endedAt: "2026-04-30T12:00:00.000Z",
    });
  });

  it("falls back to parsing task_id from output", () => {
    const evidence = extractTaskToolEvidence({
      type: "message.part.updated",
      properties: {
        part: {
          type: "tool",
          tool: "task",
          state: {
            status: "error",
            output: "worker exited; task_id: ses_child_2",
            time: { end: "2026-04-30T12:05:00.000Z" },
          },
        },
      },
    });

    expect(evidence).toMatchObject({
      status: "error",
      targetSessionID: "ses_child_2",
      endedAt: "2026-04-30T12:05:00.000Z",
    });
  });

  it("parses task session ids from output variants", () => {
    expect(
      extractTaskToolEvidence({
        type: "message.part.updated",
        properties: {
          part: {
            type: "tool",
            tool: "task",
            state: {
              status: "completed",
              output: "Task ID: ses_child_3",
            },
          },
        },
      })?.targetSessionID,
    ).toBe("ses_child_3");

    expect(
      extractTaskToolEvidence({
        type: "message.part.updated",
        properties: {
          sessionID: "ses_parent",
          part: {
            type: "tool",
            tool: "task",
            sessionID: "ses_parent",
            state: {
              status: "completed",
              output: "parent ses_parent finished child ses_child_4",
            },
          },
        },
      })?.targetSessionID,
    ).toBe("ses_child_4");
  });

  it("does not infer a task target from ambiguous output session ids", () => {
    expect(
      extractTaskToolEvidence({
        type: "message.part.updated",
        properties: {
          part: {
            type: "tool",
            tool: "task",
            state: {
              status: "completed",
              output: "first ses_child_1 then ses_child_2",
            },
          },
        },
      })?.targetSessionID,
    ).toBeUndefined();
  });
});

describe("task tool to subtask mapping", () => {
  it("backfills a synchronous task tool wrapper when its session appears later", () => {
    const state = createEmptyState();

    applySubagentEvent(state, {
      type: "message.part.updated",
      properties: {
        sessionID: "ses_parent",
        part: {
          type: "tool",
          tool: "task",
          id: "tool_sync",
          sessionID: "ses_parent",
          messageID: "msg_sync",
          state: {
            status: "running",
            input: { description: "Run sync task" },
          },
        },
      },
    });

    expect(state.children["tool:tool_sync"]?.targetSessionID).toBeUndefined();
    expect(state.totalExecuted).toBe(0);

    applySubagentEvent(state, {
      type: "session.created",
      properties: {
        info: {
          id: "ses_sync_child",
          parentID: "ses_parent",
          title: "Child session with unrelated title",
        },
      },
    });

    expect(state.children["tool:tool_sync"]?.targetSessionID).toBe(
      "ses_sync_child",
    );
    expect(state.totalExecuted).toBe(1);
    expect(state.countedChildIDs.ses_sync_child).toBe(true);
    expect(state.countedChildIDs["tool:tool_sync"]).toBeUndefined();
  });

  it("does not backfill a targetless task wrapper when another session sibling already exists", () => {
    const state = createEmptyState();

    applySubagentEvent(state, {
      type: "session.created",
      properties: {
        info: {
          id: "ses_existing_child",
          parentID: "ses_parent",
          title: "Existing child",
        },
      },
    });
    applySubagentEvent(state, {
      type: "message.part.updated",
      properties: {
        sessionID: "ses_parent",
        part: {
          type: "tool",
          tool: "task",
          id: "tool_sync",
          sessionID: "ses_parent",
          state: {
            status: "running",
            input: { description: "Run sync task" },
          },
        },
      },
    });
    applySubagentEvent(state, {
      type: "session.created",
      properties: {
        info: {
          id: "ses_later_child",
          parentID: "ses_parent",
          title: "Later child",
        },
      },
    });

    expect(state.children["tool:tool_sync"]?.targetSessionID).toBeUndefined();
    expect(state.totalExecuted).toBe(2);
    expect(state.countedChildIDs.ses_existing_child).toBe(true);
    expect(state.countedChildIDs.ses_later_child).toBe(true);
  });

  it("maps completed task tool evidence to matching subtask row", () => {
    const state = createEmptyState();
    upsertSubtask(state, {
      partID: "sub_1",
      parentID: "ses_parent",
      messageID: "msg_1",
      description: "Initialize project",
    });

    applySubagentEvent(state, {
      type: "message.part.updated",
      properties: {
        sessionID: "ses_parent",
        part: {
          type: "tool",
          tool: "task",
          id: "tool_1",
          sessionID: "ses_parent",
          messageID: "msg_1",
          state: {
            status: "completed",
            input: { description: "Initialize project" },
            metadata: { sessionId: "ses_child_1" },
            time: { end: "2026-04-30T12:00:00.000Z" },
          },
        },
      },
    });

    expect(state.children["subtask:sub_1"]?.status).toBe("done");
    expect(state.children["subtask:sub_1"]?.targetSessionID).toBe(
      "ses_child_1",
    );
    expect(state.children["subtask:sub_1"]?.endedAt).toBe(
      "2026-04-30T12:00:00.000Z",
    );
  });

  it("fails closed for ambiguous mapping", () => {
    const state = createEmptyState();
    upsertSubtask(state, {
      partID: "sub_a",
      parentID: "ses_parent",
      messageID: "msg_1",
      description: "Run checks",
    });
    upsertSubtask(state, {
      partID: "sub_b",
      parentID: "ses_parent",
      messageID: "msg_1",
      description: "Run checks",
    });

    applySubagentEvent(state, {
      type: "message.part.updated",
      properties: {
        sessionID: "ses_parent",
        part: {
          type: "tool",
          tool: "task",
          id: "tool_2",
          sessionID: "ses_parent",
          messageID: "msg_1",
          state: {
            status: "completed",
            input: { description: "Run checks" },
            metadata: { sessionId: "ses_child_2" },
          },
        },
      },
    });

    expect(state.children["subtask:sub_a"]?.status).toBe("running");
    expect(state.children["subtask:sub_b"]?.status).toBe("running");
  });

  it("resolves legacy stale subtask row from parent task tool evidence", () => {
    const state = createEmptyState();
    upsertSubtask(state, {
      partID: "sub_legacy",
      parentID: "ses_parent",
      messageID: "msg_legacy",
      description: "sdd-init",
    });

    applySubagentEvent(state, {
      type: "message.part.updated",
      properties: {
        sessionID: "ses_parent",
        part: {
          type: "tool",
          tool: "task",
          id: "tool_legacy",
          sessionID: "ses_parent",
          messageID: "msg_legacy",
          state: {
            status: "error",
            input: { description: "sdd-init" },
            output: "task failed\ntask_id: ses_legacy_child",
            time: { end: "2026-04-30T12:10:00.000Z" },
          },
        },
      },
    });

    expect(state.children["subtask:sub_legacy"]?.status).toBe("error");
    expect(state.children["subtask:sub_legacy"]?.targetSessionID).toBe(
      "ses_legacy_child",
    );
    expect(state.children["subtask:sub_legacy"]?.endedAt).toBe(
      "2026-04-30T12:10:00.000Z",
    );
  });

  it("maps assistant task-tool evidence to subtask created in parent user message", () => {
    const state = createEmptyState();
    upsertSubtask(state, {
      partID: "prt_ddea56110001RtlmRJFV99PmiU",
      parentID: "ses_2215a9f08ffewGBrk9aJ973lCD",
      messageID: "msg_ddea560fd001mnSF0ssrplOLZq",
      description: "Execute subtask",
    });

    applySubagentEvent(state, {
      type: "message.part.updated",
      properties: {
        sessionID: "ses_2215a9f08ffewGBrk9aJ973lCD",
        info: {
          id: "msg_ddea5612d001eF07FXVVp66x4u",
          parentID: "msg_ddea560fd001mnSF0ssrplOLZq",
        },
        part: {
          type: "tool",
          tool: "task",
          id: "tool_ddea5612d001eF07FXVVp66x4u",
          sessionID: "ses_2215a9f08ffewGBrk9aJ973lCD",
          messageID: "msg_ddea5612d001eF07FXVVp66x4u",
          state: {
            status: "completed",
            metadata: { sessionId: "ses_2215a9eceffelCOOb8v66cT2v0" },
            time: { end: "2026-04-30T12:20:00.000Z" },
          },
        },
      },
    });

    expect(
      state.children["subtask:prt_ddea56110001RtlmRJFV99PmiU"]?.status,
    ).toBe("done");
    expect(
      state.children["subtask:prt_ddea56110001RtlmRJFV99PmiU"]?.targetSessionID,
    ).toBe("ses_2215a9eceffelCOOb8v66cT2v0");
    expect(
      state.children["subtask:prt_ddea56110001RtlmRJFV99PmiU"]?.endedAt,
    ).toBe("2026-04-30T12:20:00.000Z");
  });
});
