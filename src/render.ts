import type { ChildSessionState, StatuslineState } from "./state.js";

const ansi = {
  reset: "\u001B[0m",
  gray: "\u001B[90m",
  green: "\u001B[32m",
  yellow: "\u001B[33m",
  red: "\u001B[31m",
};

function colorsEnabled(): boolean {
  if (process.env.NO_COLOR) return false;
  const fromEnv = process.env.OPENCODE_SUBAGENT_STATUSLINE_COLOR;
  if (fromEnv === "0") return false;
  return true;
}

function paint(text: string, color: string, enabled: boolean): string {
  if (!enabled) return text;
  return `${color}${text}${ansi.reset}`;
}

export function formatDuration(elapsedMs: number | undefined): string {
  const totalSeconds = Math.max(0, Math.floor((elapsedMs ?? 0) / 1000));
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;

  if (hours > 0) {
    return `${String(hours).padStart(2, "0")}:${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}`;
  }

  return `${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}`;
}

function formatNumber(value: number): string {
  return Math.max(0, Math.round(value)).toLocaleString("en-US");
}

function resolveTokenTotal(child: ChildSessionState): number | undefined {
  const total = child.tokens?.total;
  if (typeof total === "number" && Number.isFinite(total)) {
    return total;
  }

  const inTokens = child.tokens?.input;
  const outTokens = child.tokens?.output;
  if (typeof inTokens === "number" || typeof outTokens === "number") {
    return (inTokens ?? 0) + (outTokens ?? 0);
  }

  return undefined;
}

function formatPercentUsed(percent: number): string {
  const rounded = Math.round(percent * 10) / 10;
  if (Math.abs(rounded - Math.round(rounded)) < 0.05) {
    return `${Math.round(rounded)}% used`;
  }
  return `${rounded.toFixed(1)}% used`;
}

function formatTokenCount(total: number): string {
  const label = total === 1 ? "token" : "tokens";
  return `${formatNumber(total)} ${label}`;
}

function formatCompactTokenCount(total: number): string {
  const value = Math.max(0, total);
  if (value >= 1_000_000) {
    return `${(value / 1_000_000).toFixed(1)}M ctx`;
  }
  if (value >= 1_000) {
    return `${(value / 1_000).toFixed(1)}k ctx`;
  }
  return `${Math.round(value)} ctx`;
}

function formatCompactPercentUsed(percent: number): string {
  const rounded = Math.round(percent);
  return `${Math.max(0, rounded)}%`;
}

export function formatContextDetails(child: ChildSessionState): string | undefined {
  const total = resolveTokenTotal(child);
  const percent = child.tokens?.contextPercent;

  const hasPercent = typeof percent === "number" && Number.isFinite(percent);
  const hasTotal = typeof total === "number" && Number.isFinite(total);

  if (hasTotal && hasPercent) {
    return `${formatTokenCount(total)} · ${formatPercentUsed(percent)}`;
  }

  if (hasTotal) {
    return formatTokenCount(total);
  }

  if (hasPercent) {
    return formatPercentUsed(percent);
  }

  return undefined;
}

export function formatContext(child: ChildSessionState): string {
  const details = formatContextDetails(child);
  if (!details) return "";
  return `ctx ${details}`;
}

export function formatContextCompact(child: ChildSessionState): string {
  const total = resolveTokenTotal(child);
  const percent = child.tokens?.contextPercent;

  const hasPercent = typeof percent === "number" && Number.isFinite(percent);
  const hasTotal = typeof total === "number" && Number.isFinite(total);

  if (hasTotal && hasPercent) {
    return `${formatCompactTokenCount(total)} ${formatCompactPercentUsed(percent)}`;
  }

  if (hasTotal) {
    return formatCompactTokenCount(total);
  }

  if (hasPercent) {
    return formatCompactPercentUsed(percent);
  }

  return "";
}

function childColor(child: ChildSessionState): string {
  if (child.color === "green") return ansi.green;
  if (child.color === "red") return ansi.red;
  return ansi.yellow;
}

export function byPriority(a: ChildSessionState, b: ChildSessionState): number {
  const startedDiff = b.startedAt.localeCompare(a.startedAt);
  if (startedDiff !== 0) return startedDiff;

  // Keep execution-order ties stable across running async status/token updates.
  return a.id.localeCompare(b.id);
}

const RECENT_DONE_VISIBLE_MS = 10 * 60 * 1000;

function normalizeWorkItemTitle(value: string): string {
  return value
    .toLowerCase()
    .replace(/\s*\([^)]*\)\s*/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function relatedWorkItemTitles(a: string, b: string): boolean {
  const left = normalizeWorkItemTitle(a);
  const right = normalizeWorkItemTitle(b);
  if (!left || !right) return false;
  return left.includes(right) || right.includes(left);
}

function sameAgentName(a: string | undefined, b: string | undefined): boolean {
  if (!a || !b) return true;
  return normalizeWorkItemTitle(a) === normalizeWorkItemTitle(b);
}

function isGenericToolWrapper(child: ChildSessionState): boolean {
  if (child.source !== "tool") return false;
  const title = normalizeWorkItemTitle(child.title);
  return title === "delegate" || title === "task";
}

function sessionMatchesSynthetic(
  session: ChildSessionState,
  synthetic: ChildSessionState,
): boolean {
  if (session.source !== "session" && !session.id.startsWith("ses_")) return false;
  if (session.parentID !== synthetic.parentID) return false;
  if (synthetic.targetSessionID === session.id) return true;
  if (session.targetSessionID === synthetic.id) return true;
  if (
    synthetic.messageID &&
    session.messageID &&
    synthetic.messageID === session.messageID
  ) {
    return true;
  }
  return (
    sameAgentName(session.agentName, synthetic.agentName) &&
    relatedWorkItemTitles(session.title, synthetic.title)
  );
}

function messageKey(parentID: string, messageID: string): string {
  return `${parentID}\0${messageID}`;
}

function betterPriority(
  current: ChildSessionState | undefined,
  candidate: ChildSessionState,
): ChildSessionState {
  if (!current) return candidate;
  return byPriority(candidate, current) < 0 ? candidate : current;
}

function mergeSyntheticWithSession(
  synthetic: ChildSessionState,
  session: ChildSessionState | undefined,
): ChildSessionState {
  if (!session) return synthetic;
  return {
    ...synthetic,
    status: session.status,
    color: session.color,
    startedAt: session.startedAt ?? synthetic.startedAt,
    updatedAt: session.updatedAt ?? synthetic.updatedAt,
    endedAt: session.endedAt ?? synthetic.endedAt,
    elapsedMs: session.elapsedMs ?? synthetic.elapsedMs,
    tokens: session.tokens ?? synthetic.tokens,
    targetSessionID: session.id,
    agentName: synthetic.agentName ?? session.agentName,
  };
}

export function collapseSubagentWorkItems(
  children: ChildSessionState[],
): ChildSessionState[] {
  const syntheticChildren: ChildSessionState[] = [];
  const syntheticByParentID = new Map<string, ChildSessionState[]>();
  const sessionCandidatesByParentID = new Map<string, ChildSessionState[]>();
  const hiddenTargetSessionIDs = new Set<string>();
  const hiddenMessageKeys = new Set<string>();

  for (const child of children) {
    const isSynthetic = child.source === "tool" || child.source === "subtask";
    if (isSynthetic) {
      syntheticChildren.push(child);
      const siblings = syntheticByParentID.get(child.parentID);
      if (siblings) {
        siblings.push(child);
      } else {
        syntheticByParentID.set(child.parentID, [child]);
      }

      if (child.targetSessionID) {
        hiddenTargetSessionIDs.add(child.targetSessionID);
      }
      if (child.messageID) {
        hiddenMessageKeys.add(messageKey(child.parentID, child.messageID));
      }
    }

    if (child.source === "session" || child.id.startsWith("ses_")) {
      const candidates = sessionCandidatesByParentID.get(child.parentID);
      if (candidates) {
        candidates.push(child);
      } else {
        sessionCandidatesByParentID.set(child.parentID, [child]);
      }
    }
  }

  const sessionBySyntheticID = new Map<string, ChildSessionState>();
  const hiddenMatchedSessionIDs = new Set<string>();
  const hiddenSyntheticToolIDs = new Set<string>();

  for (const synthetic of syntheticChildren) {
    let bestSession: ChildSessionState | undefined;
    for (const candidate of sessionCandidatesByParentID.get(synthetic.parentID) ?? []) {
      if (!sessionMatchesSynthetic(candidate, synthetic)) continue;
      bestSession = betterPriority(bestSession, candidate);
      if (candidate.source === "session") {
        hiddenMatchedSessionIDs.add(candidate.id);
      }
    }
    if (bestSession) {
      sessionBySyntheticID.set(synthetic.id, bestSession);
    }
  }

  for (const siblings of syntheticByParentID.values()) {
    for (const child of siblings) {
      if (child.source !== "tool") continue;
      if (isGenericToolWrapper(child)) {
        if (siblings.length > 1) hiddenSyntheticToolIDs.add(child.id);
        continue;
      }

      for (const sibling of siblings) {
        if (sibling.id === child.id) continue;
        if (relatedWorkItemTitles(sibling.title, child.title)) {
          hiddenSyntheticToolIDs.add(child.id);
          break;
        }
      }
    }
  }

  return children
    .filter((child) => {
      if (child.source === "session") {
        return !(
          hiddenTargetSessionIDs.has(child.id) ||
          (child.messageID &&
            hiddenMessageKeys.has(messageKey(child.parentID, child.messageID))) ||
          hiddenMatchedSessionIDs.has(child.id)
        );
      }

      if (child.source !== "tool") return true;
      return !hiddenSyntheticToolIDs.has(child.id);
    })
    .map((child) => mergeSyntheticWithSession(child, sessionBySyntheticID.get(child.id)));
}

export function isVisibleWorkItem(
  child: ChildSessionState,
  nowMs = Date.now(),
): boolean {
  if (child.status !== "done") return true;
  const endedMs = Date.parse(child.endedAt ?? child.updatedAt);
  if (Number.isNaN(endedMs)) return false;
  return nowMs - endedMs <= RECENT_DONE_VISIBLE_MS;
}

export function visibleSubagentWorkItems(
  children: ChildSessionState[],
  nowMs = Date.now(),
): ChildSessionState[] {
  const visible = collapseSubagentWorkItems(children).filter((child) =>
    isVisibleWorkItem(child, nowMs),
  );
  const hasRunning = visible.some((child) => child.status === "running");
  const activeMessageIDs = new Set(
    visible
      .filter((child) => child.status === "running" && child.messageID)
      .map((child) => child.messageID as string),
  );

  if (!hasRunning) return visible;

  return visible.filter((child) => {
    if (child.status === "running" || child.status === "error") return true;
    if (!child.messageID) return false;
    return activeMessageIDs.has(child.messageID);
  });
}

export function renderStatusLine(state: StatuslineState): string {
  const children = visibleSubagentWorkItems(Object.values(state.children)).sort(byPriority);
  const running = children.filter((c) => c.status === "running").length;
  const done = children.filter((c) => c.status === "done").length;
  const error = children.filter((c) => c.status === "error").length;
  const totalExecuted = formatNumber(state.totalExecuted ?? 0);
  const colorOn = colorsEnabled();

  const aggregate = `↳ ${running} running · ${done} done · ${error} error · Σ ${totalExecuted} total`;
  if (children.length === 0) return aggregate;

  const details = children
    .map((child) => {
      const context = formatContext(child);
      const label = [child.title, formatDuration(child.elapsedMs), context]
        .filter((part) => part.length > 0)
        .join(" ");
      return paint(label, childColor(child), colorOn);
    })
    .join(paint(" · ", ansi.gray, colorOn));

  return `${aggregate} · ${details}`;
}
