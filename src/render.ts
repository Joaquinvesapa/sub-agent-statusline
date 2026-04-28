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

export function renderStatusLine(state: StatuslineState): string {
  const allChildren = Object.values(state.children);
  const hasMatchingSubtask = (child: ChildSessionState): boolean =>
    child.source === "tool" &&
    allChildren.some(
      (candidate) =>
        candidate.source === "subtask" &&
        candidate.parentID === child.parentID &&
        candidate.messageID === child.messageID,
    );

  const children = allChildren.filter((child) => !hasMatchingSubtask(child)).sort(byPriority);
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
