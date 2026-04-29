import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import os from "node:os";

export type ChildStatus = "running" | "done" | "error";

export interface ChildTokenState {
  input?: number;
  output?: number;
  total?: number;
  contextPercent?: number;
}

export interface ChildSessionState {
  id: string;
  title: string;
  summary?: string;
  agentName?: string;
  parentID: string;
  messageID?: string;
  source?: "session" | "subtask" | "tool";
  targetSessionID?: string;
  status: ChildStatus;
  color: "yellow" | "green" | "red";
  startedAt: string;
  updatedAt: string;
  endedAt?: string;
  elapsedMs?: number;
  tokens?: ChildTokenState;
}

export interface StatuslineState {
  children: Record<string, ChildSessionState>;
  countedChildIDs: Record<string, true>;
  totalExecuted: number;
  updatedAt: string;
}

export interface StatusCounts {
  running: number;
  done: number;
  error: number;
}

const TERMINAL_CHILD_TTL_MS = 60 * 60 * 1000;
const MAX_TERMINAL_CHILDREN = 500;

function statusColor(status: ChildStatus): ChildSessionState["color"] {
  if (status === "done") return "green";
  if (status === "error") return "red";
  return "yellow";
}

function safeTimestamp(input: unknown, fallback: string): string {
  if (typeof input !== "string") return fallback;
  return Number.isNaN(Date.parse(input)) ? fallback : input;
}

function toFiniteNumber(value: unknown): number | undefined {
  if (typeof value === "number" && Number.isFinite(value)) {
    return value;
  }
  if (typeof value === "string" && value.trim().length > 0) {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : undefined;
  }
  return undefined;
}

function toNonNegativeInteger(value: unknown): number | undefined {
  const parsed = toFiniteNumber(value);
  if (parsed === undefined) return undefined;
  return Math.max(0, Math.floor(parsed));
}

function sanitizeCountedChildIDs(input: unknown): Record<string, true> {
  if (!input || typeof input !== "object") return {};

  const counted: Record<string, true> = {};
  for (const [id, value] of Object.entries(input)) {
    if (!id) continue;
    if (value === true) {
      counted[id] = true;
    }
  }
  return counted;
}

function normalizeExecutionCounters(state: StatuslineState): void {
  state.countedChildIDs = sanitizeCountedChildIDs(state.countedChildIDs);
  const countedTotal = Object.keys(state.countedChildIDs).length;
  state.totalExecuted = Math.max(
    toNonNegativeInteger(state.totalExecuted) ?? 0,
    countedTotal,
  );
}

function isTechnicalDelegationTitle(value: string | undefined): boolean {
  if (!value) return false;
  return /^delegation:\s+/i.test(value.trim());
}

function isCountableWorkItem(child: Pick<ChildSessionState, "id" | "title"> &
  Partial<Pick<ChildSessionState, "source">>): boolean {
  if (child.source === "tool" || child.source === "subtask") return true;
  if (child.source === "session" || child.id.startsWith("ses_")) {
    return !isTechnicalDelegationTitle(child.title);
  }
  return true;
}

function countChildExecution(state: StatuslineState, child: Pick<ChildSessionState, "id" | "title"> &
  Partial<Pick<ChildSessionState, "source">>): boolean {
  if (!isCountableWorkItem(child)) return false;
  normalizeExecutionCounters(state);
  if (state.countedChildIDs[child.id]) return false;

  const previousTotal = Math.max(
    toNonNegativeInteger(state.totalExecuted) ?? 0,
    Object.keys(state.countedChildIDs).length,
  );
  state.countedChildIDs[child.id] = true;
  state.totalExecuted = previousTotal + 1;
  return true;
}

function sanitizeTokens(input: unknown): ChildTokenState | undefined {
  if (!input || typeof input !== "object") return undefined;
  const raw = input as Record<string, unknown>;
  const tokens: ChildTokenState = {
    input: toFiniteNumber(raw.input),
    output: toFiniteNumber(raw.output),
    total: toFiniteNumber(raw.total),
    contextPercent: toFiniteNumber(raw.contextPercent),
  };

  if (
    tokens.input === undefined &&
    tokens.output === undefined &&
    tokens.total === undefined &&
    tokens.contextPercent === undefined
  ) {
    return undefined;
  }

  return tokens;
}

function sanitizeTargetSessionID(
  value: unknown,
  fallback?: string,
): string | undefined {
  if (typeof value === "string" && value.startsWith("ses_")) {
    return value;
  }
  if (typeof fallback === "string" && fallback.startsWith("ses_")) {
    return fallback;
  }
  return undefined;
}

function mergeTokens(
  existing: ChildTokenState | undefined,
  incoming: ChildTokenState | undefined,
): ChildTokenState | undefined {
  if (!existing && !incoming) return undefined;
  return {
    input: incoming?.input ?? existing?.input,
    output: incoming?.output ?? existing?.output,
    total: incoming?.total ?? existing?.total,
    contextPercent: incoming?.contextPercent ?? existing?.contextPercent,
  };
}

function sameTokens(
  left: ChildTokenState | undefined,
  right: ChildTokenState | undefined,
): boolean {
  return JSON.stringify(left) === JSON.stringify(right);
}

function normalizeComparableText(value: string): string {
  return value.replace(/\s+/g, " ").trim().toLowerCase();
}

function sanitizeSummary(value: unknown, title: string): string | undefined {
  if (typeof value !== "string") return undefined;
  const summary = value.replace(/\s+/g, " ").trim();
  if (!summary) return undefined;
  if (normalizeComparableText(summary) === normalizeComparableText(title)) {
    return undefined;
  }
  return summary;
}

function sanitizeAgentName(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;
  const agentName = value.replace(/^\((.*)\)$/, "$1").replace(/\s+/g, " ").trim();
  return agentName || undefined;
}

function resolveElapsedMs(child: ChildSessionState, nowMs: number): number {
  const startedMs = Date.parse(child.startedAt);
  if (Number.isNaN(startedMs)) return 0;

  const endSource = child.endedAt ?? child.updatedAt;
  const endMs = child.endedAt ? Date.parse(endSource) : nowMs;
  if (Number.isNaN(endMs)) return 0;
  return Math.max(0, endMs - startedMs);
}

function terminalReferenceMs(child: ChildSessionState): number {
  const parsed = Date.parse(child.endedAt ?? child.updatedAt ?? child.startedAt);
  return Number.isNaN(parsed) ? 0 : parsed;
}

export function pruneTerminalChildren(
  state: StatuslineState,
  now = new Date(),
): number {
  const nowMs = now.getTime();
  const terminalChildren: Array<{ id: string; referenceMs: number }> = [];
  let pruned = 0;

  for (const child of Object.values(state.children)) {
    if (child.status === "running") continue;

    const referenceMs = terminalReferenceMs(child);
    if (nowMs - referenceMs > TERMINAL_CHILD_TTL_MS) {
      delete state.children[child.id];
      pruned += 1;
      continue;
    }

    terminalChildren.push({ id: child.id, referenceMs });
  }

  if (terminalChildren.length <= MAX_TERMINAL_CHILDREN) {
    return pruned;
  }

  terminalChildren.sort((a, b) => b.referenceMs - a.referenceMs || a.id.localeCompare(b.id));
  for (const child of terminalChildren.slice(MAX_TERMINAL_CHILDREN)) {
    delete state.children[child.id];
    pruned += 1;
  }

  return pruned;
}

export function refreshDerivedFields(
  state: StatuslineState,
  now = new Date(),
): void {
  const nowISO = now.toISOString();
  const nowMs = now.getTime();

  normalizeExecutionCounters(state);

  for (const [id, child] of Object.entries(state.children)) {
    const startedAt = safeTimestamp(child.startedAt, nowISO);
    const updatedAt = safeTimestamp(child.updatedAt, nowISO);
    const endedAt = child.endedAt ? safeTimestamp(child.endedAt, updatedAt) : undefined;
    const status =
      child.status === "done" || child.status === "error" || child.status === "running"
        ? child.status
        : "running";

    const targetSessionID = sanitizeTargetSessionID(
      child.targetSessionID,
      id.startsWith("ses_") ? id : undefined,
    );

    state.children[id] = {
      ...child,
      startedAt,
      updatedAt,
      endedAt,
      status,
      targetSessionID,
      color: statusColor(status),
      tokens: sanitizeTokens(child.tokens),
      elapsedMs: resolveElapsedMs(
        {
          ...child,
          startedAt,
          updatedAt,
          endedAt,
          status,
          color: statusColor(status),
        },
        nowMs,
      ),
    };
  }

  state.updatedAt = safeTimestamp(state.updatedAt, nowISO);
  if (pruneTerminalChildren(state, now) > 0) {
    state.updatedAt = nowISO;
  }
}

const STATUS_DIRNAME = "opencode-subagent-statusline";
const STATUS_FILENAME = "state.json";

function sanitizeInstanceName(input: string): string {
  return input.replace(/[^A-Za-z0-9._-]/g, "_");
}

function resolveDefaultInstanceName(): string {
  const fromEnv = process.env.OPENCODE_SUBAGENT_STATUSLINE_INSTANCE;
  if (typeof fromEnv === "string" && fromEnv.trim().length > 0) {
    const safe = sanitizeInstanceName(fromEnv);
    if (safe.length > 0) {
      return safe;
    }
  }

  return `pid-${process.pid}`;
}

export function shouldPreserveStateOnStartup(): boolean {
  return process.env.OPENCODE_SUBAGENT_STATUSLINE_PRESERVE_STATE === "1";
}

export function createEmptyState(): StatuslineState {
  return {
    children: {},
    countedChildIDs: {},
    totalExecuted: 0,
    updatedAt: new Date().toISOString(),
  };
}

export function resolveStatePath(): string {
  const fromEnv = process.env.OPENCODE_SUBAGENT_STATUSLINE_STATE;
  if (typeof fromEnv === "string" && fromEnv.trim().length > 0) {
    return fromEnv;
  }

  const runtimeDir = process.env.XDG_RUNTIME_DIR ?? os.tmpdir();
  const instance = resolveDefaultInstanceName();
  return join(runtimeDir, STATUS_DIRNAME, instance, STATUS_FILENAME);
}

export function resolveTextPath(statePath: string): string {
  return join(dirname(statePath), "status.txt");
}

export async function loadState(statePath: string): Promise<StatuslineState> {
  try {
    const raw = await readFile(statePath, "utf8");
    const parsed = JSON.parse(raw) as Partial<StatuslineState>;
    if (!parsed || typeof parsed !== "object") {
      return createEmptyState();
    }

    const children =
      parsed.children && typeof parsed.children === "object" ? parsed.children : {};

    const countedChildIDs = sanitizeCountedChildIDs(parsed.countedChildIDs);
    for (const [id, child] of Object.entries(children)) {
      const candidate = child as Partial<ChildSessionState>;
      if (typeof candidate.title === "string" && isCountableWorkItem({
        id,
        title: candidate.title,
        source: candidate.source,
      })) {
        countedChildIDs[id] = true;
      }
    }

    const state: StatuslineState = {
      children: children as Record<string, ChildSessionState>,
      countedChildIDs,
      totalExecuted: Math.max(
        toNonNegativeInteger(parsed.totalExecuted) ?? 0,
        Object.keys(countedChildIDs).length,
      ),
      updatedAt:
        typeof parsed.updatedAt === "string"
          ? parsed.updatedAt
          : new Date().toISOString(),
    };

    refreshDerivedFields(state);
    return state;
  } catch {
    return createEmptyState();
  }
}

export async function saveState(
  statePath: string,
  state: StatuslineState,
): Promise<void> {
  refreshDerivedFields(state);
  await mkdir(dirname(statePath), { recursive: true });
  await writeFile(statePath, JSON.stringify(state, null, 2), "utf8");
}

export function upsertRunningChild(
  state: StatuslineState,
  input: Pick<ChildSessionState, "id" | "title" | "parentID"> &
    Partial<
      Pick<
        ChildSessionState,
        | "summary"
        | "agentName"
        | "messageID"
        | "source"
        | "targetSessionID"
        | "startedAt"
        | "updatedAt"
      >
    >,
): boolean {
  const now = new Date().toISOString();
  const observedUpdatedAt = safeTimestamp(input.updatedAt, now);
  const observedStartedAt = safeTimestamp(input.startedAt, observedUpdatedAt);
  const existing = state.children[input.id];
  const counted = existing
    ? false
    : countChildExecution(state, {
        id: input.id,
        title: input.title,
        source: input.source,
      });
  const targetSessionID = sanitizeTargetSessionID(
    input.targetSessionID ?? existing?.targetSessionID,
    input.id.startsWith("ses_") ? input.id : undefined,
  );
  const shouldKeepCompletedTiming =
    existing?.status === "done" || existing?.status === "error";
  const next: ChildSessionState = {
    id: input.id,
    title: input.title,
    summary:
      sanitizeSummary(input.summary, input.title) ??
      sanitizeSummary(existing?.summary, input.title),
    agentName: sanitizeAgentName(input.agentName) ?? existing?.agentName,
    parentID: input.parentID,
    messageID: input.messageID ?? existing?.messageID,
    source: input.source ?? existing?.source ?? "session",
    targetSessionID,
    status: shouldKeepCompletedTiming ? existing.status : "running",
    color: statusColor(shouldKeepCompletedTiming ? existing.status : "running"),
    startedAt: existing?.startedAt ?? observedStartedAt,
    updatedAt: observedUpdatedAt,
    endedAt: shouldKeepCompletedTiming ? existing.endedAt : undefined,
    elapsedMs: existing?.elapsedMs,
    tokens: existing?.tokens,
  };

  if (
    existing &&
    next.title === existing.title &&
    next.summary === existing.summary &&
    next.agentName === existing.agentName &&
    next.parentID === existing.parentID &&
    next.messageID === existing.messageID &&
    next.source === existing.source &&
    next.targetSessionID === existing.targetSessionID &&
    next.status === existing.status &&
    next.color === existing.color &&
    next.startedAt === existing.startedAt &&
    next.endedAt === existing.endedAt &&
    sameTokens(next.tokens, existing.tokens)
  ) {
    return counted;
  }

  state.children[input.id] = next;
  state.updatedAt = observedUpdatedAt;
  return true;
}

export function markChildStatus(
  state: StatuslineState,
  childID: string,
  status: Exclude<ChildStatus, "running">,
  endedAt?: string,
): boolean {
  const now = new Date().toISOString();
  let changed = false;
  let stateUpdatedAt = state.updatedAt;

  for (const child of Object.values(state.children)) {
    if (child.id !== childID && child.targetSessionID !== childID) continue;

    const observedEndedAt = endedAt
      ? safeTimestamp(endedAt, now)
      : child.endedAt ?? now;

    if (
      child.status === status &&
      child.color === statusColor(status) &&
      child.updatedAt === observedEndedAt &&
      child.endedAt === observedEndedAt
    ) {
      continue;
    }

    const nextChild: ChildSessionState = {
      ...child,
      status,
      color: statusColor(status),
      updatedAt: observedEndedAt,
      endedAt: observedEndedAt,
    };
    state.children[child.id] = {
      ...nextChild,
      elapsedMs: resolveElapsedMs(nextChild, Date.now()),
    };
    stateUpdatedAt = observedEndedAt;
    changed = true;
  }

  if (changed) {
    state.updatedAt = stateUpdatedAt;
  }
  return changed;
}

export function upsertChildDetails(
  state: StatuslineState,
  childID: string,
  input: {
    title?: string;
    summary?: string;
    agentName?: string;
    tokens?: ChildTokenState;
    targetSessionID?: string;
    updatedAt?: string;
  },
): boolean {
  const existing = state.children[childID];
  if (!existing) return false;

  const nextTitle =
    typeof input.title === "string" && input.title.trim().length > 0
      ? input.title
      : existing.title;
  const nextSummary =
    sanitizeSummary(input.summary, nextTitle) ??
    sanitizeSummary(existing.summary, nextTitle);
  const nextAgentName = sanitizeAgentName(input.agentName) ?? existing.agentName;
  const mergedTokens = mergeTokens(existing.tokens, input.tokens);
  const nextTargetSessionID = sanitizeTargetSessionID(
    input.targetSessionID ?? existing.targetSessionID,
    existing.id.startsWith("ses_") ? existing.id : undefined,
  );

  const detailsChanged =
    nextTitle !== existing.title ||
    nextSummary !== existing.summary ||
    nextAgentName !== existing.agentName ||
    !sameTokens(mergedTokens, existing.tokens) ||
    nextTargetSessionID !== existing.targetSessionID;

  if (!detailsChanged) return false;

  const now = new Date().toISOString();
  const observedUpdatedAt = safeTimestamp(input.updatedAt, now);
  state.children[childID] = {
    ...existing,
    title: nextTitle,
    summary: nextSummary,
    agentName: nextAgentName,
    tokens: mergedTokens,
    targetSessionID: nextTargetSessionID,
    updatedAt: observedUpdatedAt,
  };
  state.updatedAt = observedUpdatedAt;
  return true;
}

export function getCounts(state: StatuslineState): StatusCounts {
  const counts: StatusCounts = { running: 0, done: 0, error: 0 };
  for (const child of Object.values(state.children)) {
    if (child.status === "running") counts.running += 1;
    if (child.status === "done") counts.done += 1;
    if (child.status === "error") counts.error += 1;
  }
  return counts;
}
