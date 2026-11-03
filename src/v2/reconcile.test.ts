import { describe, expect, it } from "vitest";
import {
  STALE_RUNNING_MS,
  byPriority,
  deriveStatus,
  isBusy,
  groupSubagents,
  visibleSubagents,
  type V2Session,
} from "./reconcile.js";

function session(overrides: Partial<V2Session> = {}): V2Session {
  return {
    id: "ses_child",
    parentID: "ses_parent",
    title: "Child work",
    time: { created: Date.now() - 60_000, updated: Date.now() - 59_000 },
    ...overrides,
  };
}

const NOW = 2_000_000;

describe("deriveStatus", () => {
  it("derives 'done' from a succeeded outcome", () => {
    expect(
      deriveStatus(session({ outcome: "succeeded" }), NOW),
    ).toBe("done");
  });

  it("derives 'error' from failed and interrupted outcomes", () => {
    expect(deriveStatus(session({ outcome: "failed" }), NOW)).toBe("error");
    expect(deriveStatus(session({ outcome: "interrupted" }), NOW)).toBe(
      "error",
    );
  });

  it("derives 'running' when there is no outcome and the session is fresh", () => {
    expect(deriveStatus(session(), NOW)).toBe("running");
  });

  it("keeps a running session 'running' exactly at the stale boundary", () => {
    const updated = NOW - STALE_RUNNING_MS;
    expect(deriveStatus(session({ time: { created: 0, updated } }), NOW)).toBe(
      "running",
    );
  });

  it("derives 'stale' past the stale boundary", () => {
    const updated = NOW - STALE_RUNNING_MS - 1;
    expect(deriveStatus(session({ time: { created: 0, updated } }), NOW)).toBe(
      "stale",
    );
  });

  it("falls back to time.created when time.updated is absent", () => {
    const created = NOW - STALE_RUNNING_MS - 60_000;
    expect(deriveStatus(session({ time: { created } }), NOW)).toBe("stale");
  });

  it("returns 'unknown' for an undefined session", () => {
    expect(deriveStatus(undefined, NOW)).toBe("unknown");
  });

  // #109: reopening an old session must not invent stale/running children.
  describe("with the host live status", () => {
    const old = { created: 0, updated: NOW - STALE_RUNNING_MS - 60_000 };

    it("trusts a running live status even after a long quiet period", () => {
      expect(deriveStatus(session({ live: "running", time: old }), NOW)).toBe(
        "running",
      );
    });

    it("treats an idle child without outcome as terminal 'unknown', not stale", () => {
      expect(deriveStatus(session({ live: "idle", time: old }), NOW)).toBe(
        "unknown",
      );
    });

    it("treats a fresh idle child without outcome as 'unknown', not running", () => {
      expect(deriveStatus(session({ live: "idle" }), NOW)).toBe("unknown");
    });

    it("keeps a recorded outcome over the live status", () => {
      expect(
        deriveStatus(session({ live: "idle", outcome: "succeeded" }), NOW),
      ).toBe("done");
    });
  });

  it("treats a child with time.idle but no outcome as 'unknown' when live status is unavailable", () => {
    expect(
      deriveStatus(
        session({ time: { created: 0, updated: NOW - 1_000, idle: NOW - 1_000 } }),
        NOW,
      ),
    ).toBe("unknown");
  });
});

describe("isBusy", () => {
  it("considers running sessions busy", () => {
    expect(isBusy(session(), NOW)).toBe(true);
    expect(isBusy(session({ live: "running" }), NOW)).toBe(true);
  });

  // #109: stale is a guess, it must not inflate the footer running count.
  it("does not count stale or unknown sessions as busy", () => {
    expect(
      isBusy(
        session({
          time: { created: 0, updated: NOW - STALE_RUNNING_MS - 1 },
        }),
        NOW,
      ),
    ).toBe(false);
    expect(isBusy(session({ live: "idle" }), NOW)).toBe(false);
  });

  it("considers terminal sessions not busy", () => {
    expect(isBusy(session({ outcome: "succeeded" }), NOW)).toBe(false);
    expect(isBusy(session({ outcome: "failed" }), NOW)).toBe(false);
  });
});

describe("byPriority", () => {
  it("orders running work before stale work before errors before done", () => {
    const running = session({ id: "a", time: { updated: 100 } });
    const stale = session({
      id: "b",
      time: { created: 0, updated: 50 },
    });
    const error = session({ id: "c", outcome: "failed", time: { updated: 90 } });
    const done = session({ id: "d", outcome: "succeeded", time: { updated: 80 } });

    const sorted = [done, error, stale, running].sort((a, b) =>
      byPriority(a, b),
    );
    expect(sorted.map((item) => item.id)).toEqual(["a", "b", "c", "d"]);
  });

  it("breaks priority ties by most recently updated first", () => {
    const newer = session({ id: "newer", outcome: "succeeded", time: { updated: 200 } });
    const older = session({ id: "older", outcome: "succeeded", time: { updated: 100 } });
    expect(byPriority(newer, older)).toBeLessThan(0);
  });
});

describe("grouped sidebar", () => {
  const items = () => [
    session({ id: "run", live: "running" }),
    session({ id: "stale", time: { updated: 0 } }),
    session({ id: "done", outcome: "succeeded" }),
    session({ id: "unknown", live: "idle" }),
    session({ id: "failed", outcome: "failed" }),
    session({ id: "interrupted", outcome: "interrupted" }),
  ];
  const ids = (rows: V2Session[]) => rows.map((row) => row.id);

  it("places every state in exactly one group, without treating unknown as success", () => {
    const groups = groupSubagents(items(), NOW);
    expect(ids(groups.running)).toEqual(["run"]);
    expect(ids(groups.stale)).toEqual(["stale"]);
    expect(ids(groups.history)).toEqual(["done", "unknown"]);
    expect(ids(groups.errors)).toEqual(["failed", "interrupted"]);
    expect(Object.values(groups).flat()).toHaveLength(items().length);
  });

  it("handles an empty family", () => {
    expect(groupSubagents([], NOW)).toEqual({ running: [], stale: [], history: [], errors: [] });
  });

  it.each([
    [false, false, ["run", "stale"]],
    [true, false, ["run", "stale", "done", "unknown"]],
    [false, true, ["run", "stale", "failed", "interrupted"]],
    [true, true, ["run", "stale", "done", "unknown", "failed", "interrupted"]],
  ])("independently expands history=%s and errors=%s", (showCompleted, showErrors, expected) => {
    const groups = groupSubagents(items(), NOW);
    expect(ids(visibleSubagents(groups, { expanded: true, showCompleted, showErrors }))).toEqual(expected);
    expect(groups.history).toHaveLength(2);
    expect(groups.errors).toHaveLength(2);
  });

  it("preserves old history preferences and defaults missing error preference to hidden", () => {
    const groups = groupSubagents(items(), NOW);
    expect(ids(visibleSubagents(groups, { expanded: true, showCompleted: true })))
      .toEqual(["run", "stale", "done", "unknown"]);
  });

  it("exposes no keyboard targets when the entire monitor is collapsed", () => {
    expect(visibleSubagents(groupSubagents(items(), NOW), {
      expanded: false, showCompleted: true, showErrors: true,
    })).toEqual([]);
  });

  it.each(["succeeded", "failed", "interrupted"] as const)("moves a finished run to its %s group", (outcome) => {
    const child = session({ live: "running" });
    expect(groupSubagents([child], NOW).running).toHaveLength(1);
    const groups = groupSubagents([{ ...child, live: "idle", outcome }], NOW);
    expect(groups.running).toEqual([]);
    expect(outcome === "succeeded" ? groups.history : groups.errors).toHaveLength(1);
    expect(visibleSubagents(groups, { expanded: true, showCompleted: false })).toEqual([]);
  });

  it("does not cap history when explicitly opened", () => {
    const children = Array.from({ length: 8 }, (_, i) => session({ id: `done${i}`, outcome: "succeeded" }));
    expect(visibleSubagents(groupSubagents(children, NOW), {
      expanded: true, showCompleted: true,
    })).toHaveLength(8);
  });
});
