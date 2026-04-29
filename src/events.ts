import type { ChildTokenState, StatuslineState } from "./state.js";
import { markChildStatus, upsertChildDetails, upsertRunningChild } from "./state.js";

export type EventLike = {
  type?: unknown;
  title?: unknown;
  name?: unknown;
  sessionID?: unknown;
  sessionId?: unknown;
  properties?: {
    id?: unknown;
    sessionID?: unknown;
    sessionId?: unknown;
    title?: unknown;
    name?: unknown;
    info?: {
      id?: unknown;
      title?: unknown;
      name?: unknown;
      agent?: unknown;
      subagent_type?: unknown;
      sessionID?: unknown;
      sessionId?: unknown;
      parentID?: unknown;
      role?: unknown;
      time?: unknown;
    };
    part?: unknown;
  };
  [key: string]: unknown;
};

type SubtaskChild = {
  id: string;
  title: string;
  summary?: string;
  agentName?: string;
  parentID: string;
  messageID: string;
  targetSessionID?: string;
  startedAt?: string;
  updatedAt?: string;
};

type ToolChild = SubtaskChild & {
  status: "running" | "done" | "error";
  endedAt?: string;
};

type SyntheticTargetContext = {
  id: string;
  parentID: string;
  messageID?: string;
};

export function asString(value: unknown): string | undefined {
  return typeof value === "string" && value.length > 0 ? value : undefined;
}

function conciseText(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;
  const text = value.replace(/\s+/g, " ").trim();
  if (!text) return undefined;
  return text.length > 180 ? `${text.slice(0, 179)}…` : text;
}

function sameDisplayText(a: string | undefined, b: string | undefined): boolean {
  if (!a || !b) return false;
  return (
    a.replace(/\s+/g, " ").trim().toLowerCase() ===
    b.replace(/\s+/g, " ").trim().toLowerCase()
  );
}

function firstDistinctSummary(
  candidates: unknown[],
  title: string | undefined,
): string | undefined {
  for (const candidate of candidates) {
    const summary = conciseText(candidate);
    if (summary && !sameDisplayText(summary, title)) return summary;
  }
  return undefined;
}

function isTechnicalDelegationTitle(value: string | undefined): boolean {
  if (!value) return false;
  return /^delegation:\s+/i.test(value.trim());
}

function promptTitle(value: unknown): string | undefined {
  const text = conciseText(value);
  if (!text) return undefined;
  const sentence = text.match(/^(.+?[.!?])\s/)?.[1]?.trim();
  const title = sentence && sentence.length <= 100 ? sentence : text;
  return title.length > 100 ? `${title.slice(0, 99)}…` : title;
}

function firstUsefulTitle(candidates: unknown[]): string | undefined {
  for (const candidate of candidates) {
    const title = promptTitle(candidate);
    if (title && !isTechnicalDelegationTitle(title)) return title;
  }
  return undefined;
}

export function extractCreatedChild(event: EventLike): {
  id: string;
  title: string;
  agentName?: string;
  parentID: string;
  startedAt?: string;
  updatedAt?: string;
} | null {
  const info = event.properties?.info;
  const parentID = asString(info?.parentID);
  if (!parentID) return null;

  const id = asString(info?.id) ?? asString(event.properties?.id);
  if (!id) return null;

  const title = asString(info?.title) ?? "subagent";
  const agentName = asString(info?.agent) ?? asString(info?.subagent_type);
  const startedAt = extractEventTimestamp(event, [
    "started",
    "start",
    "created",
    "updated",
  ]);
  const updatedAt =
    extractEventTimestamp(event, ["updated", "created", "started", "start"]) ??
    startedAt;
  return { id, title, agentName, parentID, startedAt, updatedAt };
}

export function extractSessionID(event: EventLike): string | undefined {
  return (
    asString(event.properties?.sessionID) ??
    asString(event.properties?.sessionId) ??
    asString(event.properties?.info?.sessionID) ??
    asString(event.properties?.info?.sessionId) ??
    asString(event.sessionID) ??
    asString(event.sessionId) ??
    asString(event.properties?.info?.id) ??
    asString(event.properties?.id)
  );
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === "object";
}

function isSessionID(value: unknown): value is string {
  return typeof value === "string" && value.startsWith("ses_");
}

function collectSessionIDs(input: unknown, target: Set<string>, depth = 0): void {
  if (depth > 4 || !input) return;

  if (isSessionID(input)) {
    target.add(input);
    return;
  }

  if (!isRecord(input) && !Array.isArray(input)) return;

  if (Array.isArray(input)) {
    for (const value of input) {
      collectSessionIDs(value, target, depth + 1);
    }
    return;
  }

  for (const [key, value] of Object.entries(input)) {
    if (!key.toLowerCase().includes("session")) continue;
    collectSessionIDs(value, target, depth + 1);
  }
}

function resolveSyntheticTargetSessionID(
  state: StatuslineState,
  synthetic: SyntheticTargetContext,
  explicitCandidates: readonly string[] = [],
): string | undefined {
  const candidates = new Set<string>(explicitCandidates.filter(isSessionID));

  const byMessage = Object.values(state.children).filter(
    (child) =>
      child.id.startsWith("ses_") &&
      child.parentID === synthetic.parentID &&
      child.messageID &&
      synthetic.messageID &&
      child.messageID === synthetic.messageID,
  );
  if (byMessage.length === 1) {
    candidates.add(byMessage[0].id);
  }

  const byParent = Object.values(state.children).filter(
    (child) => child.id.startsWith("ses_") && child.parentID === synthetic.parentID,
  );
  if (byParent.length === 1) {
    candidates.add(byParent[0].id);
  }

  if (candidates.size !== 1) return undefined;
  return [...candidates][0];
}

function extractPartTargetSessionCandidates(event: EventLike): string[] {
  const part = isRecord(event.properties?.part) ? event.properties.part : undefined;
  if (!part) return [];

  const candidates = new Set<string>();
  collectSessionIDs(part, candidates);

  const parentSessionID = asString(part.sessionID) ?? extractSessionID(event);
  if (parentSessionID) candidates.delete(parentSessionID);

  return [...candidates];
}

function toIsoTimestamp(value: unknown): string | undefined {
  if (typeof value === "string") {
    if (value.trim().length === 0) return undefined;
    const parsed = Date.parse(value);
    if (Number.isNaN(parsed)) return undefined;
    return new Date(parsed).toISOString();
  }

  if (typeof value === "number" && Number.isFinite(value)) {
    if (value <= 0) return undefined;
    const millis = value < 10_000_000_000 ? value * 1000 : value;
    const parsed = new Date(millis);
    return Number.isNaN(parsed.getTime()) ? undefined : parsed.toISOString();
  }

  return undefined;
}

function extractEventTimestamp(event: EventLike, keys: string[]): string | undefined {
  const part = isRecord(event.properties?.part) ? event.properties?.part : undefined;
  const state = isRecord(part?.state) ? part?.state : undefined;
  const sources = [
    isRecord(event.properties?.info?.time) ? event.properties?.info?.time : undefined,
    isRecord(part?.time) ? part?.time : undefined,
    isRecord(part?.timestamps) ? part?.timestamps : undefined,
    isRecord(state?.time) ? state?.time : undefined,
    isRecord(state?.timestamps) ? state?.timestamps : undefined,
    state,
    part,
  ];

  for (const source of sources) {
    if (!source) continue;
    for (const key of keys) {
      const candidate = toIsoTimestamp(source[key]);
      if (candidate) return candidate;
    }
  }

  return undefined;
}

function extractSubtaskChild(event: EventLike): SubtaskChild | null {
  const part = event.properties?.part;
  if (!isRecord(part) || part.type !== "subtask") return null;

  const partID = asString(part.id);
  const parentID = asString(part.sessionID) ?? extractSessionID(event);
  const messageID = asString(part.messageID);
  if (!partID || !parentID || !messageID) return null;

  const description = asString(part.description);
  const command = asString(part.command);
  const agent = asString(part.agent);
  const title = description || command || agent || "subtask";
  const state = isRecord(part.state) ? part.state : undefined;
  const input = isRecord(state?.input) ? state.input : undefined;
  const summary = firstDistinctSummary(
    [input?.prompt, input?.description, part.description, state?.description],
    title,
  );
  const startedAt = extractEventTimestamp(event, [
    "started",
    "start",
    "created",
    "updated",
  ]);
  const updatedAt =
    extractEventTimestamp(event, ["updated", "created", "started", "start"]) ??
    startedAt;
  const targetCandidates = extractPartTargetSessionCandidates(event);
  const targetSessionID = targetCandidates.length === 1 ? targetCandidates[0] : undefined;

  return {
    id: `subtask:${partID}`,
    title,
    summary,
    agentName: agent,
    parentID,
    messageID,
    targetSessionID,
    startedAt,
    updatedAt,
  };
}

function extractToolChild(event: EventLike): ToolChild | null {
  const part = event.properties?.part;
  if (!isRecord(part) || part.type !== "tool") return null;

  const tool = asString(part.tool);
  if (tool !== "delegate" && tool !== "task") return null;

  const partID = asString(part.id);
  const parentID = asString(part.sessionID) ?? extractSessionID(event);
  const messageID = asString(part.messageID);
  const state = isRecord(part.state) ? part.state : undefined;
  if (!partID || !parentID || !messageID || !state) return null;

  const rawStatus = asString(state.status);
  const status =
    rawStatus === "completed"
      ? "done"
      : rawStatus === "error"
        ? "error"
        : "running";

  const input = isRecord(state.input) ? state.input : {};
  const description = asString(input.description);
  const subagentType = asString(input.subagent_type);
  const rawTitle = asString(state.title);
  const title =
    (isTechnicalDelegationTitle(rawTitle) ? undefined : rawTitle) ||
    description ||
    firstUsefulTitle([input.prompt, part.description, state.description]) ||
    subagentType ||
    tool;
  const summary = firstDistinctSummary(
    [input.prompt, input.description, part.description, state.description],
    title,
  );
  const startedAt = extractEventTimestamp(event, [
    "started",
    "start",
    "created",
    "updated",
  ]);
  const updatedAt =
    extractEventTimestamp(event, ["updated", "completed", "created", "started", "start"]) ??
    startedAt;
  const endedAt =
    status === "done" || status === "error"
      ? extractEventTimestamp(event, ["completed", "ended", "updated"])
      : undefined;
  const targetCandidates = extractPartTargetSessionCandidates(event);
  const targetSessionID = targetCandidates.length === 1 ? targetCandidates[0] : undefined;

  return {
    id: `tool:${partID}`,
    title,
    summary,
    agentName: subagentType,
    parentID,
    messageID,
    targetSessionID,
    status,
    startedAt,
    updatedAt,
    endedAt,
  };
}

function extractCompletedAssistantMessage(event: EventLike): {
  sessionID: string;
  messageID: string;
} | null {
  const info = event.properties?.info;
  if (!isRecord(info)) return null;
  if (info.role !== "assistant") return null;

  const time = info.time;
  if (!isRecord(time) || typeof time.completed !== "number") return null;

  const sessionID = asString(info.sessionID) ?? extractSessionID(event);
  const messageID = asString(info.id);
  if (!sessionID || !messageID) return null;
  return { sessionID, messageID };
}

function extractDetailTargetIDs(event: EventLike): string[] {
  const ids = new Set<string>();
  const part = event.properties?.part;

  if (isRecord(part)) {
    const partID = asString(part.id);
    if (part.type === "subtask" && partID) {
      ids.add(`subtask:${partID}`);
    }

    if (part.type === "tool") {
      const tool = asString(part.tool);
      if ((tool === "delegate" || tool === "task") && partID) {
        ids.add(`tool:${partID}`);
      }
    }
  }

  const sessionID = extractSessionID(event);
  if (sessionID) ids.add(sessionID);

  return [...ids];
}

function normalizePercent(value: number): number {
  if (value > 0 && value <= 1) {
    return value * 100;
  }
  return value;
}

export function extractChildDetails(event: EventLike): {
  title?: string;
  summary?: string;
  agentName?: string;
  tokens?: ChildTokenState;
  updatedAt?: string;
} {
  const details: {
    title?: string;
    summary?: string;
    agentName?: string;
    tokens?: ChildTokenState;
    updatedAt?: string;
  } = {};

  details.updatedAt = extractEventTimestamp(event, [
    "updated",
    "completed",
    "created",
    "started",
    "start",
  ]);

  const titleCandidates = [
    event.properties?.info?.title,
    event.properties?.title,
    event.properties?.info?.name,
    event.properties?.name,
    event.title,
    event.name,
  ];

  for (const candidate of titleCandidates) {
    const title = asString(candidate);
    if (title) {
      details.title = title;
      break;
    }
  }

  const part = isRecord(event.properties?.part) ? event.properties.part : undefined;
  const partState = isRecord(part?.state) ? part.state : undefined;
  const partInput = isRecord(partState?.input) ? partState.input : undefined;
  details.agentName =
    asString(partInput?.subagent_type) ??
    asString(partInput?.agent) ??
    asString(part?.agent) ??
    asString(event.properties?.info?.agent) ??
    asString(event.properties?.info?.subagent_type);
  details.summary = firstDistinctSummary(
    [
      partInput?.prompt,
      partInput?.description,
      part?.description,
      partState?.description,
    ],
    details.title,
  );
  if (isTechnicalDelegationTitle(details.title)) {
    const replacementTitle =
      asString(partInput?.description) ??
      firstUsefulTitle([partInput?.prompt, part?.description, partState?.description]);
    if (replacementTitle) {
      details.title = replacementTitle;
    }
  }

  const tokenHints: ChildTokenState = {};
  const visited = new Set<object>();

  const walk = (node: unknown, depth: number): void => {
    if (!isRecord(node) || depth > 6) return;
    if (visited.has(node)) return;
    visited.add(node);

    for (const [rawKey, rawValue] of Object.entries(node)) {
      const key = rawKey.toLowerCase();
      const asNumber =
        typeof rawValue === "number"
          ? rawValue
          : typeof rawValue === "string" && rawValue.trim().length > 0
            ? Number(rawValue)
            : undefined;

      if (typeof asNumber === "number" && Number.isFinite(asNumber)) {
        if (key.includes("context") && key.includes("percent")) {
          tokenHints.contextPercent = normalizePercent(asNumber);
        } else if (key.includes("context") && key.includes("usage")) {
          tokenHints.contextPercent = normalizePercent(asNumber);
        } else if (
          (key.includes("input") || key.includes("prompt")) &&
          key.includes("token")
        ) {
          tokenHints.input = asNumber;
        } else if (
          (key.includes("output") || key.includes("completion")) &&
          key.includes("token")
        ) {
          tokenHints.output = asNumber;
        } else if (key.includes("total") && key.includes("token")) {
          tokenHints.total = asNumber;
        } else if (key === "tokens" || key === "token") {
          tokenHints.total = asNumber;
        }
      }

      if (isRecord(rawValue)) {
        walk(rawValue, depth + 1);
      }
    }
  };

  walk(event, 0);

  if (
    tokenHints.input !== undefined ||
    tokenHints.output !== undefined ||
    tokenHints.total !== undefined ||
    tokenHints.contextPercent !== undefined
  ) {
    details.tokens = tokenHints;
  }

  return details;
}

export function applySubagentEvent(state: StatuslineState, event: unknown): boolean {
  const e = (event ?? {}) as EventLike;
  const type = asString(e.type);
  if (!type) return false;

  if (type === "session.created" || type === "session.updated") {
    const child = extractCreatedChild(e);
    if (child) {
      const details = extractChildDetails(e);
      let changed = upsertRunningChild(state, {
        ...child,
        source: "session",
        targetSessionID: child.id,
      });
      changed = upsertChildDetails(state, child.id, details) || changed;
      return changed;
    }
    return false;
  }

  if (type === "session.idle") {
    const childID = extractSessionID(e);
    if (!childID) return false;
    const endedAt = extractEventTimestamp(e, ["completed", "ended", "updated"]);
    const details = extractChildDetails(e);
    let changed = markChildStatus(state, childID, "done", endedAt);
    changed = upsertChildDetails(state, childID, details) || changed;
    return changed;
  }

  if (type === "session.error") {
    const childID = extractSessionID(e);
    if (!childID) return false;
    const endedAt = extractEventTimestamp(e, ["completed", "ended", "updated"]);
    const details = extractChildDetails(e);
    let changed = markChildStatus(state, childID, "error", endedAt);
    changed = upsertChildDetails(state, childID, details) || changed;
    return changed;
  }

  let changed = false;

  if (type === "message.part.updated") {
    const subtask = extractSubtaskChild(e);
    if (subtask) {
      const targetSessionID = resolveSyntheticTargetSessionID(
        state,
        {
          id: subtask.id,
          parentID: subtask.parentID,
          messageID: subtask.messageID,
        },
        subtask.targetSessionID ? [subtask.targetSessionID] : [],
      );
      changed =
        upsertRunningChild(state, {
          ...subtask,
          source: "subtask",
          targetSessionID,
          startedAt: subtask.startedAt,
          updatedAt: subtask.updatedAt,
        }) || changed;
    }

    const tool = extractToolChild(e);
    if (tool) {
      const targetSessionID = resolveSyntheticTargetSessionID(
        state,
        {
          id: tool.id,
          parentID: tool.parentID,
          messageID: tool.messageID,
        },
        tool.targetSessionID ? [tool.targetSessionID] : [],
      );
      const childChanged = upsertRunningChild(state, {
        ...tool,
        source: "tool",
        targetSessionID,
        startedAt: tool.startedAt,
        updatedAt: tool.updatedAt,
      });
      changed = childChanged || changed;
      if (tool.status === "done" || tool.status === "error") {
        changed =
          markChildStatus(state, tool.id, tool.status, tool.endedAt ?? tool.updatedAt) ||
          changed;
      }
    }
  }

  if (type === "message.updated") {
    const completed = extractCompletedAssistantMessage(e);
    if (completed) {
      for (const child of Object.values(state.children)) {
        if (
          child.source === "subtask" &&
          child.status === "running" &&
          child.parentID === completed.sessionID &&
          child.messageID === completed.messageID
        ) {
          changed = markChildStatus(state, child.id, "done") || changed;
        }
      }
    }
  }

  if (type === "message.updated" || type === "message.part.updated") {
    const details = extractChildDetails(e);
    for (const childID of extractDetailTargetIDs(e)) {
      if (state.children[childID]) {
        changed = upsertChildDetails(state, childID, details) || changed;
      }
    }
  }

  return changed;
}
