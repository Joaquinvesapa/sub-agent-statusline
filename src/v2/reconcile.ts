/**
 * Status reconciliation for OpenCode V2 sessions.
 *
 * V2 session rows expose `time.{created,updated,idle}` as raw epoch millis
 * and an optional `outcome` (`succeeded | failed | interrupted`) recorded at
 * `time.idle`. This module derives the monitor status, the sort priority and
 * the candidate cap used by the `./tui-v2` entrypoint, ported from the V1
 * reconcile/render behavior.
 */

export type V2Outcome = "succeeded" | "failed" | "interrupted";

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
  tokens?: V2SessionTokens;
  time?: V2SessionTime;
}

export type SubagentStatus = "running" | "stale" | "done" | "error" | "unknown";

/** A running child with no activity for this long is considered stale. */
export const STALE_RUNNING_MS = 10 * 60_000;

export function deriveStatus(
  session: V2Session | undefined,
  now = Date.now(),
): SubagentStatus {
  if (!session) return "unknown";
  if (session.outcome) {
    return session.outcome === "succeeded" ? "done" : "error";
  }
  const updated = session.time?.updated ?? session.time?.created;
  if (updated !== undefined && now - updated > STALE_RUNNING_MS) return "stale";
  return "running";
}

export function isBusy(session: V2Session, now = Date.now()): boolean {
  const status = deriveStatus(session, now);
  return status === "running" || status === "stale";
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
  const active = items.filter((session) => deriveStatus(session) !== "done");
  const completed = items.filter((session) => deriveStatus(session) === "done");
  return [...active, ...completed.slice(0, maxDone)];
}