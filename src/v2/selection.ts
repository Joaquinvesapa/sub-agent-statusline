/**
 * Cursor selection for the V2 subagent list.
 *
 * Rows re-sort on every refresh (status, then most recent activity), so a bare
 * index drifts to another subagent. The selection is tracked by session ID and
 * the index is derived from the visible rows; the last index is only a
 * fallback for when the selected session leaves the list.
 */

export interface SelectableRow {
  id: string;
}

/** Index of the selected row in `rows`, or the clamped fallback; -1 if empty. */
export function selectionIndex(
  rows: readonly SelectableRow[],
  selectedID: string | undefined,
  lastIndex: number,
): number {
  if (rows.length === 0) return -1;
  if (selectedID !== undefined) {
    const index = rows.findIndex((row) => row.id === selectedID);
    if (index >= 0) return index;
  }
  return Math.max(0, Math.min(rows.length - 1, lastIndex));
}

/** Move the selection by `delta` rows from where it is now drawn. */
export function moveSelection(
  rows: readonly SelectableRow[],
  selectedID: string | undefined,
  lastIndex: number,
  delta: number,
): { id: string; index: number } | undefined {
  const current = selectionIndex(rows, selectedID, lastIndex);
  if (current < 0) return undefined;
  const index = Math.max(0, Math.min(rows.length - 1, current + delta));
  const row = rows[index];
  return row ? { id: row.id, index } : undefined;
}

/** The row the cursor marker is drawn on, i.e. the one Enter opens. */
export function selectionTarget<Row extends SelectableRow>(
  rows: readonly Row[],
  selectedID: string | undefined,
  lastIndex: number,
): Row | undefined {
  const index = selectionIndex(rows, selectedID, lastIndex);
  return index < 0 ? undefined : rows[index];
}
