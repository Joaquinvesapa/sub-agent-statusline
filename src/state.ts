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
  updatedAt: string;
}

export interface StatusCounts {
  running: number;
  done: number;
  error: number;
}

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

function resolveElapsedMs(child: ChildSessionState, nowMs: number): number {
  const startedMs = Date.parse(child.startedAt);
  if (Number.isNaN(startedMs)) return 0;

  const endSource = child.endedAt ?? child.updatedAt;
  const endMs = child.endedAt ? Date.parse(endSource) : nowMs;
  if (Number.isNaN(endMs)) return 0;
  return Math.max(0, endMs - startedMs);
}

export function refreshDerivedFields(
  state: StatuslineState,
  now = new Date(),
): void {
  const nowISO = now.toISOString();
  const nowMs = now.getTime();

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

    const state: StatuslineState = {
      children: children as Record<string, ChildSessionState>,
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
        "messageID" | "source" | "targetSessionID" | "startedAt" | "updatedAt"
      >
    >,
): boolean {
  const now = new Date().toISOString();
  const observedUpdatedAt = safeTimestamp(input.updatedAt, now);
  const observedStartedAt = safeTimestamp(input.startedAt, observedUpdatedAt);
  const existing = state.children[input.id];
  const targetSessionID = sanitizeTargetSessionID(
    input.targetSessionID ?? existing?.targetSessionID,
    input.id.startsWith("ses_") ? input.id : undefined,
  );
  const shouldKeepCompletedTiming =
    existing?.status === "done" || existing?.status === "error";
  const next: ChildSessionState = {
    id: input.id,
    title: input.title,
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
  const existing = state.children[childID];
  if (!existing) {
    return false;
  }

  const now = new Date().toISOString();
  const observedEndedAt = safeTimestamp(endedAt, now);
  const nextChild: ChildSessionState = {
    ...existing,
    status,
    color: statusColor(status),
    updatedAt: observedEndedAt,
    endedAt: observedEndedAt,
  };
  state.children[childID] = {
    ...nextChild,
    elapsedMs: resolveElapsedMs(nextChild, Date.now()),
  };
  state.updatedAt = observedEndedAt;
  return true;
}

export function upsertChildDetails(
  state: StatuslineState,
  childID: string,
  input: {
    title?: string;
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
  const mergedTokens = mergeTokens(existing.tokens, input.tokens);
  const nextTargetSessionID = sanitizeTargetSessionID(
    input.targetSessionID ?? existing.targetSessionID,
    existing.id.startsWith("ses_") ? existing.id : undefined,
  );

  const detailsChanged =
    nextTitle !== existing.title ||
    JSON.stringify(mergedTokens) !== JSON.stringify(existing.tokens) ||
    nextTargetSessionID !== existing.targetSessionID;

  const shouldTouch = existing.status === "running";
  if (!detailsChanged && !shouldTouch) return false;

  const now = new Date().toISOString();
  const observedUpdatedAt = safeTimestamp(input.updatedAt, now);
  state.children[childID] = {
    ...existing,
    title: nextTitle,
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
