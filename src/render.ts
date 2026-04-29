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
    return `${(value / 1_000_000).toFixed(1)}M tok`;
  }
  if (value >= 1_000) {
    return `${(value / 1_000).toFixed(1)}k tok`;
  }
  return `${Math.round(value)} tok`;
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
  const syntheticChildren = children.filter(
    (child) => child.source === "tool" || child.source === "subtask",
  );
  const sessionBySyntheticID = new Map<string, ChildSessionState>();

  for (const synthetic of syntheticChildren) {
    const matchingSessions = children.filter((candidate) =>
      sessionMatchesSynthetic(candidate, synthetic),
    );
    if (matchingSessions.length > 0) {
      sessionBySyntheticID.set(synthetic.id, matchingSessions.sort(byPriority)[0]);
    }
  }

  return children
    .filter((child) => {
      if (child.source === "session") {
        return !syntheticChildren.some(
          (synthetic) =>
            synthetic.targetSessionID === child.id ||
            (synthetic.parentID === child.parentID &&
              synthetic.messageID &&
              synthetic.messageID === child.messageID) ||
            sessionMatchesSynthetic(child, synthetic),
        );
      }

      if (child.source !== "tool") return true;
      if (isGenericToolWrapper(child)) {
        return !syntheticChildren.some(
          (synthetic) =>
            synthetic.id !== child.id && synthetic.parentID === child.parentID,
        );
      }
      return !syntheticChildren.some(
        (real) =>
          real.id !== child.id &&
          real.parentID === child.parentID &&
          relatedWorkItemTitles(real.title, child.title),
      );
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
  return collapseSubagentWorkItems(children).filter((child) =>
    isVisibleWorkItem(child, nowMs),
  );
}

export function renderStatusLine(state: StatuslineState): string {
  const children = visibleSubagentWorkItems(Object.values(state.children)).sort(byPriority);
  const running = children.filter((c) => c.status === "running").length;
  const done = children.filter((c) => c.status === "done").length;
  const error = children.filter((c) => c.status === "error").length;
  const colorOn = colorsEnabled();

  const aggregate = `↳ ${running} running · ${done} done · ${error} error`;
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
