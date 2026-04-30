import { describe, expect, it } from "vitest";
import {
  applySubagentEvent,
  extractChildDetails,
  extractSessionID,
  type EventLike,
} from "./events.js";
import { createEmptyState } from "./state.js";
import { readJsonFixture } from "../test/helpers/runtime-harness.js";

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

  it("extracts useful tool details while replacing technical delegation titles", async () => {
    const event = await readJsonFixture<EventLike>("tool-updated");

    expect(extractChildDetails(event)).toMatchObject({
      title: "Investigate flaky tests",
      summary: "Investigate why tests are flaky and report findings. Include commands run.",
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
});
