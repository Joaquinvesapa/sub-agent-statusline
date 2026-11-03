import { describe, expect, it } from "vitest";
import { moveSelection, selectionIndex, selectionTarget } from "./selection.js";
import { groupSubagents, visibleSubagents, type V2Session } from "./reconcile.js";

const rows = (...ids: string[]) => ids.map((id) => ({ id }));

describe("selectionIndex", () => {
  it("follows the selected session when rows reorder", () => {
    expect(selectionIndex(rows("a", "b", "c"), "b", 1)).toBe(1);
    expect(selectionIndex(rows("b", "c", "a"), "b", 1)).toBe(0);
    expect(selectionIndex(rows("c", "a", "b"), "b", 1)).toBe(2);
  });

  it("falls back to the nearest index when the selected session disappears", () => {
    expect(selectionIndex(rows("a", "c"), "b", 1)).toBe(1);
    expect(selectionIndex(rows("a"), "b", 2)).toBe(0);
  });

  it("starts at the last index (top by default) with no selection", () => {
    expect(selectionIndex(rows("a", "b"), undefined, 0)).toBe(0);
  });

  it("returns -1 for an empty list", () => {
    expect(selectionIndex([], "a", 0)).toBe(-1);
  });
});

describe("moveSelection", () => {
  it("moves from the selected session's current position, not a stale index", () => {
    // "b" was at index 0 when selected; a refresh moved it to index 2.
    expect(moveSelection(rows("c", "a", "b"), "b", 0, -1)).toEqual({
      id: "a",
      index: 1,
    });
  });

  it("clamps at both ends", () => {
    expect(moveSelection(rows("a", "b"), "a", 0, -1)).toEqual({
      id: "a",
      index: 0,
    });
    expect(moveSelection(rows("a", "b"), "b", 1, 1)).toEqual({
      id: "b",
      index: 1,
    });
  });

  it("returns undefined for an empty list", () => {
    expect(moveSelection([], "a", 0, 1)).toBeUndefined();
  });
});

describe("selectionTarget", () => {
  it("opens the highlighted visible row by id", () => {
    expect(selectionTarget(rows("c", "a", "b"), "b", 0)?.id).toBe("b");
  });

  it("opens the fallback row the marker is drawn on when the selection is gone", () => {
    expect(selectionTarget(rows("a", "c"), "b", 1)?.id).toBe("c");
  });

  it("returns undefined for an empty list", () => {
    expect(selectionTarget([], "a", 0)).toBeUndefined();
  });
});

describe("selection across section changes", () => {
  const children: V2Session[] = [
    { id: "run", live: "running" },
    { id: "done", outcome: "succeeded" },
    { id: "error", outcome: "failed" },
  ];

  it("moves the cursor off a closed section and Enter opens only a visible row", () => {
    const groups = groupSubagents(children);
    const open = visibleSubagents(groups, { expanded: true, showCompleted: true, showErrors: true });
    expect(selectionTarget(open, "done", 1)?.id).toBe("done");
    const closed = visibleSubagents(groups, { expanded: true, showCompleted: false, showErrors: true });
    expect(selectionTarget(closed, "done", 1)?.id).toBe("error");
    expect(moveSelection(closed, "done", 1, -1)?.id).toBe("run");
  });

  it("cannot open a just-finished run when its destination section is closed", () => {
    const finished = [{ id: "run", outcome: "succeeded" as const }];
    const visible = visibleSubagents(groupSubagents(finished), { expanded: true, showCompleted: false });
    expect(selectionTarget(visible, "run", 0)).toBeUndefined();
    expect(moveSelection(visible, "run", 0, 1)).toBeUndefined();
  });
});
