import { describe, expect, it } from "vitest";
import {
  STALE_RUNNING_MS,
  byPriority,
  deriveStatus,
  isBusy,
  maxCandidates,
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
});

describe("isBusy", () => {
  it("considers running and stale sessions busy", () => {
    expect(isBusy(session(), NOW)).toBe(true);
    expect(
      isBusy(
        session({
          time: { created: 0, updated: NOW - STALE_RUNNING_MS - 1 },
        }),
        NOW,
      ),
    ).toBe(true);
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

describe("maxCandidates", () => {
  it("keeps every active candidate and caps done rows at three", () => {
    const active = [
      session({ id: "run1" }),
      session({ id: "stale1", time: { created: 0, updated: 1 } }),
    ];
    const done = Array.from({ length: 5 }, (_, index) =>
      session({ id: `done${index}`, outcome: "succeeded" }),
    );

    const capped = maxCandidates([...active, ...done], false);
    expect(capped).toHaveLength(active.length + 3);
    expect(capped.slice(0, active.length).map((item) => item.id)).toEqual(
      active.map((item) => item.id),
    );
    expect(capped.slice(-3).map((item) => item.id)).toEqual([
      "done0",
      "done1",
      "done2",
    ]);
  });

  it("returns every candidate when completed history is shown", () => {
    const items = [
      session({ id: "run1" }),
      session({ id: "done1", outcome: "succeeded" }),
      session({ id: "done2", outcome: "succeeded" }),
    ];
    expect(maxCandidates(items, true)).toEqual(items);
  });

  it("treats errors as active (never capped)", () => {
    const errors = [
      session({ id: "err1", outcome: "failed" }),
      session({ id: "err2", outcome: "interrupted" }),
    ];
    const capped = maxCandidates(errors, false);
    expect(capped.map((item) => item.id)).toEqual(["err1", "err2"]);
  });
});