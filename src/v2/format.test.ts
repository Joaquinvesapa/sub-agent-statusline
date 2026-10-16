import { describe, expect, it } from "vitest";
import {
  CLOCK_ICON,
  LABEL_INDENT,
  SIDEBAR_ROW_WIDTH,
  TOKEN_ICON,
  elapsedFor,
  formatDuration,
  labelFor,
  metaFor,
  statusMarker,
  tokensFor,
  wrapLabel,
} from "./format.js";
import type { V2Session } from "./reconcile.js";

function session(overrides: Partial<V2Session> = {}): V2Session {
  return {
    id: "ses_child",
    parentID: "ses_parent",
    title: "Child work",
    time: { created: Date.now() - 60_000, updated: Date.now() - 59_000 },
    ...overrides,
  };
}

describe("formatDuration", () => {
  it("renders zero as MM:SS", () => {
    expect(formatDuration(0)).toBe("00:00");
  });

  it("renders sub-minute durations as MM:SS", () => {
    expect(formatDuration(999)).toBe("00:00");
    expect(formatDuration(59_999)).toBe("00:59");
  });

  it("renders minute boundaries without dropping seconds", () => {
    expect(formatDuration(60_000)).toBe("01:00");
    expect(formatDuration(4_143_000)).toBe("01:09:03");
  });

  it("renders ~1h durations as HH:MM:SS", () => {
    expect(formatDuration(3_600_000)).toBe("01:00:00");
    expect(formatDuration(3_659_999)).toBe("01:00:59");
  });

  it("clamps negative or undefined input to zero", () => {
    expect(formatDuration(-5000)).toBe("00:00");
    expect(formatDuration(undefined)).toBe("00:00");
  });

  it("fits rows with widths small enough to require the sidebar constant", () => {
    expect(SIDEBAR_ROW_WIDTH).toBe(34);
  });
});

describe("tokensFor", () => {
  it("formats raw token counts with en-US separators", () => {
    expect(tokensFor(session({ tokens: { input: 42, output: 0 } }))).toBe(
      "42 tok",
    );
    expect(tokensFor(session({ tokens: { input: 1_000, output: 234 } }))).toBe(
      "1,234 tok",
    );
  });

  it("formats million-scale counts as M", () => {
    expect(tokensFor(session({ tokens: { input: 1_200_000, output: 0 } }))).toBe(
      "1.2M tok",
    );
    expect(tokensFor(session({ tokens: { input: 3_000_000, output: 0 } }))).toBe(
      "3.0M tok",
    );
  });

  it("omits the token marker when absent or empty", () => {
    expect(tokensFor(session())).toBeUndefined();
    expect(tokensFor(session({ tokens: { input: 0, output: 0 } }))).toBeUndefined();
  });

  it("sums input and output when both are present", () => {
    expect(tokensFor(session({ tokens: { input: 800, output: 400 } }))).toBe(
      "1,200 tok",
    );
  });
});

describe("statusMarker", () => {
  it("maps done/error/stale/running to the bracketed V1 markers", () => {
    expect(statusMarker(session({ outcome: "succeeded" }))).toBe("[✓]");
    expect(statusMarker(session({ outcome: "failed" }))).toBe("[x]");
    expect(statusMarker(session({ outcome: "interrupted" }))).toBe("[x]");
    expect(statusMarker(session())).toBe("[ ]");
  });

  it("marks a stale running session with the tilde marker", () => {
    const stale = session({
      time: { created: 1_000, updated: 100 },
    });
    expect(statusMarker(stale)).toBe("[~]");
  });
});

describe("labelFor", () => {
  it("uses the title as the label", () => {
    expect(labelFor(session())).toBe("Child work");
  });

  it("appends the agent parenthetical when the title lacks it", () => {
    expect(labelFor(session({ title: "Fix the login bug", agent: "explore" }))).toBe(
      "Fix the login bug (explore)",
    );
  });

  it("does not duplicate an agent already tagged in the title", () => {
    expect(labelFor(session({ title: "Fix it (explore)", agent: "explore" }))).toBe(
      "Fix it (explore)",
    );
  });

  it("ignores the default 'code' agent", () => {
    expect(labelFor(session({ title: "Fix it", agent: "code" }))).toBe("Fix it");
  });

  it("falls back to the agent or a placeholder when there is no title", () => {
    expect(labelFor(session({ title: "", agent: "debug" }))).toBe("debug");
    expect(labelFor(session({ title: "", agent: "" }))).toBe("subagent");
  });
});

describe("elapsedFor", () => {
  it("counts from created to now while a session is running", () => {
    const sessionRow = session({ time: { created: 1_000, updated: 2_000 } });
    expect(elapsedFor(sessionRow, 62_000)).toBe("01:01");
  });

  it("prefers time.idle as the end of a finished run", () => {
    const sessionRow = session({
      outcome: "succeeded",
      time: { created: 1_000, updated: 1_010, idle: 62_000 },
    });
    expect(elapsedFor(sessionRow, 99_999)).toBe("01:01");
  });

  it("falls back to time.updated when time.idle is absent", () => {
    const sessionRow = session({
      outcome: "failed",
      time: { created: 1_000, updated: 45_000 },
    });
    expect(elapsedFor(sessionRow, 99_999)).toBe("00:44");
  });

  it("clamps clock skew to zero", () => {
    const sessionRow = session({ outcome: "succeeded", time: { created: 62_000, idle: 1_000 } });
    expect(elapsedFor(sessionRow, 99_999)).toBe("00:00");
  });
});

describe("metaFor", () => {
  it("composes the indented clock line with elapsed time", () => {
    const sessionRow = session({ time: { created: 1_000, updated: 2_000 } });
    expect(metaFor(sessionRow, 62_000)).toBe(
      `${LABEL_INDENT}↳ ${CLOCK_ICON} 01:01`,
    );
  });

  it("appends the token marker when tokens are available", () => {
    const sessionRow = session({
      outcome: "succeeded",
      time: { created: 1_000, updated: 1_010, idle: 62_000 },
      tokens: { input: 500, output: 500 },
    });
    expect(metaFor(sessionRow, 99_999)).toBe(
      `${LABEL_INDENT}↳ ${CLOCK_ICON} 01:01 ${TOKEN_ICON} 1,000 tok`,
    );
  });
});

describe("wrapLabel", () => {
  it("returns a single blank line for empty input", () => {
    expect(wrapLabel("", 20, 2)).toEqual([""]);
    expect(wrapLabel(undefined, 20, 2)).toEqual([""]);
  });

  it("keeps short labels on one line", () => {
    expect(wrapLabel("Short label", 20, 2)).toEqual(["Short label"]);
  });

  it("breaks long labels at word boundaries", () => {
    const lines = wrapLabel("one two three four five", 10, 2);
    expect(lines).toHaveLength(2);
    expect(lines[0]).toBe("one two");
    expect(lines[1]).toBe("three fou…");
  });

  it("hard-ellipsizes the final line", () => {
    const lines = wrapLabel("abcdefghijklmnopqrstuvwxyz", 10, 2);
    expect(lines[1]).toBe("klmnopqrs…");
  });
});