export interface RunningReconcileCacheEntry {
  nextAllowedAtMs: number;
  backoffMs: number;
}

export type RunningReconcileEvidence = {
  status?: "running" | "done" | "error";
  endedAt?: string;
  checkedMessages?: boolean;
  sawRunningEvidence?: boolean;
  probeFailed?: boolean;
  canApplyStaleFallback?: boolean;
};

export type OpenCodeSessionChildStatus = "running" | "done" | "error";

export type SessionMessageSummary = {
  completedAt?: string;
  evidenceAt?: string;
  hasError?: boolean;
  fetchFailed?: boolean;
  latestAssistantActivityAt?: string;
  latestAssistantActivityAtMs?: number;
  latestMessageActivityAt?: string;
  latestMessageActivityAtMs?: number;
};

const DEFAULT_STALE_RUNNING_THRESHOLD_MS = 10 * 60 * 60_000;

const RUNNING_SESSION_STATUS_VALUES = new Set([
  "busy",
  "running",
  "pending",
  "queued",
  "in_progress",
  "working",
  "compacting",
  "retry",
]);

const DONE_SESSION_STATUS_VALUES = new Set([
  "idle",
  "done",
  "completed",
  "complete",
  "success",
  "succeeded",
]);

const ERROR_SESSION_STATUS_VALUES = new Set([
  "error",
  "failed",
  "failure",
  "cancelled",
  "canceled",
  "aborted",
]);

export function defaultStaleRunningThresholdMs(): number {
  return DEFAULT_STALE_RUNNING_THRESHOLD_MS;
}

export function parseStaleRunningThresholdMs(value: unknown): number {
  if (typeof value !== "string" || value.trim().length === 0) {
    return DEFAULT_STALE_RUNNING_THRESHOLD_MS;
  }

  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed < 0) {
    return DEFAULT_STALE_RUNNING_THRESHOLD_MS;
  }

  return Math.floor(parsed);
}

export function deriveOpenCodeSessionStatus(
  value: unknown,
): OpenCodeSessionChildStatus | undefined {
  if (hasStructuredErrorEvidence(value)) {
    return "error";
  }

  const values = collectOpenCodeSessionStatusValues(value);

  if (values.some((status) => ERROR_SESSION_STATUS_VALUES.has(status))) {
    return "error";
  }

  if (values.some((status) => RUNNING_SESSION_STATUS_VALUES.has(status))) {
    return "running";
  }

  if (values.some((status) => DONE_SESSION_STATUS_VALUES.has(status))) {
    return "done";
  }

  return undefined;
}

export function hasStructuredErrorEvidence(value: unknown, depth = 0): boolean {
  if (depth > 4) return false;
  const record = asRecord(value);
  if (!record) return false;

  if (record.error) return true;

  for (const nested of Object.values(record)) {
    if (Array.isArray(nested)) {
      if (nested.some((item) => hasStructuredErrorEvidence(item, depth + 1))) {
        return true;
      }
      continue;
    }

    if (hasStructuredErrorEvidence(nested, depth + 1)) return true;
  }

  return false;
}

export function resolveSessionStatusWithMessageSummary(input: {
  status?: OpenCodeSessionChildStatus;
  summary?: SessionMessageSummary;
}): { status?: OpenCodeSessionChildStatus; endedAt?: string } {
  const summary = input.summary;

  if (input.status === "error") {
    return { status: "error", endedAt: summary?.evidenceAt };
  }

  if (input.status === "running") {
    return { status: "running" };
  }

  if (summary && !summary.fetchFailed && summary.hasError) {
    return { status: "error", endedAt: summary.evidenceAt };
  }

  if (input.status === "done") {
    return {
      status: "done",
      endedAt: summary?.completedAt ?? summary?.evidenceAt,
    };
  }

  if (
    summary &&
    !summary.fetchFailed &&
    typeof summary.completedAt === "string"
  ) {
    return { status: "done", endedAt: summary.completedAt };
  }

  return {};
}

export type PersistedStaleSubtaskCandidate = {
  childID: string;
  parentID: string;
  messageID: string;
  title?: string;
  summary?: string;
  agentName?: string;
};

export type PersistedStaleSubtaskResolution = {
  status: "done" | "error";
  endedAt?: string;
  targetSessionID?: string;
};

export function summarizeSessionMessages(messages: unknown[]): {
  completedAt?: string;
  evidenceAt?: string;
  hasError: boolean;
  latestAssistantActivityAt?: string;
  latestAssistantActivityAtMs?: number;
  latestMessageActivityAt?: string;
  latestMessageActivityAtMs?: number;
} {
  let completedAt: string | undefined;
  let evidenceAt: string | undefined;
  let hasError = false;
  let latestAssistantActivityAt: string | undefined;
  let latestAssistantActivityAtMs: number | undefined;
  let latestMessageActivityAt: string | undefined;
  let latestMessageActivityAtMs: number | undefined;
  const messageInfos = messages
    .map((rawMessage) => asRecord(rawMessage))
    .map((message) => asRecord(message?.info));

  for (const info of messageInfos) {
    if (!info) continue;
    const activityMs = messageTimeMillis(info);
    if (
      activityMs > 0 &&
      (latestMessageActivityAtMs === undefined ||
        activityMs > latestMessageActivityAtMs)
    ) {
      latestMessageActivityAtMs = activityMs;
      latestMessageActivityAt = new Date(activityMs).toISOString();
    }
  }

  const assistantMessages = messageInfos
    .filter(
      (info): info is Record<string, unknown> => info?.role === "assistant",
    )
    .sort((left, right) => messageTimeMillis(left) - messageTimeMillis(right));

  for (const info of assistantMessages) {
    const time = asRecord(info.time);
    const activityMs = messageTimeMillis(info);
    if (
      activityMs > 0 &&
      (latestAssistantActivityAtMs === undefined ||
        activityMs > latestAssistantActivityAtMs)
    ) {
      latestAssistantActivityAtMs = activityMs;
      latestAssistantActivityAt = new Date(activityMs).toISOString();
    }
    const candidate = timestampFromUnknown(time?.completed);
    const errorAt =
      timestampFromUnknown(time?.updated) ??
      timestampFromUnknown(time?.completed) ??
      timestampFromUnknown(time?.created);
    if (info.error) {
      hasError = true;
      evidenceAt = errorAt ?? evidenceAt;
    } else if (candidate) {
      completedAt = candidate;
      evidenceAt = candidate;
      hasError = false;
    }
  }

  return {
    completedAt,
    evidenceAt,
    hasError,
    latestAssistantActivityAt,
    latestAssistantActivityAtMs,
    latestMessageActivityAt,
    latestMessageActivityAtMs,
  };
}

export function hasRecentMessageActivity(input: {
  nowMs: number;
  latestMessageActivityAtMs?: number;
  staleThresholdMs: number;
}): boolean {
  return (
    input.latestMessageActivityAtMs !== undefined &&
    input.nowMs - input.latestMessageActivityAtMs < input.staleThresholdMs
  );
}

export function canSafelyCloseNoTargetPersistedCandidate(input: {
  nowMs: number;
  staleThresholdMs: number;
  startedMs: number;
  updatedMs: number;
  latestMessageActivityAtMs?: number;
}): boolean {
  if (input.staleThresholdMs <= 0) return false;
  if (
    input.startedMs < input.staleThresholdMs ||
    input.updatedMs < input.staleThresholdMs
  ) {
    return false;
  }
  return !hasRecentMessageActivity({
    nowMs: input.nowMs,
    latestMessageActivityAtMs: input.latestMessageActivityAtMs,
    staleThresholdMs: input.staleThresholdMs,
  });
}

export function shouldApplyStaleRunningFallback(input: {
  staleThresholdMs: number;
  evidence: RunningReconcileEvidence;
  startedMs: number;
  updatedMs: number;
}): boolean {
  return (
    input.staleThresholdMs > 0 &&
    input.evidence.canApplyStaleFallback === true &&
    input.evidence.probeFailed !== true &&
    input.startedMs >= input.staleThresholdMs &&
    input.updatedMs >= input.staleThresholdMs
  );
}

export function shouldSkipCandidateForBackoff(
  cache: RunningReconcileCacheEntry | undefined,
  nowMs: number,
): boolean {
  return cache !== undefined && nowMs < cache.nextAllowedAtMs;
}

export function nextBackoffState(input: {
  cache: RunningReconcileCacheEntry | undefined;
  nowMs: number;
  initialBackoffMs: number;
  maxBackoffMs: number;
}): RunningReconcileCacheEntry {
  const nextBackoffMs = input.cache
    ? Math.min(
        input.maxBackoffMs,
        Math.max(input.initialBackoffMs, input.cache.backoffMs * 2),
      )
    : input.initialBackoffMs;
  return {
    backoffMs: nextBackoffMs,
    nextAllowedAtMs: input.nowMs + nextBackoffMs,
  };
}

export function capCandidates<T>(candidates: T[], maxCandidates: number): T[] {
  if (maxCandidates <= 0) return [];
  return candidates.length <= maxCandidates
    ? candidates
    : candidates.slice(0, maxCandidates);
}

export function resolvePersistedStaleSubtaskFromParentMessages(input: {
  candidate: PersistedStaleSubtaskCandidate;
  messages: unknown[];
}): PersistedStaleSubtaskResolution | undefined {
  type RankedMatch = PersistedStaleSubtaskResolution & { score: number };
  const matches: RankedMatch[] = [];

  for (const rawMessage of input.messages) {
    const message = asRecord(rawMessage);
    const info = asRecord(message?.info);
    if (!info || info.role !== "assistant") continue;

    const assistantParentID = asString(
      info.parentID ?? message?.parentID ?? message?.parentMessageID,
    );
    const parts = Array.isArray(message?.parts) ? message.parts : [];

    for (const rawPart of parts) {
      const part = asRecord(rawPart);
      if (!part || part.type !== "tool" || part.tool !== "task") continue;

      const state = asRecord(part.state);
      const rawStatus = asString(state?.status);
      const status =
        rawStatus === "completed"
          ? "done"
          : rawStatus === "error"
            ? "error"
            : undefined;
      if (!status) continue;

      const metadata = asRecord(state?.metadata);
      const targetSessionID =
        sessionIDFromUnknown(metadata?.sessionId) ??
        sessionIDFromUnknown(metadata?.sessionID) ??
        parseTaskSessionIDFromOutput(state?.output);

      const partTitle =
        asString(state?.input && asRecord(state.input)?.description) ??
        asString(state?.title) ??
        asString(part.description);
      const partSummary =
        asString(state?.input && asRecord(state.input)?.prompt) ??
        asString(state?.description);
      const partAgent =
        asString(state?.input && asRecord(state.input)?.subagent_type) ??
        asString(part.agent);

      const parentMessageMatch =
        assistantParentID !== undefined &&
        assistantParentID === input.candidate.messageID;
      const titleMatch = sameDisplayText(partTitle, input.candidate.title);
      const summaryMatch = sameDisplayText(partSummary, input.candidate.summary);
      const agentMatch = sameDisplayText(partAgent, input.candidate.agentName);

      const metadataCompositeMatch =
        summaryMatch || (titleMatch && agentMatch && !!input.candidate.summary);
      if (!parentMessageMatch && !metadataCompositeMatch) {
        continue;
      }

      const score =
        (parentMessageMatch ? 100 : 0) +
        (summaryMatch ? 40 : 0) +
        (titleMatch ? 20 : 0) +
        (agentMatch ? 10 : 0);

      const endedAt =
        timestampFromUnknown(
          asRecord(state?.time)?.end ??
            asRecord(state?.time)?.completed ??
            asRecord(state?.time)?.updated,
        ) ??
        timestampFromUnknown(
          asRecord(info?.time)?.completed ??
            asRecord(info?.time)?.updated ??
            asRecord(info?.time)?.created,
        );

      matches.push({
        status,
        endedAt,
        targetSessionID,
        score,
      });
    }
  }

  if (matches.length === 0) return undefined;
  if (matches.length === 1) {
    const [only] = matches;
    return {
      status: only.status,
      endedAt: only.endedAt,
      targetSessionID: only.targetSessionID,
    };
  }

  const ranked = [...matches].sort((left, right) => right.score - left.score);
  const [best, second] = ranked;
  if (!best || (second && best.score === second.score)) return undefined;
  return {
    status: best.status,
    endedAt: best.endedAt,
    targetSessionID: best.targetSessionID,
  };
}

function asRecord(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === "object"
    ? (value as Record<string, unknown>)
    : undefined;
}

function collectOpenCodeSessionStatusValues(value: unknown): string[] {
  if (typeof value === "string") {
    const normalized = normalizeStatusValue(value);
    return normalized ? [normalized] : [];
  }

  const record = asRecord(value);
  if (!record) return [];

  const values = [
    normalizeStatusValue(record.type),
    normalizeStatusValue(record.status),
    normalizeStatusValue(record.state),
    normalizeStatusValue(record.phase),
    normalizeStatusValue(record.result),
  ].filter((status): status is string => Boolean(status));

  if (record.error) values.push("error");
  if (record.busy === true || record.running === true) values.push("busy");

  return values;
}

function normalizeStatusValue(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;
  const normalized = value.trim().toLowerCase();
  return normalized.length > 0 ? normalized : undefined;
}

function asString(value: unknown): string | undefined {
  return typeof value === "string" && value.length > 0 ? value : undefined;
}

function sameDisplayText(left?: string, right?: string): boolean {
  if (!left || !right) return false;
  return left.trim().toLowerCase() === right.trim().toLowerCase();
}

function sessionIDFromUnknown(value: unknown): string | undefined {
  return typeof value === "string" && value.startsWith("ses_")
    ? value
    : undefined;
}

function parseTaskSessionIDFromOutput(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;
  const match = value.match(/\b(?:task_id\s*:\s*)?(ses_[A-Za-z0-9_-]+)\b/i);
  if (!match) return undefined;
  return match[1];
}

function messageTimeMillis(info: Record<string, unknown> | undefined): number {
  const time = asRecord(info?.time);
  return (
    timestampMillisFromUnknown(time?.completed) ??
    timestampMillisFromUnknown(time?.updated) ??
    timestampMillisFromUnknown(time?.created) ??
    0
  );
}

function timestampFromUnknown(value: unknown): string | undefined {
  const millis = timestampMillisFromUnknown(value);
  return millis === undefined ? undefined : new Date(millis).toISOString();
}

function timestampMillisFromUnknown(value: unknown): number | undefined {
  if (typeof value === "string") {
    const parsed = Date.parse(value);
    return Number.isNaN(parsed) ? undefined : parsed;
  }
  if (typeof value === "number" && Number.isFinite(value) && value > 0) {
    const millis = value < 10_000_000_000 ? value * 1000 : value;
    const parsed = new Date(millis);
    return Number.isNaN(parsed.getTime()) ? undefined : millis;
  }
  return undefined;
}
