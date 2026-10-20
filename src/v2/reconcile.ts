/**
 * Status reconciliation for OpenCode V2 sessions.
 *
 * V2 session rows expose `time.{created,updated,idle}` as raw epoch millis
 * and an optional `outcome` (`succeeded | failed | interrupted`) recorded at
 * `time.idle`. This module derives the monitor status, the sort priority and
 * the candidate cap used by the `./tui` entrypoint, ported from the V1
 * reconcile/render behavior.
 *
 * `outcome` is not always present (legacy rows, killed runs, older hosts), so
 * the host's live status (`context.data.session.status`) decides whether an
 * outcome-less child is still running. Time-based inference is only a fallback
 * for hosts that do not expose it.
 */

export type V2Outcome = "succeeded" | "failed" | "interrupted";

/** Live run state reported by the host for a session. */
export type V2LiveStatus = "idle" | "running";

export interface V2SessionTime {
  created?: number;
  updated?: number;
  idle?: number;
}

export interface V2SessionTokens {
  input?: number;
  output?: number;
  total?: number;
}

/** Structural slice of `Session.Info` the monitor reads. */
export interface V2Session {
  id: string;
  parentID?: string;
  title?: string;
  agent?: string;
  outcome?: V2Outcome;
  /** Host live status; undefined when the host does not expose it. */
  live?: V2LiveStatus;
  tokens?: V2SessionTokens;
  time?: V2SessionTime;
}

export type SubagentStatus = "running" | "stale" | "done" | "error" | "unknown";

/**
 * Without a live status, an outcome-less child with no activity for this long
 * is considered stale.
 */
export const STALE_RUNNING_MS = 10 * 60_000;

/**
 * - a recorded outcome wins: `done` or `error`;
 * - live `running` is `running`, however long it has been quiet;
 * - live `idle` (or a recorded `time.idle`) without outcome is a finished run
 *   whose result is unknown: `unknown`, never `stale`;
 * - with no live status at all, fall back to activity-based inference.
 */
export function deriveStatus(
  session: V2Session | undefined,
  now = Date.now(),
): SubagentStatus {
  if (!session) return "unknown";
  if (session.outcome) {
    return session.outcome === "succeeded" ? "done" : "error";
  }
  if (session.live === "running") return "running";
  if (session.live === "idle" || session.time?.idle !== undefined) {
    return "unknown";
  }
  const updated = session.time?.updated ?? session.time?.created;
  if (updated !== undefined && now - updated > STALE_RUNNING_MS) return "stale";
  return "running";
}

/** Only confirmed or fresh running work is busy; `stale` is a guess. */
export function isBusy(session: V2Session, now = Date.now()): boolean {
  return deriveStatus(session, now) === "running";
}

/** Terminal rows share the done cap when completed history is hidden. */
function isTerminal(status: SubagentStatus): boolean {
  return status === "done" || status === "unknown";
}

const STATUS_PRIORITY: Record<SubagentStatus, number> = {
  running: 0,
  stale: 1,
  error: 2,
  done: 3,
  unknown: 3,
};

/**
 * Active work first (running > stale > error), terminal work last; among equal
 * priorities the most recently updated session wins.
 */
export function byPriority(
  a: V2Session,
  b: V2Session,
  now = Date.now(),
): number {
  const diff =
    STATUS_PRIORITY[deriveStatus(a, now)] -
    STATUS_PRIORITY[deriveStatus(b, now)];
  if (diff !== 0) return diff;
  return (b.time?.updated ?? 0) - (a.time?.updated ?? 0);
}

/**
 * When completed history is hidden, keep every active candidate and cap the
 * done rows at `maxDone` so the sidebar stays compact.
 */
export function maxCandidates(
  items: V2Session[],
  showCompleted: boolean,
  maxDone = 3,
): V2Session[] {
  if (showCompleted) return items;
  const active = items.filter((session) => !isTerminal(deriveStatus(session)));
  const completed = items.filter((session) =>
    isTerminal(deriveStatus(session)),
  );
  return [...active, ...completed.slice(0, maxDone)];
}