import type {
  TuiPlugin,
  TuiPluginApi,
  TuiPluginModule,
  TuiPromptRef,
  TuiSlotContext,
  TuiThemeCurrent,
} from "@opencode-ai/plugin/tui";
import type { BoxRenderable, KeyEvent, ScrollBoxRenderable } from "@opentui/core";
import { useKeyboard } from "@opentui/solid";
import { execFileSync } from "node:child_process";
import {
  appendFileSync,
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
} from "node:fs";
import { writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import os from "node:os";
import { dirname, join } from "node:path";
import {
  For,
  Show,
  createEffect,
  createMemo,
  createSignal,
  onCleanup,
} from "solid-js";
import type { Accessor } from "solid-js";
import { applySubagentEvent, extractChildDetails } from "./events.js";
import {
  byPriority,
  formatDuration,
  renderStatusLine,
  visibleSubagentWorkItems,
} from "./render.js";
import {
  capCandidates,
  hasRecentMessageActivity,
  nextBackoffState,
  shouldApplyStaleRunningFallback,
  shouldSkipCandidateForBackoff,
  summarizeSessionMessages,
  type RunningReconcileCacheEntry,
  type RunningReconcileEvidence,
} from "./reconcile.js";
import {
  createEmptyState,
  markChildStatus,
  refreshDerivedFields,
  resolveStatePath,
  resolveTextPath,
  saveState,
  type ChildTokenState,
  type ChildSessionState,
  type StatuslineState,
} from "./state.js";

const TUI_PLUGIN_ID = "subagent-statusline.tui";
const ELAPSED_TICK_MS = 1000;
const FALLBACK_SIDEBAR_WIDTH = 34;
const MIN_ROW_WIDTH = 24;
const MIN_LABEL_WIDTH = 8;
const DONE_TOKEN_REHYDRATE_THROTTLE_MS = 2000;
const DONE_TOKEN_REHYDRATE_MAX_ATTEMPTS = 15;
const HYDRATE_RETRY_BASE_DELAY_MS = 1000;
const HYDRATE_RETRY_MAX_DELAY_MS = 30_000;
const HYDRATE_RETRY_MAX_ATTEMPTS = 6;
const RUNNING_RECONCILE_MAINTENANCE_INTERVAL_MS = 10 * 60_000;
const RUNNING_RECONCILE_MAX_CANDIDATES = 8;
const RUNNING_RECONCILE_INITIAL_BACKOFF_MS = 15_000;
const RUNNING_RECONCILE_MAX_BACKOFF_MS = 5 * 60_000;
const RUNNING_RECONCILE_MESSAGE_AGE_GATE_MS = 60_000;
const RUNNING_RECONCILE_OLD_CANDIDATE_AGE_MS = 5 * 60_000;
const DEFAULT_STALE_RUNNING_THRESHOLD_MS = 24 * 60 * 60_000;
const CLOCK_ICON = "";
const TOKEN_ICON = "";
const SIDEBAR_ARROW_EXPANDED = "▼";
const SIDEBAR_ARROW_COLLAPSED = "▶";
const SUBAGENTS_EXPANDED_KV_KEY = "subagents.sidebar.expanded";
const SUBAGENTS_SECTION_ENABLED_KV_KEY = "subagents.sidebar.enabled";
const SUBAGENTS_MAX_VISIBLE_ROWS = 5;
const SUBAGENTS_RUNNING_ROW_HEIGHT = 3;
const SUBAGENTS_TERMINAL_ROW_HEIGHT = 2;
const SUBAGENTS_ROW_GAP = 0;
const SUBAGENTS_MAX_LIST_HEIGHT =
  SUBAGENTS_MAX_VISIBLE_ROWS * SUBAGENTS_RUNNING_ROW_HEIGHT +
  (SUBAGENTS_MAX_VISIBLE_ROWS - 1) * SUBAGENTS_ROW_GAP;
const INACTIVE_SUBAGENT_OPACITY = 0.65;
const SIDEBAR_VERSION_OPACITY = 0.7;

const packageRequire = createRequire(import.meta.url);

function readPluginVersion(): string | undefined {
  try {
    const metadata = packageRequire("../package.json") as { version?: unknown };
    return typeof metadata.version === "string" && metadata.version.length > 0
      ? metadata.version
      : undefined;
  } catch {
    return undefined;
  }
}

const PLUGIN_VERSION = readPluginVersion();

interface SidebarScrollRegistration {
  getScrollbox: () => ScrollBoxRenderable | undefined;
  offsetTop: number;
}

interface SidebarListFocusRegistration {
  focusList: (preferredChildID?: string) => boolean;
  blurList: () => boolean;
  isListFocusModeActive: () => boolean;
}

const sidebarScrollRegistrations = new Set<SidebarScrollRegistration>();
const sidebarListFocusRegistrations = new Set<SidebarListFocusRegistration>();

function focusVisibleSidebarSubagentList(preferredChildID?: string): boolean {
  for (const registration of [...sidebarListFocusRegistrations].reverse()) {
    if (registration.focusList(preferredChildID)) return true;
  }
  return false;
}

function blurVisibleSidebarSubagentList(): boolean {
  for (const registration of [...sidebarListFocusRegistrations].reverse()) {
    if (registration.blurList()) return true;
  }
  return false;
}

function isAnySidebarSubagentListFocused(): boolean {
  return [...sidebarListFocusRegistrations].some((registration) =>
    registration.isListFocusModeActive(),
  );
}

function maxScrollTop(scrollbox: ScrollBoxRenderable): number {
  return Math.max(0, scrollbox.scrollHeight - scrollbox.viewport.height);
}

function clampedScrollTop(scrollbox: ScrollBoxRenderable, value: number): number {
  return Math.max(0, Math.min(value, maxScrollTop(scrollbox)));
}

function snapshotSidebarScrollOffsets(): void {
  for (const registration of sidebarScrollRegistrations) {
    const scrollbox = registration.getScrollbox();
    if (!scrollbox) continue;
    registration.offsetTop = clampedScrollTop(scrollbox, scrollbox.scrollTop);
  }
}

type SidebarContentContext = TuiSlotContext & { session_id?: string };
type HomeBottomContext = TuiSlotContext;
type PromptRefProp =
  | ((ref: TuiPromptRef | undefined) => void)
  | { current?: TuiPromptRef | undefined }
  | undefined;
type HomePromptProps = {
  workspaceID?: string;
  workspace_id?: string;
  ref?: PromptRefProp;
  [key: string]: unknown;
};
type SessionPromptProps = {
  sessionID?: string;
  session_id?: string;
  visible?: boolean;
  disabled?: boolean;
  onSubmit?: () => void;
  on_submit?: () => void;
  ref?: PromptRefProp;
  [key: string]: unknown;
};

interface RehydratedTokenCacheEntry {
  attempts: number;
  checkedAtMs: number;
  tokens?: ChildTokenState;
}

interface RunningReconcileCandidate {
  childID: string;
  targetSessionID: string;
  startedMs: number;
  updatedMs: number;
}

const doneTokenCache = new Map<string, RehydratedTokenCacheEntry>();

function debugLog(input: Record<string, unknown>): void {
  if (!process.env.OPENCODE_SUBAGENT_STATUSLINE_DEBUG_EVENTS) return;
  try {
    const path = join(
      process.env.XDG_RUNTIME_DIR ?? os.tmpdir(),
      "opencode-subagent-statusline",
      "tui-events.log",
    );
    mkdirSync(dirname(path), { recursive: true });
    const line = JSON.stringify({ time: new Date().toISOString(), ...input });
    appendFileSync(path, `${line}\n`, "utf8");
  } catch {
    // Debug logging must never crash the TUI.
  }
}

function debugEvent(event: unknown): void {
  const e = event as {
    type?: unknown;
    properties?: { sessionID?: unknown; part?: unknown; info?: unknown };
  };
  const part = e.properties?.part as
    | { type?: unknown; tool?: unknown; state?: { status?: unknown } }
    | undefined;
  debugLog({
    kind: "event",
    type: e.type,
    sessionID: e.properties?.sessionID,
    partType: part?.type,
    tool: part?.tool,
    toolStatus: part?.state?.status,
  });
}

function cloneState(state: StatuslineState): StatuslineState {
  return {
    updatedAt: state.updatedAt,
    totalExecuted: state.totalExecuted,
    countedChildIDs: { ...state.countedChildIDs },
    children: Object.fromEntries(
      Object.entries(state.children).map(([id, child]) => [
        id,
        {
          ...child,
          tokens: child.tokens ? { ...child.tokens } : undefined,
        },
      ]),
    ),
  };
}

function mergeTokenState(
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

function hasTokenTotal(tokens: ChildTokenState | undefined): boolean {
  return typeof tokens?.total === "number" && Number.isFinite(tokens.total);
}

function sameTokens(
  left: ChildTokenState | undefined,
  right: ChildTokenState | undefined,
): boolean {
  return JSON.stringify(left) === JSON.stringify(right);
}

function asRecord(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === "object"
    ? (value as Record<string, unknown>)
    : undefined;
}

function tokenStateFromMessageData(data: string): ChildTokenState | undefined {
  const parsed = safeRead(
    () => JSON.parse(data) as { tokens?: ChildTokenState },
  );
  return parsed?.tokens;
}

function resolveOpenCodeDataDir(): string {
  return join(
    process.env.XDG_DATA_HOME ?? join(os.homedir(), ".local", "share"),
    "opencode",
  );
}

function resolveOpenCodeDbPath(): string {
  return (
    process.env.OPENCODE_SUBAGENT_STATUSLINE_OPENCODE_DB ??
    join(resolveOpenCodeDataDir(), "opencode.db")
  );
}

function escapeSqlString(value: string): string {
  return value.replace(/'/g, "''");
}

function readDoneTokensFromOpenCodeDb(
  sessionID: string,
): ChildTokenState | undefined {
  const dbPath = resolveOpenCodeDbPath();
  if (!existsSync(dbPath)) return undefined;

  // Keep JSON parsing in TypeScript instead of relying on sqlite JSON functions.
  // Some sqlite3 builds, especially on WSL/Linux distributions, are compiled
  // without JSON support and fail with `no such function json_extract`.
  const output = safeRead(() =>
    execFileSync(
      "sqlite3",
      [
        dbPath,
        `select data from message where session_id='${escapeSqlString(sessionID)}' order by time_created desc limit 50;`,
      ],
      { encoding: "utf8", timeout: 1000, maxBuffer: 1024 * 1024 },
    ),
  );
  if (!output) return undefined;

  let tokens: ChildTokenState | undefined;
  for (const line of output.split("\n")) {
    const hydrated = tokenStateFromMessageData(line.trim());
    tokens = mergeTokenState(tokens, hydrated);
    if (hasTokenTotal(tokens)) break;
  }
  return tokens;
}

function readDoneTokensFromOpenCodeLogs(
  sessionID: string,
): ChildTokenState | undefined {
  const logDir = join(resolveOpenCodeDataDir(), "log");
  if (!existsSync(logDir)) return undefined;

  const files = safeRead(() =>
    readdirSync(logDir)
      .filter((file) => file.endsWith(".log"))
      .sort()
      .reverse()
      .slice(0, 8),
  );
  if (!files) return undefined;

  const tokenPattern = /"tokens"\s*:\s*(\{[^\n]*?\})/g;
  let tokens: ChildTokenState | undefined;
  for (const file of files) {
    const contents = safeRead(() => readFileSync(join(logDir, file), "utf8"));
    if (!contents || !contents.includes(sessionID)) continue;

    for (const line of contents.split("\n")) {
      if (!line.includes(sessionID) || !line.includes('"tokens"')) continue;
      for (const match of line.matchAll(tokenPattern)) {
        const hydrated = safeRead(
          () => JSON.parse(match[1] ?? "{}") as ChildTokenState,
        );
        tokens = mergeTokenState(tokens, hydrated);
        if (hasTokenTotal(tokens)) return tokens;
      }
    }
  }
  return tokens;
}

function rehydrateDoneChildTokens(
  child: ChildSessionState,
): ChildTokenState | undefined {
  if (child.status !== "done") return undefined;
  if (hasTokenTotal(child.tokens)) return undefined;
  if (!child.id.startsWith("ses_")) return undefined;

  const nowMs = Date.now();
  const cached = doneTokenCache.get(child.id);
  if (cached?.tokens) return cached.tokens;
  if (cached && cached.attempts >= DONE_TOKEN_REHYDRATE_MAX_ATTEMPTS) {
    return undefined;
  }
  if (cached && nowMs - cached.checkedAtMs < DONE_TOKEN_REHYDRATE_THROTTLE_MS) {
    return undefined;
  }

  const tokens =
    readDoneTokensFromOpenCodeDb(child.id) ??
    readDoneTokensFromOpenCodeLogs(child.id);
  doneTokenCache.set(child.id, {
    attempts: (cached?.attempts ?? 0) + 1,
    checkedAtMs: nowMs,
    tokens,
  });

  if (tokens) {
    debugLog({
      kind: "state.tokens.rehydrated.done",
      id: child.id,
      title: child.title,
      tokens,
    });
  }

  return tokens;
}

function safeRead<Value>(read: () => Value): Value | undefined {
  try {
    return read();
  } catch {
    return undefined;
  }
}

function messageIDOf(message: unknown): string | undefined {
  const record = asRecord(message);
  if (!record) return undefined;
  const id = record.id ?? record.messageID ?? record.messageId;
  return typeof id === "string" && id.length > 0 ? id : undefined;
}

function pushSessionCandidates(
  api: TuiPluginApi,
  sessionID: string | undefined,
  candidates: unknown[],
): void {
  if (!sessionID) return;

  const status = safeRead(() => api.state.session.status(sessionID));
  if (status) candidates.push(status);

  const messages = safeRead(() => api.state.session.messages(sessionID));
  if (!messages) return;

  candidates.push(messages);
  for (const message of messages) {
    const messageID = messageIDOf(message);
    if (!messageID) continue;
    const parts = safeRead(() => api.state.part(messageID));
    if (parts) candidates.push(parts);
  }
}

function hydrateChildTokensFromTuiState(
  api: TuiPluginApi,
  child: ChildSessionState,
): ChildTokenState | undefined {
  const candidates: unknown[] = [];

  pushSessionCandidates(api, child.id, candidates);

  if (child.messageID) {
    const parentParts = safeRead(() =>
      api.state.part(child.messageID as string),
    );
    if (parentParts) candidates.push(parentParts);

    const parentMessages = safeRead(() =>
      api.state.session.messages(child.parentID),
    );
    const parentMessage = parentMessages?.find(
      (message) => messageIDOf(message) === child.messageID,
    );
    if (parentMessage) candidates.push(parentMessage);
  }

  let tokens: ChildTokenState | undefined;
  for (const candidate of candidates) {
    tokens = mergeTokenState(
      tokens,
      extractChildDetails(
        candidate as Parameters<typeof extractChildDetails>[0],
      ).tokens,
    );
  }

  tokens = mergeTokenState(tokens, rehydrateDoneChildTokens(child));

  return tokens;
}

function hydrateStateTokensFromTuiState(
  api: TuiPluginApi,
  state: StatuslineState,
): boolean {
  let changed = false;

  for (const child of Object.values(state.children)) {
    const hydrated = hydrateChildTokensFromTuiState(api, child);
    const nextTokens = mergeTokenState(child.tokens, hydrated);
    if (!sameTokens(child.tokens, nextTokens)) {
      child.tokens = nextTokens;
      child.updatedAt = new Date().toISOString();
      changed = true;
    }
  }

  if (changed) {
    state.updatedAt = new Date().toISOString();
    debugLog({
      kind: "state.tokens.hydrated",
      children: Object.values(state.children).map((child) => ({
        id: child.id,
        title: child.title,
        tokens: child.tokens,
      })),
    });
  }

  return changed;
}

function persistStateSnapshot(
  statePath: string,
  textPath: string,
  state: StatuslineState,
): void {
  const snapshot = cloneState(state);
  void (async () => {
    try {
      await saveState(statePath, snapshot);
      await writeFile(textPath, renderStatusLine(snapshot), "utf8");
    } catch {
      // Persistence is best-effort; TUI rendering must not fail because of files.
    }
  })();
}

function refreshLiveState(state: StatuslineState): boolean {
  const beforeChildIDs = new Set(Object.keys(state.children));
  refreshDerivedFields(state);

  if (Object.keys(state.children).length !== beforeChildIDs.size) {
    return true;
  }

  for (const childID of beforeChildIDs) {
    if (!state.children[childID]) return true;
  }

  return false;
}

function elapsedMs(child: ChildSessionState, nowMs: number): number {
  if (child.status !== "running") {
    return child.elapsedMs ?? 0;
  }
  const started = Date.parse(child.startedAt);
  if (Number.isNaN(started)) return child.elapsedMs ?? 0;
  return Math.max(0, nowMs - started);
}

function taskStatusMarker(status: ChildSessionState["status"]): string {
  if (status === "done") return "[✓]";
  if (status === "error") return "[x]";
  return "[ ]";
}

function statusColor(
  status: ChildSessionState["status"],
  theme: TuiThemeCurrent,
): TuiThemeCurrent["warning"] {
  if (status === "done") return theme.success;
  if (status === "error") return theme.error;
  return theme.warning;
}

function isSessionTarget(value: unknown): value is string {
  return typeof value === "string" && value.startsWith("ses_");
}

function resolveChildTargetSessionID(
  child: ChildSessionState,
): string | undefined {
  if (isSessionTarget(child.targetSessionID)) {
    return child.targetSessionID;
  }
  if (child.id.startsWith("ses_")) {
    return child.id;
  }
  return undefined;
}

function resolveSyntheticTargetFromHydratedState(
  state: StatuslineState,
  synthetic: ChildSessionState,
): string | undefined {
  const messageMatches = Object.values(state.children).filter(
    (candidate) =>
      candidate.id.startsWith("ses_") &&
      candidate.parentID === synthetic.parentID &&
      synthetic.messageID &&
      candidate.messageID === synthetic.messageID,
  );
  if (messageMatches.length === 1) return messageMatches[0].id;

  const parentMatches = Object.values(state.children).filter(
    (candidate) =>
      candidate.id.startsWith("ses_") &&
      candidate.parentID === synthetic.parentID,
  );
  if (parentMatches.length === 1) return parentMatches[0].id;

  return undefined;
}

function backfillHydratedTargetSessionIDs(
  state: StatuslineState,
  parentSessionID: string,
): boolean {
  let changed = false;

  for (const child of Object.values(state.children)) {
    if (child.parentID !== parentSessionID) continue;
    if (resolveChildTargetSessionID(child)) continue;
    if (child.source === "session" || child.id.startsWith("ses_")) {
      child.targetSessionID = child.id;
      changed = true;
      continue;
    }

    const syntheticTarget = resolveSyntheticTargetFromHydratedState(
      state,
      child,
    );
    if (syntheticTarget) {
      child.targetSessionID = syntheticTarget;
      changed = true;
    }
  }

  if (changed) {
    state.updatedAt = new Date().toISOString();
  }

  return changed;
}

function navigateToSessionTarget(
  api: TuiPluginApi,
  targetSessionID: string | undefined,
): void {
  if (!isSessionTarget(targetSessionID)) return;

  // Verified against local typings in `@opencode-ai/plugin/dist/tui.d.ts`:
  // api.route.navigate(name: string, params?: Record<string, unknown>)
  api.route.navigate("session", { sessionID: targetSessionID });
}

function toFinitePositiveInt(value: unknown): number | undefined {
  if (typeof value !== "number" || !Number.isFinite(value)) return undefined;
  const rounded = Math.floor(value);
  return rounded > 0 ? rounded : undefined;
}

function parseStaleRunningThresholdMs(): number {
  const raw = process.env.OPENCODE_SUBAGENT_STATUSLINE_STALE_RUNNING_MS;
  if (typeof raw !== "string" || raw.trim().length === 0) {
    return DEFAULT_STALE_RUNNING_THRESHOLD_MS;
  }

  const parsed = Number(raw);
  if (!Number.isFinite(parsed) || parsed < 0) {
    return DEFAULT_STALE_RUNNING_THRESHOLD_MS;
  }

  return Math.floor(parsed);
}

const STALE_RUNNING_THRESHOLD_MS = parseStaleRunningThresholdMs();

function resolveSidebarWidth(ctx: unknown): number | undefined {
  const source = asRecord(ctx);
  if (!source) return undefined;

  const direct =
    toFinitePositiveInt(source.width) ??
    toFinitePositiveInt(source.columns) ??
    toFinitePositiveInt(source.cols);
  if (direct) return direct;

  const size = asRecord(source.size);
  const viewport = asRecord(source.viewport);
  const bounds = asRecord(source.bounds);

  return (
    toFinitePositiveInt(size?.width) ??
    toFinitePositiveInt(viewport?.width) ??
    toFinitePositiveInt(bounds?.width)
  );
}

function ellipsize(value: string, maxChars: number): string {
  if (maxChars <= 0) return "";
  if (value.length <= maxChars) return value;
  if (maxChars <= 1) return "…";
  return `${value.slice(0, Math.max(0, maxChars - 1))}…`;
}

function splitParentheticalTitle(title: string): {
  label: string;
  parenthetical?: string;
} {
  const match = title.match(/^(.*?)\s*(\([^)]*\))\s*$/);
  if (!match) return { label: title };

  const label = match[1]?.trim();
  const parenthetical = match[2]?.trim();
  if (!label || !parenthetical) return { label: title };

  return { label, parenthetical };
}

function childParenthetical(child: ChildSessionState): string | undefined {
  if (child.agentName?.trim()) return `(${child.agentName.trim()})`;

  const primary = splitParentheticalTitle(childPrimaryText(child));
  if (primary.parenthetical) return primary.parenthetical;

  return splitParentheticalTitle(child.title).parenthetical;
}

function formatSecondaryLine(
  continuation: string | undefined,
  parenthetical: string | undefined,
  width: number,
): string | undefined {
  if (!continuation) return parenthetical;
  if (!parenthetical) return continuation;

  const parentheticalWidth = Math.min(parenthetical.length, width);
  const continuationWidth = width - parentheticalWidth - 1;
  if (continuationWidth >= MIN_LABEL_WIDTH) {
    return `${ellipsize(continuation, continuationWidth)} ${ellipsize(parenthetical, parentheticalWidth)}`;
  }

  return ellipsize(parenthetical, width);
}

function childPrimaryText(child: ChildSessionState): string {
  return child.summary?.trim() || child.title;
}

function resolveTokenTotal(child: ChildSessionState): number | undefined {
  const total = child.tokens?.total;
  if (typeof total === "number" && Number.isFinite(total)) {
    return total;
  }
  const input = child.tokens?.input;
  const output = child.tokens?.output;
  if (typeof input === "number" || typeof output === "number") {
    return Math.max(0, (input ?? 0) + (output ?? 0));
  }
  return undefined;
}

function formatCompactTokenCount(total: number): string {
  const value = Math.max(0, total);
  if (value >= 1_000_000) return `${(value / 1_000_000).toFixed(1)}M ctx`;
  if (value >= 1_000) return `${(value / 1_000).toFixed(1)}k ctx`;
  return `${Math.round(value)} ctx`;
}

function formatCompactPercent(percent: number): string {
  return `${Math.max(0, Math.round(percent))}%`;
}

function contextVariants(child: ChildSessionState): string[] {
  const total = resolveTokenTotal(child);
  const percent = child.tokens?.contextPercent;
  const hasTotal = typeof total === "number" && Number.isFinite(total);
  const hasPercent = typeof percent === "number" && Number.isFinite(percent);

  if (!hasTotal && !hasPercent) return [""];

  const tokenPart = hasTotal ? formatCompactTokenCount(total) : "";
  const percentPart = hasPercent ? formatCompactPercent(percent) : "";

  if (tokenPart && percentPart) {
    return [`${tokenPart} ${percentPart}`, percentPart, tokenPart, ""];
  }

  return [tokenPart || percentPart, ""];
}

function rowWidthBudget(sidebarWidth: number | undefined): number {
  const width = sidebarWidth ?? FALLBACK_SIDEBAR_WIDTH;
  const innerWidth = width - 4;
  return Math.max(MIN_ROW_WIDTH, Math.min(innerWidth, 52));
}

function wrapCompactText(
  value: string,
  width: number,
  maxLines: number,
): string[] {
  const normalized = value.replace(/\s+/g, " ").trim();
  if (!normalized) return [""];

  const lines: string[] = [];
  let remaining = normalized;

  while (remaining.length > width && lines.length < maxLines - 1) {
    const slice = remaining.slice(0, width + 1);
    const breakAt = slice.lastIndexOf(" ");
    const take = breakAt >= MIN_LABEL_WIDTH ? breakAt : width;
    lines.push(remaining.slice(0, take).trimEnd());
    remaining = remaining.slice(take).trimStart();
  }

  lines.push(
    lines.length === maxLines - 1
      ? ellipsize(remaining, Math.max(1, width))
      : remaining,
  );
  return lines;
}

function formatChildRowLine(input: {
  child: ChildSessionState;
  nowMs: number;
  sidebarWidth?: number;
  reservedWidth?: number;
}): {
  labelLines: string[];
  secondaryLine?: string;
  elapsed: string;
  meta: string;
} {
  const elapsed = formatDuration(elapsedMs(input.child, input.nowMs));
  const width = Math.max(
    MIN_ROW_WIDTH,
    rowWidthBudget(input.sidebarWidth) - (input.reservedWidth ?? 0),
  );
  const title = splitParentheticalTitle(childPrimaryText(input.child));
  const parenthetical = childParenthetical(input.child);

  for (const meta of contextVariants(input.child)) {
    const detailChars = 2 + elapsed.length + (meta ? 3 + meta.length : 0);
    const labelBudget = Math.min(
      width - 2,
      width - Math.max(0, detailChars - width),
    );
    if (labelBudget >= MIN_LABEL_WIDTH || meta.length === 0) {
      const labelLines = wrapCompactText(title.label, Math.max(1, labelBudget), 2);
      return {
        labelLines,
        secondaryLine: formatSecondaryLine(
          labelLines[1],
          parenthetical,
          Math.max(1, labelBudget),
        ),
        elapsed,
        meta,
      };
    }
  }

  const labelLines = wrapCompactText(title.label, MIN_LABEL_WIDTH, 2);
  return {
    labelLines,
    secondaryLine: formatSecondaryLine(labelLines[1], parenthetical, MIN_LABEL_WIDTH),
    elapsed,
    meta: "",
  };
}

function formatTerminalChildRowLine(input: {
  child: ChildSessionState;
  nowMs: number;
  sidebarWidth?: number;
  reservedWidth?: number;
}): {
  label: string;
  meta: string;
} {
  const elapsed = formatDuration(elapsedMs(input.child, input.nowMs));
  const width = Math.max(MIN_ROW_WIDTH, rowWidthBudget(input.sidebarWidth));
  const title = splitParentheticalTitle(childPrimaryText(input.child));
  const parenthetical = childParenthetical(input.child);
  const labelSource = parenthetical
    ? `${title.label} ${parenthetical}`
    : title.label;
  const context = contextVariants(input.child).find((variant) => variant.length > 0);

  return {
    label: ellipsize(labelSource, Math.max(1, width - (input.reservedWidth ?? 0))),
    meta: context
      ? `${elapsed} ${context}`
      : elapsed,
  };
}

function subagentRowHeight(child: ChildSessionState): number {
  return child.status === "running"
    ? SUBAGENTS_RUNNING_ROW_HEIGHT
    : SUBAGENTS_TERMINAL_ROW_HEIGHT;
}

function SidebarSubagents(props: {
  api: TuiPluginApi;
  sessionID: string;
  state: () => StatuslineState;
  nowMs: () => number;
  expanded: () => boolean;
  onToggleExpanded: () => void;
  onSetExpanded: (expanded: boolean) => void;
  onReturnFocus: () => void;
  onToggleListFocus: () => void;
  onNavigateToChild: (input: {
    parentSessionID: string;
    childSessionID: string;
    childRowID: string;
  }) => void;
  sidebarWidth?: () => number | undefined;
  theme: TuiThemeCurrent;
}) {
  const children = createMemo(() =>
    visibleSubagentWorkItems(
      Object.values(props.state().children).filter(
        (child) => child.parentID === props.sessionID,
      ),
      props.nowMs(),
    ).sort(byPriority),
  );

  const otherChildren = createMemo(() =>
    visibleSubagentWorkItems(
      Object.values(props.state().children).filter(
        (child) => child.parentID !== props.sessionID,
      ),
      props.nowMs(),
    ).sort(byPriority),
  );

  const counts = createMemo(() => {
    const result = { running: 0, done: 0, error: 0 };
    for (const child of children()) {
      if (child.status === "running") result.running += 1;
      if (child.status === "done") result.done += 1;
      if (child.status === "error") result.error += 1;
    }
    return result;
  });
  const totalExecuted = createMemo(() => props.state().totalExecuted ?? 0);

  const visibleChildren = createMemo(() => {
    const ownChildren = children();
    if (ownChildren.length > 0) return ownChildren;
    return otherChildren();
  });

  const showingOtherSessions = createMemo(
    () => children().length === 0 && otherChildren().length > 0,
  );

  const visibleChildIDs = createMemo(() =>
    visibleChildren().map((child) => child.id),
  );
  const [selectedChildID, setSelectedChildID] = createSignal<string | undefined>();
  const [listFocused, setListFocused] = createSignal(false);
  const [listFocusModeActive, setListFocusModeActive] = createSignal(false);

  const visibleChildLayoutSignature = createMemo(() =>
    visibleChildren()
      .map((child) =>
        JSON.stringify([
          child.id,
          child.status,
          child.title,
          child.summary ?? "",
          child.agentName ?? "",
          child.tokens?.input ?? "",
          child.tokens?.output ?? "",
          child.tokens?.total ?? "",
          child.tokens?.contextPercent ?? "",
        ]),
      )
      .join("|"),
  );

  const listHeight = createMemo(() => {
    const contentHeight =
      visibleChildren().reduce(
        (height, child) => height + subagentRowHeight(child),
        showingOtherSessions() ? 1 : 0,
      ) +
      Math.max(0, visibleChildren().length - 1) * SUBAGENTS_ROW_GAP;

    return Math.max(1, Math.min(SUBAGENTS_MAX_LIST_HEIGHT, contentHeight));
  });

  let listContainer: BoxRenderable | undefined;
  let scrollbox: ScrollBoxRenderable | undefined;
  let restoreScrollTimeout: ReturnType<typeof setTimeout> | undefined;
  const scrollRegistration: SidebarScrollRegistration = {
    getScrollbox: () => scrollbox,
    offsetTop: 0,
  };
  sidebarScrollRegistrations.add(scrollRegistration);
  const focusRegistration: SidebarListFocusRegistration = {
    focusList: (preferredChildID?: string) => {
      if (!listContainer) return false;
      const ids = visibleChildIDs();
      if (preferredChildID && ids.includes(preferredChildID)) {
        setSelectedChildID(preferredChildID);
      } else if (!selectedChildID() && ids[0]) {
        setSelectedChildID(ids[0]);
      }
      listContainer.focus();
      setListFocused(true);
      setListFocusModeActive(true);
      return true;
    },
    blurList: () => {
      if (!listFocused() && !listFocusModeActive()) return false;
      listContainer?.blur();
      setListFocused(false);
      setListFocusModeActive(false);
      return true;
    },
    isListFocusModeActive: () => listFocusModeActive(),
  };
  sidebarListFocusRegistrations.add(focusRegistration);
  onCleanup(() => {
    sidebarScrollRegistrations.delete(scrollRegistration);
    sidebarListFocusRegistrations.delete(focusRegistration);
    if (restoreScrollTimeout) clearTimeout(restoreScrollTimeout);
  });

  createEffect(() => {
    const ids = visibleChildIDs();
    const current = selectedChildID();
    if (ids.length === 0) {
      if (current) setSelectedChildID(undefined);
      return;
    }
    if (!current || !ids.includes(current)) setSelectedChildID(ids[0]);
  });

  const refreshListFocused = (): void => {
    if (listFocused() && !listContainer) {
      setListFocused(false);
      return;
    }
    const focused = Boolean(
      listContainer?.focused || listContainer?.hasFocusedDescendant,
    );
    if (!focused && listFocused()) setListFocused(false);
  };

  const rowTopForIndex = (index: number): number => {
    let top = showingOtherSessions() ? 1 : 0;
    for (let i = 0; i < index; i += 1) {
      const child = visibleChildren()[i];
      if (child) top += subagentRowHeight(child) + SUBAGENTS_ROW_GAP;
    }
    return top;
  };

  const scrollSelectedChildIntoView = (): void => {
    if (!scrollbox) return;
    const selectedIndex = visibleChildIDs().findIndex(
      (id) => id === selectedChildID(),
    );
    if (selectedIndex < 0) return;
    const selectedChild = visibleChildren()[selectedIndex];
    if (!selectedChild) return;

    const rowTop = rowTopForIndex(selectedIndex);
    const rowBottom = rowTop + subagentRowHeight(selectedChild);
    const viewportTop = scrollbox.scrollTop;
    const viewportBottom = viewportTop + listHeight();

    if (rowTop < viewportTop) {
      scrollbox.scrollTop = clampedScrollTop(scrollbox, rowTop);
    } else if (rowBottom > viewportBottom) {
      scrollbox.scrollTop = clampedScrollTop(scrollbox, rowBottom - listHeight());
    }
  };

  const moveSelection = (delta: number): void => {
    const ids = visibleChildIDs();
    if (ids.length === 0) return;
    const currentIndex = ids.findIndex((id) => id === selectedChildID());
    const fallbackIndex = delta > 0 ? 0 : ids.length - 1;
    const nextIndex = Math.max(
      0,
      Math.min(ids.length - 1, currentIndex < 0 ? fallbackIndex : currentIndex + delta),
    );
    setSelectedChildID(ids[nextIndex]);
  };

  const rowActivations = new Map<string, () => void>();

  const resolveNavigableChildTargetSessionID = (
    child: ChildSessionState,
  ): string | undefined =>
    resolveChildTargetSessionID(child) ??
    resolveSyntheticTargetFromHydratedState(props.state(), child);

  const selectedTargetSessionID = (): string | undefined => {
    const selected = visibleChildren().find(
      (child) => child.id === selectedChildID(),
    );
    return selected ? resolveNavigableChildTargetSessionID(selected) : undefined;
  };

  const activateSelectedChild = (): void => {
    const selectedID = selectedChildID();
    const activateRow = selectedID ? rowActivations.get(selectedID) : undefined;
    if (activateRow) {
      activateRow();
      return;
    }
    navigateToSessionTarget(props.api, selectedTargetSessionID());
  };

  createEffect(() => {
    selectedChildID();
    listHeight();
    scrollSelectedChildIntoView();
  });

  const handleListKeyDown = (event: KeyEvent): void => {
    if (!listFocused()) return;
    const name = event.name.toLowerCase();
    if ((event.meta || event.option) && name === "b") {
      props.onToggleListFocus();
    } else if (name === "j" || name === "down" || name === "arrowdown") {
      moveSelection(1);
    } else if (name === "k" || name === "up" || name === "arrowup") {
      moveSelection(-1);
    } else if (name === "return" || name === "enter") {
      activateSelectedChild();
    } else if (name === "h" || name === "left" || name === "arrowleft") {
      if (props.expanded()) props.onSetExpanded(false);
    } else if (name === "l" || name === "right" || name === "arrowright") {
      if (!props.expanded()) props.onSetExpanded(true);
    } else if (name === "escape" || name === "esc") {
      focusRegistration.blurList();
      props.onReturnFocus();
    } else {
      return;
    }

    event.preventDefault();
    event.stopPropagation();
  };

  useKeyboard(handleListKeyDown);

  createEffect(() => {
    props.expanded();
    visibleChildIDs().join("|");
    visibleChildLayoutSignature();
    showingOtherSessions();
    props.sidebarWidth?.();

    if (restoreScrollTimeout) clearTimeout(restoreScrollTimeout);
    restoreScrollTimeout = setTimeout(() => {
      if (!props.expanded() || !scrollbox) return;
      const top = clampedScrollTop(scrollbox, scrollRegistration.offsetTop);
      if (top > 0 && scrollbox.scrollTop !== top) {
        scrollbox.scrollTop = top;
      }
    }, 0);
  });

  const ChildRow = (rowProps: { childID: string }) => {
    const child = createMemo(() =>
      visibleChildren().find((candidate) => candidate.id === rowProps.childID),
    );
    const [hovered, setHovered] = createSignal(false);
    const [focused, setFocused] = createSignal(false);
    const targetSessionID = createMemo(() => {
      const currentChild = child();
      return currentChild
        ? resolveNavigableChildTargetSessionID(currentChild)
        : undefined;
    });
    const clickable = createMemo(() => isSessionTarget(targetSessionID()));
    const selected = createMemo(
      () => listFocused() && selectedChildID() === rowProps.childID,
    );
    const emphasized = createMemo(
      () => clickable() && (hovered() || focused() || selected()),
    );
    const status = createMemo<ChildSessionState["status"]>(
      () => child()?.status ?? "running",
    );
    const muted = createMemo(
      () => status() !== "running" && clickable() && !emphasized(),
    );
    const rowOpacity = createMemo(() =>
      status() === "running" ? 1 : INACTIVE_SUBAGENT_OPACITY,
    );
    const markerWidth = 4;
    const line = createMemo(() => {
      const currentChild = child();
      if (!currentChild) {
        return { labelLines: [""], elapsed: "00:00", meta: "" };
      }
      return formatChildRowLine({
        child: currentChild,
        nowMs: props.nowMs(),
        sidebarWidth: props.sidebarWidth?.(),
        reservedWidth: markerWidth,
      });
    });
    const terminalLine = createMemo(() => {
      const currentChild = child();
      if (!currentChild) return { label: "", meta: "00:00" };
      return formatTerminalChildRowLine({
        child: currentChild,
        nowMs: props.nowMs(),
        sidebarWidth: props.sidebarWidth?.(),
        reservedWidth: markerWidth,
      });
    });
    const hasSecondaryLine = createMemo(() => Boolean(line().secondaryLine));
    const rowHeight = createMemo(() => {
      if (status() !== "running") return SUBAGENTS_TERMINAL_ROW_HEIGHT;
      return hasSecondaryLine()
        ? SUBAGENTS_RUNNING_ROW_HEIGHT
        : SUBAGENTS_RUNNING_ROW_HEIGHT - 1;
    });
    const activate = () => {
      const target = targetSessionID();
      if (target) {
        props.onNavigateToChild({
          parentSessionID: props.sessionID,
          childSessionID: target,
          childRowID: rowProps.childID,
        });
      }
      navigateToSessionTarget(props.api, target);
    };
    rowActivations.set(rowProps.childID, activate);
    onCleanup(() => {
      rowActivations.delete(rowProps.childID);
    });
    const handleKeyDown = (event: KeyEvent): void => {
      if (!clickable()) return;
      setFocused(true);
      if (event.name === "return" || event.name === "space") {
        activate();
        event.preventDefault();
        event.stopPropagation();
      }
    };

    return (
      <box
        flexDirection="column"
        height={rowHeight()}
        opacity={rowOpacity()}
        backgroundColor={selected() ? props.theme.backgroundElement : undefined}
        onMouseOver={clickable() ? () => setHovered(true) : undefined}
        onMouseOut={
          clickable()
            ? () => {
                setHovered(false);
                setFocused(false);
              }
            : undefined
        }
        onMouseDown={
          clickable()
            ? () => {
                setSelectedChildID(rowProps.childID);
                activate();
              }
            : undefined
        }
        onKeyDown={clickable() ? handleKeyDown : undefined}
        focusable={clickable()}
        focused={clickable() && focused()}
      >
        <Show
          when={status() === "running"}
          fallback={
            <box flexDirection="column">
              <box flexDirection="row">
                <text fg={selected() ? props.theme.accent : props.theme.textMuted}>
                  {selected() ? "›" : " "}
                </text>
                <text fg={statusColor(status(), props.theme)}>
                  {taskStatusMarker(status())}
                </text>
                <text
                  fg={
                    selected()
                      ? props.theme.text
                      : muted()
                        ? props.theme.textMuted
                        : props.theme.text
                  }
                >{` ${terminalLine().label}`}</text>
              </box>
              <text
                fg={emphasized() ? props.theme.text : props.theme.textMuted}
              >{`    ↳ ${CLOCK_ICON} ${terminalLine().meta}`}</text>
            </box>
          }
        >
          <box flexDirection="column">
            <box flexDirection="row">
              <text fg={selected() ? props.theme.accent : props.theme.textMuted}>
                {selected() ? "›" : " "}
              </text>
              <text fg={statusColor(status(), props.theme)}>
                {taskStatusMarker(status())}
              </text>
              <text
                fg={
                  selected()
                    ? props.theme.text
                    : muted()
                      ? props.theme.textMuted
                      : props.theme.text
                }
              >{` ${line().labelLines[0] ?? ""}`}</text>
            </box>
            <Show when={line().secondaryLine}>
              {(secondaryLine: Accessor<string>) => (
                <text
                  fg={muted() ? props.theme.textMuted : props.theme.text}
                >{`    ${secondaryLine()}`}</text>
              )}
            </Show>
            <box flexDirection="row" paddingLeft={4}>
              <text
                fg={emphasized() ? props.theme.text : props.theme.textMuted}
              >{`↳ ${CLOCK_ICON} ${line().elapsed}`}</text>
              <Show when={line().meta.length > 0}>
                <text
                  fg={emphasized() ? props.theme.text : props.theme.textMuted}
                >{` ${TOKEN_ICON} ${line().meta}`}</text>
              </Show>
            </box>
          </box>
        </Show>
      </box>
    );
  };

  const AggregateBar = () => (
    <box flexDirection="row" paddingRight={1}>
      <text fg={props.theme.warning}>{`● ${counts().running} run`}</text>
      <text fg={props.theme.textMuted}> · </text>
      <text fg={props.theme.success}>{`✓ ${counts().done} done`}</text>
      <text fg={props.theme.textMuted}> · </text>
      <text fg={props.theme.error}>{`✕ ${counts().error} err`}</text>
      <text fg={props.theme.textMuted}> · </text>
      <text fg={props.theme.text}>{`Σ ${totalExecuted()}`}</text>
    </box>
  );

  return (
    <box
      ref={(element) => {
        listContainer = element;
        if (!element) setListFocused(false);
      }}
      flexDirection="column"
      backgroundColor={listFocused() ? props.theme.backgroundPanel : undefined}
      focusable
      focused={listFocused()}
      renderBefore={refreshListFocused}
    >
      <box flexDirection="row">
        <text
          fg={props.theme.text}
          selectable={false}
          onMouseDown={props.onToggleExpanded}
        >{`${props.expanded() ? SIDEBAR_ARROW_EXPANDED : SIDEBAR_ARROW_COLLAPSED} Subagentes`}</text>
        <Show when={PLUGIN_VERSION}>
          {(version: Accessor<string>) => (
            <text
              fg={props.theme.textMuted}
              opacity={SIDEBAR_VERSION_OPACITY}
              selectable={false}
              onMouseDown={props.onToggleExpanded}
            >{` ${version()}`}</text>
          )}
        </Show>
      </box>
      <AggregateBar />

      <Show when={props.expanded()}>
        <scrollbox
          ref={(element) => {
            scrollbox = element;
          }}
          height={listHeight()}
          scrollY
          viewportCulling={false}
        >
          <box flexDirection="column" rowGap={SUBAGENTS_ROW_GAP}>
            <Show when={showingOtherSessions()}>
              <text fg={props.theme.textMuted}>Other sessions</text>
            </Show>
            <For each={visibleChildIDs()}>
              {(childID: string) => <ChildRow childID={childID} />}
            </For>
          </box>
        </scrollbox>
      </Show>
    </box>
  );
}

function HomeBottomStatus(props: {
  state: () => StatuslineState;
  theme: TuiThemeCurrent;
}) {
  const counts = createMemo(() => {
    const result = { running: 0, done: 0, error: 0 };
    for (const child of visibleSubagentWorkItems(Object.values(props.state().children))) {
      if (child.status === "running") result.running += 1;
      if (child.status === "done") result.done += 1;
      if (child.status === "error") result.error += 1;
    }
    return result;
  });
  const totalExecuted = createMemo(() => props.state().totalExecuted ?? 0);
  const visible = createMemo(
    () => counts().running > 0 || counts().error > 0 || totalExecuted() > 0,
  );

  return (
    <Show when={visible()}>
      <box paddingLeft={1} paddingRight={1}>
        <box flexDirection="row">
          <text fg={props.theme.warning}>{`● ${counts().running}`}</text>
          <text fg={props.theme.textMuted}> · </text>
          <text fg={props.theme.success}>{`✓ ${counts().done}`}</text>
          <text fg={props.theme.textMuted}> · </text>
          <text fg={props.theme.error}>{`✕ ${counts().error}`}</text>
          <text fg={props.theme.textMuted}> · </text>
          <text fg={props.theme.text}>{`Σ ${totalExecuted()}`}</text>
        </box>
      </box>
    </Show>
  );
}

async function hydratePreviousSubagents(
  api: TuiPluginApi,
  currentSessionID: string,
  statePath: string,
  textPath: string,
  setState: (fn: (prev: StatuslineState) => StatuslineState) => void,
): Promise<boolean> {
  if (!currentSessionID) return false;

  try {
    const directory = api.state.path.directory;
    const sessionClient = api.client.session;
    let topLevelHydrationFailed = false;
    let statusHydrationFailed = false;

    const [childrenResp, messagesResp, statusResp] = await Promise.all([
      (async () => {
        const response = await safeReadAsync(
          () =>
            sessionClient?.children?.({
              sessionID: currentSessionID,
              directory,
            }) ?? Promise.resolve({ data: [] }),
        );
        if (!response) topLevelHydrationFailed = true;
        return response;
      })(),
      (async () => {
        const response = await safeReadAsync(
          () =>
            sessionClient?.messages?.({
              sessionID: currentSessionID,
              directory,
            }) ?? Promise.resolve({ data: [] }),
        );
        if (!response) topLevelHydrationFailed = true;
        return response;
      })(),
      (async () => {
        const response = await safeReadAsync(
          () =>
            sessionClient?.status?.({ directory }) ??
            Promise.resolve({ data: {} }),
        );
        if (!response) {
          topLevelHydrationFailed = true;
          statusHydrationFailed = true;
        }
        return response;
      })(),
    ]);

    const children = Array.isArray(childrenResp?.data) ? childrenResp.data : [];
    const messages = Array.isArray(messagesResp?.data) ? messagesResp.data : [];
    const allStatuses = asRecord(statusResp?.data) ?? {};
    let childHydrationFailed = false;
    const childMessageResults = await Promise.all(
      children.map(async (child) => {
        const session = asRecord(child);
        const childID =
          typeof session?.id === "string" ? session.id : undefined;
        if (!childID) {
          return {
            childID: undefined,
            completedAt: undefined,
            evidenceAt: undefined,
            hasError: false,
            fetchFailed: false,
          };
        }
        const childMessagesResp = await safeReadAsync(
          () =>
            sessionClient?.messages?.({ sessionID: childID, directory }) ??
            Promise.resolve({ data: [] }),
        );
        let fetchFailed = false;
        if (!childMessagesResp) {
          childHydrationFailed = true;
          fetchFailed = true;
        }
        const childMessages = Array.isArray(childMessagesResp?.data)
          ? childMessagesResp.data
          : [];
        return {
          childID,
          ...summarizeSessionMessages(childMessages),
          fetchFailed,
        };
      }),
    );
    const childMessageSummaryByID = new Map(
      childMessageResults
        .filter((result) => result.childID)
        .map((result) => [result.childID as string, result]),
    );

    snapshotSidebarScrollOffsets();
    setState((current) => {
      const next = cloneState(current);
      let changed = false;

      for (const rawSession of children) {
        const session = asRecord(rawSession);
        if (!session || typeof session.id !== "string") continue;
        const fakeEvent = {
          type: "session.created",
          properties: {
            sessionID: session.id,
            info: session,
          },
        };
        if (applySubagentEvent(next, fakeEvent)) changed = true;

        const status = asRecord(allStatuses[session.id]);
        const sessionStatus = deriveSessionChildStatus(status);
        const childSummary = childMessageSummaryByID.get(session.id);
        const explicitCompletionEvidence =
          !!childSummary &&
          !childSummary.fetchFailed &&
          (typeof childSummary.completedAt === "string" ||
            childSummary.hasError);
        const fallbackEndedAt =
          childSummary?.completedAt ?? childSummary?.evidenceAt;
        const statusEndedAt =
          fallbackEndedAt ??
          sessionTimestamp(session, "completed") ??
          sessionTimestamp(session, "updated");

        if (sessionStatus === "done" || sessionStatus === "error") {
          if (markChildStatus(next, session.id, sessionStatus, statusEndedAt))
            changed = true;
          continue;
        }

        if (
          !sessionStatus &&
          !statusHydrationFailed &&
          explicitCompletionEvidence
        ) {
          const childStatus = childSummary?.hasError ? "error" : "done";
          if (markChildStatus(next, session.id, childStatus, fallbackEndedAt))
            changed = true;
        }
      }

      for (const rawMessage of messages) {
        const message = asRecord(rawMessage);
        const info = asRecord(message?.info);
        const parts = Array.isArray(message?.parts) ? message.parts : [];
        const parentMessageID = messageIDOf(message);
        const isAssistant = info?.role === "assistant";
        const time = asRecord(info?.time);
        const eventInfo = time ? { time } : undefined;
        const completedAt = timestampFromUnknown(time?.completed);
        const isCompleted = typeof completedAt === "string";
        const hasError = !!info?.error;

        for (const rawPart of parts) {
          const part = asRecord(rawPart);
          if (!part) continue;
          const partWithMessageID =
            typeof part.messageID === "string" && part.messageID.length > 0
              ? part
              : parentMessageID
                ? { ...part, messageID: parentMessageID }
                : part;
          if (
            part.type === "subtask" ||
            (part.type === "tool" &&
              (part.tool === "delegate" || part.tool === "task"))
          ) {
            const fakeEvent = {
              type: "message.part.updated",
              properties: {
                sessionID: currentSessionID,
                info: eventInfo,
                part: partWithMessageID,
              },
            };
            if (applySubagentEvent(next, fakeEvent)) changed = true;

            if (part.type === "subtask" && isAssistant && isCompleted) {
              const childID = `subtask:${part.id}`;
              const status = hasError ? "error" : "done";
              if (markChildStatus(next, childID, status, completedAt))
                changed = true;
            }
          }
        }
      }

      if (backfillHydratedTargetSessionIDs(next, currentSessionID)) {
        changed = true;
      }

      const refreshed = refreshLiveState(next);
      if (!changed && !refreshed) return current;
      persistStateSnapshot(statePath, textPath, next);
      return next;
    });
    if (topLevelHydrationFailed || childHydrationFailed) return false;
    return true;
  } catch (err) {
    debugLog({
      kind: "hydration.error",
      sessionID: currentSessionID,
      error: String(err),
    });
    return false;
  }
}

async function safeReadAsync<Value>(
  read: () => Promise<Value>,
): Promise<Value | undefined> {
  try {
    return await read();
  } catch {
    return undefined;
  }
}

function normalizedSessionStatusValue(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;
  const normalized = value.trim().toLowerCase();
  return normalized.length > 0 ? normalized : undefined;
}

function deriveSessionChildStatus(
  status: Record<string, unknown> | undefined,
): ChildSessionState["status"] | undefined {
  if (!status) return undefined;

  if (status.error) return "error";

  const values = [
    normalizedSessionStatusValue(status.type),
    normalizedSessionStatusValue(status.status),
    normalizedSessionStatusValue(status.state),
    normalizedSessionStatusValue(status.phase),
    normalizedSessionStatusValue(status.result),
  ].filter((value): value is string => Boolean(value));

  if (status.busy === true || status.running === true) {
    values.push("busy");
  }

  if (
    values.some((value) =>
      [
        "error",
        "failed",
        "failure",
        "cancelled",
        "canceled",
        "aborted",
      ].includes(value),
    )
  ) {
    return "error";
  }

  if (
    values.some((value) =>
      ["busy", "running", "pending", "queued", "in_progress"].includes(value),
    )
  ) {
    return "running";
  }

  if (
    values.some((value) =>
      [
        "done",
        "completed",
        "complete",
        "success",
        "succeeded",
        "idle",
      ].includes(value),
    )
  ) {
    return "done";
  }

  return undefined;
}

function sessionTimestamp(
  session: Record<string, unknown>,
  key: string,
): string | undefined {
  const time = asRecord(session.time);
  return timestampFromUnknown(time?.[key]);
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

function resolveRouteSessionID(api: TuiPluginApi): string | undefined {
  return api.route.current.name === "session" &&
    typeof api.route.current.params?.sessionID === "string"
    ? api.route.current.params.sessionID
    : undefined;
}

function resolveRunningChildAgeMillis(child: ChildSessionState, nowMs: number): {
  startedMs: number;
  updatedMs: number;
} {
  const startedMs = Date.parse(child.startedAt);
  const updatedMs = Date.parse(child.updatedAt);
  return {
    startedMs: Number.isNaN(startedMs) ? 0 : Math.max(0, nowMs - startedMs),
    updatedMs: Number.isNaN(updatedMs) ? 0 : Math.max(0, nowMs - updatedMs),
  };
}

function resolveReconcileTargetSessionID(
  state: StatuslineState,
  child: ChildSessionState,
): string | undefined {
  return resolveChildTargetSessionID(child) ??
    resolveSyntheticTargetFromHydratedState(state, child);
}

function selectRunningReconcileCandidates(input: {
  state: StatuslineState;
  currentSessionID?: string;
  nowMs: number;
  maxCandidates: number;
}): RunningReconcileCandidate[] {
  const runningChildren = Object.values(input.state.children).filter(
    (child) => child.status === "running",
  );
  if (runningChildren.length === 0) return [];

  const prioritized = visibleSubagentWorkItems(
    runningChildren,
    input.nowMs,
  ).sort(byPriority);
  const prioritizedForSession = prioritized.filter((child) =>
    input.currentSessionID ? child.parentID === input.currentSessionID : true,
  );

  const veryOldIDs = new Set(
    runningChildren
      .filter((child) => {
        const age = resolveRunningChildAgeMillis(child, input.nowMs);
        return (
          age.startedMs >= RUNNING_RECONCILE_OLD_CANDIDATE_AGE_MS ||
          age.updatedMs >= RUNNING_RECONCILE_OLD_CANDIDATE_AGE_MS
        );
      })
      .map((child) => child.id),
  );

  const ordered = [
    ...prioritizedForSession,
    ...runningChildren.filter((child) => veryOldIDs.has(child.id)),
  ];

  const selected: RunningReconcileCandidate[] = [];
  const seen = new Set<string>();
  for (const child of ordered) {
    if (seen.has(child.id)) continue;
    seen.add(child.id);
    const targetSessionID = resolveReconcileTargetSessionID(input.state, child);
    if (!targetSessionID) continue;
    const age = resolveRunningChildAgeMillis(child, input.nowMs);
    selected.push({
      childID: child.id,
      targetSessionID,
      startedMs: age.startedMs,
      updatedMs: age.updatedMs,
    });
    if (selected.length >= input.maxCandidates) break;
  }

  return capCandidates(selected, input.maxCandidates);
}

async function probeRunningEvidence(input: {
  api: TuiPluginApi;
  targetSessionID: string;
  directory: string;
  candidateAgeMs: number;
  nowMs: number;
}): Promise<RunningReconcileEvidence> {
  let probeFailed = false;

  const directStatus = safeRead(() =>
    input.api.state.session.status(input.targetSessionID),
  );
  if (directStatus === undefined) probeFailed = true;
  const statusFromState = deriveSessionChildStatus(asRecord(directStatus));
  if (statusFromState === "done" || statusFromState === "error") {
    return { status: statusFromState, endedAt: new Date().toISOString() };
  }
  if (statusFromState === "running") {
    return { status: "running", sawRunningEvidence: true };
  }

  const statusResp = await safeReadAsync(() =>
    input.api.client.session.status({ directory: input.directory }),
  );
  if (statusResp === undefined) probeFailed = true;
  const statuses = asRecord(statusResp?.data);
  const statusFromClient = deriveSessionChildStatus(
    asRecord(statuses?.[input.targetSessionID]),
  );
  if (statusFromClient === "done" || statusFromClient === "error") {
    return { status: statusFromClient, endedAt: new Date().toISOString() };
  }
  if (statusFromClient === "running") {
    return { status: "running", sawRunningEvidence: true };
  }

  if (input.candidateAgeMs < RUNNING_RECONCILE_MESSAGE_AGE_GATE_MS) {
    return { probeFailed, canApplyStaleFallback: false };
  }

  const messagesResp = await safeReadAsync(() =>
    input.api.client.session.messages({
      sessionID: input.targetSessionID,
      directory: input.directory,
    }),
  );
  if (messagesResp === undefined || !Array.isArray(messagesResp?.data)) {
    return {
      checkedMessages: false,
      probeFailed: true,
      canApplyStaleFallback: false,
    };
  }
  const messages = Array.isArray(messagesResp?.data) ? messagesResp.data : [];
  const summary = summarizeSessionMessages(messages);

  if (summary.hasError) {
    return {
      status: "error",
      endedAt: summary.evidenceAt,
      checkedMessages: true,
      canApplyStaleFallback: false,
    };
  }

  if (typeof summary.completedAt === "string") {
    return {
      status: "done",
      endedAt: summary.completedAt,
      checkedMessages: true,
      canApplyStaleFallback: false,
    };
  }

  if (
    hasRecentMessageActivity({
      nowMs: input.nowMs,
      latestMessageActivityAtMs: summary.latestMessageActivityAtMs,
      staleThresholdMs: STALE_RUNNING_THRESHOLD_MS,
    })
  ) {
    return {
      checkedMessages: true,
      sawRunningEvidence: true,
      endedAt: summary.latestMessageActivityAt,
      probeFailed,
      canApplyStaleFallback: false,
    };
  }

  return {
    checkedMessages: true,
    probeFailed,
    canApplyStaleFallback: !probeFailed,
  };
}

const tui: TuiPlugin = async (api: TuiPluginApi) => {
  const statePath = resolveStatePath();
  const textPath = resolveTextPath(statePath);
  const [state, setState] = createSignal<StatuslineState>(createEmptyState());
  const [nowMs, setNowMs] = createSignal(Date.now());
  const [hydratedSessions, setHydratedSessions] = createSignal<Set<string>>(
    new Set(),
  );
  const [hydratingSessions, setHydratingSessions] = createSignal<Set<string>>(
    new Set(),
  );
  const [hydrateRetryPendingSessions, setHydrateRetryPendingSessions] =
    createSignal<Set<string>>(new Set());
  const [hydrateRetryAttempts, setHydrateRetryAttempts] = createSignal<
    Map<string, number>
  >(new Map());
  const [hydrateRetryTick, setHydrateRetryTick] = createSignal(0);
  const [subagentsExpanded, setSubagentsExpanded] = createSignal(
    api.kv.get<boolean>(SUBAGENTS_EXPANDED_KV_KEY, true) !== false,
  );
  const [subagentsSectionEnabled, setSubagentsSectionEnabled] = createSignal(
    api.kv.get<boolean>(SUBAGENTS_SECTION_ENABLED_KV_KEY, true) !== false,
  );
  const hydrateRetryTimeouts = new Map<string, ReturnType<typeof setTimeout>>();
  const runningReconcileBackoff = new Map<string, RunningReconcileCacheEntry>();
  let reconcileInFlight = false;
  let lastRunningReconcileAtMs = 0;
  let disposed = false;
  let previousRouteSessionID: string | undefined;
  let pendingSidebarRefocus:
    | { parentSessionID: string; childSessionID: string; childRowID: string }
    | undefined;
  let activePromptRef: TuiPromptRef | undefined;

  const setActivePromptRef = (ref: TuiPromptRef | undefined): void => {
    activePromptRef = ref;
  };

  const composePromptRef = (slotRef: PromptRefProp) => {
    return (ref: TuiPromptRef | undefined): void => {
      setActivePromptRef(ref);
      if (typeof slotRef === "function") {
        slotRef(ref);
      } else if (slotRef && "current" in slotRef) {
        slotRef.current = ref;
      }
    };
  };

  const focusActivePrompt = (): void => {
    setTimeout(() => {
      activePromptRef?.focus();
    }, 0);
  };

  const rememberSidebarChildNavigation = (input: {
    parentSessionID: string;
    childSessionID: string;
    childRowID: string;
  }): void => {
    pendingSidebarRefocus = input;
  };

  const setSubagentsExpandedPreference = (expanded: boolean): void => {
    setSubagentsExpanded(expanded);
    api.kv.set(SUBAGENTS_EXPANDED_KV_KEY, expanded);
    api.ui.toast({
      variant: "info",
      message: expanded ? "Subagent list expanded" : "Subagent list collapsed",
    });
  };

  const setSubagentsExpandedSilently = (expanded: boolean): void => {
    setSubagentsExpanded(expanded);
    api.kv.set(SUBAGENTS_EXPANDED_KV_KEY, expanded);
  };

  const setSubagentsSectionEnabledPreference = (enabled: boolean): void => {
    setSubagentsSectionEnabled(enabled);
    api.kv.set(SUBAGENTS_SECTION_ENABLED_KV_KEY, enabled);
    api.ui.toast({
      variant: "info",
      message: enabled
        ? "Subagent section enabled"
        : "Subagent section disabled",
    });
  };

  const toggleSidebarListFocus = (): void => {
    api.ui.dialog.clear();
    if (isAnySidebarSubagentListFocused()) {
      blurVisibleSidebarSubagentList();
      focusActivePrompt();
      return;
    }

    setSubagentsSectionEnabled(true);
    setSubagentsExpanded(true);
    api.kv.set(SUBAGENTS_SECTION_ENABLED_KV_KEY, true);
    api.kv.set(SUBAGENTS_EXPANDED_KV_KEY, true);
    setTimeout(() => {
      focusVisibleSidebarSubagentList();
    }, 0);
  };

  const commandDispose = api.command.register(() => [
    {
      title: subagentsSectionEnabled()
        ? "Subagents: Disable sidebar section"
        : "Subagents: Enable sidebar section",
      value: "subagent-statusline.toggle-sidebar-section",
      description: "Toggle the entire subagent sidebar section",
      category: "Subagents",
      onSelect: () =>
        setSubagentsSectionEnabledPreference(!subagentsSectionEnabled()),
    },
    {
      title: "Subagents: Focus sidebar list",
      value: "subagent-statusline.focus-sidebar-list",
      description: "Focus the subagent sidebar list for keyboard navigation",
      category: "Subagents",
      keybind: "alt+b",
      onSelect: toggleSidebarListFocus,
    },
  ]);

  const clearHydrateRetryTimeout = (sessionID: string): void => {
    const timeout = hydrateRetryTimeouts.get(sessionID);
    if (timeout) {
      clearTimeout(timeout);
      hydrateRetryTimeouts.delete(sessionID);
    }
  };

  const resetHydrateRetry = (sessionID: string | undefined): void => {
    if (!sessionID) return;
    clearHydrateRetryTimeout(sessionID);
    setHydrateRetryPendingSessions((prev) => {
      if (!prev.has(sessionID)) return prev;
      const next = new Set(prev);
      next.delete(sessionID);
      return next;
    });
    setHydrateRetryAttempts((prev) => {
      if (!prev.has(sessionID)) return prev;
      const next = new Map(prev);
      next.delete(sessionID);
      return next;
    });
  };

  createEffect(() => {
    hydrateRetryTick();
    const route = api.route.current;
    const routeSessionID = resolveRouteSessionID(api);

    if (previousRouteSessionID && previousRouteSessionID !== routeSessionID) {
      resetHydrateRetry(previousRouteSessionID);
    }

    if (pendingSidebarRefocus && previousRouteSessionID !== routeSessionID) {
      if (
        previousRouteSessionID === pendingSidebarRefocus.childSessionID &&
        routeSessionID === pendingSidebarRefocus.parentSessionID
      ) {
        const childRowID = pendingSidebarRefocus.childRowID;
        pendingSidebarRefocus = undefined;
        setTimeout(() => {
          focusVisibleSidebarSubagentList(childRowID);
        }, 0);
      } else if (routeSessionID !== pendingSidebarRefocus.childSessionID) {
        pendingSidebarRefocus = undefined;
      }
    }

    previousRouteSessionID = routeSessionID;

    if (!routeSessionID) return;

    const sessionID = routeSessionID;
    const currentAttempts = hydrateRetryAttempts().get(sessionID) ?? 0;
    if (
      currentAttempts >= HYDRATE_RETRY_MAX_ATTEMPTS ||
      hydratedSessions().has(sessionID) ||
      hydratingSessions().has(sessionID) ||
      hydrateRetryPendingSessions().has(sessionID)
    ) {
      return;
    }

    setHydratingSessions((prev) => {
      const next = new Set(prev);
      next.add(sessionID);
      return next;
    });

    void (async () => {
      const finishHydrating = (): void => {
        setHydratingSessions((prev) => {
          const next = new Set(prev);
          next.delete(sessionID);
          return next;
        });
      };

      const hydrated = await hydratePreviousSubagents(
        api,
        sessionID,
        statePath,
        textPath,
        setState,
      );
      if (disposed) {
        clearHydrateRetryTimeout(sessionID);
        finishHydrating();
        return;
      }
      if (hydrated) {
        resetHydrateRetry(sessionID);
        setHydratedSessions((prev) => {
          const next = new Set(prev);
          next.add(sessionID);
          return next;
        });
        finishHydrating();
        return;
      }

      const attempts = hydrateRetryAttempts().get(sessionID) ?? 0;
      if (attempts >= HYDRATE_RETRY_MAX_ATTEMPTS) {
        setHydrateRetryPendingSessions((prev) => {
          if (!prev.has(sessionID)) return prev;
          const next = new Set(prev);
          next.delete(sessionID);
          return next;
        });
        clearHydrateRetryTimeout(sessionID);
        finishHydrating();
        return;
      }

      const delayMs = Math.min(
        HYDRATE_RETRY_MAX_DELAY_MS,
        HYDRATE_RETRY_BASE_DELAY_MS * 2 ** attempts,
      );

      setHydrateRetryAttempts((prev) => {
        const next = new Map(prev);
        next.set(sessionID, attempts + 1);
        return next;
      });

      setHydrateRetryPendingSessions((prev) => {
        const next = new Set(prev);
        next.add(sessionID);
        return next;
      });
      finishHydrating();

      clearHydrateRetryTimeout(sessionID);
      const timeout = setTimeout(() => {
        hydrateRetryTimeouts.delete(sessionID);
        setHydrateRetryPendingSessions((prev) => {
          if (!prev.has(sessionID)) return prev;
          const next = new Set(prev);
          next.delete(sessionID);
          return next;
        });
        if (disposed) return;
        setHydrateRetryTick((value) => value + 1);
      }, delayMs);
      hydrateRetryTimeouts.set(sessionID, timeout);
    })();
  });

  const tick = setInterval(() => {
    const currentNowMs = Date.now();
    const shouldRunReconcileMaintenance =
      currentNowMs - lastRunningReconcileAtMs >=
      RUNNING_RECONCILE_MAINTENANCE_INTERVAL_MS;
    if (shouldRunReconcileMaintenance) {
      void reconcileRunningChildren();
    }

    snapshotSidebarScrollOffsets();
    setNowMs(currentNowMs);
    setState((current: StatuslineState) => {
      const next = cloneState(current);
      const hydrated = hydrateStateTokensFromTuiState(api, next);
      const refreshed = refreshLiveState(next);
      if (!hydrated && !refreshed) return current;
      persistStateSnapshot(statePath, textPath, next);
      return next;
    });
  }, ELAPSED_TICK_MS);

  const reconcileRunningChildren = async (): Promise<void> => {
    if (reconcileInFlight || disposed) return;
    reconcileInFlight = true;
    lastRunningReconcileAtMs = Date.now();

    try {
      const snapshot = cloneState(state());
      const nowMs = Date.now();
      const currentSessionID = resolveRouteSessionID(api);
      const directory = api.state.path.directory;

      const selected = selectRunningReconcileCandidates({
        state: snapshot,
        currentSessionID,
        nowMs,
        maxCandidates: RUNNING_RECONCILE_MAX_CANDIDATES,
      });

      const mutations: Array<{
        targetSessionID: string;
        status: "done" | "error";
        endedAt?: string;
      }> = [];

      for (const candidate of selected) {
        const key = candidate.targetSessionID;
        const cache = runningReconcileBackoff.get(key);
        if (shouldSkipCandidateForBackoff(cache, nowMs)) continue;

        const evidence = await probeRunningEvidence({
          api,
          targetSessionID: candidate.targetSessionID,
          directory,
          candidateAgeMs: Math.max(candidate.startedMs, candidate.updatedMs),
          nowMs,
        });

        if (evidence.status === "done" || evidence.status === "error") {
          mutations.push({
            targetSessionID: candidate.targetSessionID,
            status: evidence.status,
            endedAt: evidence.endedAt,
          });
          runningReconcileBackoff.delete(key);
          continue;
        }

        if (evidence.sawRunningEvidence) {
          runningReconcileBackoff.set(key, {
            backoffMs: RUNNING_RECONCILE_INITIAL_BACKOFF_MS,
            nextAllowedAtMs: nowMs + RUNNING_RECONCILE_INITIAL_BACKOFF_MS,
          });
          continue;
        }

        const shouldApplyFallback = shouldApplyStaleRunningFallback({
          staleThresholdMs: STALE_RUNNING_THRESHOLD_MS,
          evidence,
          startedMs: candidate.startedMs,
          updatedMs: candidate.updatedMs,
        });

        if (shouldApplyFallback) {
          mutations.push({
            targetSessionID: candidate.targetSessionID,
            status: "done",
            endedAt: new Date(nowMs - candidate.updatedMs).toISOString(),
          });
          runningReconcileBackoff.delete(key);
          continue;
        }

        runningReconcileBackoff.set(
          key,
          nextBackoffState({
            cache,
            nowMs,
            initialBackoffMs: RUNNING_RECONCILE_INITIAL_BACKOFF_MS,
            maxBackoffMs: RUNNING_RECONCILE_MAX_BACKOFF_MS,
          }),
        );
      }

      if (mutations.length === 0) return;

      snapshotSidebarScrollOffsets();
      setState((current: StatuslineState) => {
        const next = cloneState(current);
        let changed = false;

        for (const mutation of mutations) {
          if (
            markChildStatus(
              next,
              mutation.targetSessionID,
              mutation.status,
              mutation.endedAt,
            )
          ) {
            changed = true;
          }
        }

        const refreshed = refreshLiveState(next);
        if (!changed && !refreshed) return current;
        persistStateSnapshot(statePath, textPath, next);
        return next;
      });
    } finally {
      reconcileInFlight = false;
    }
  };

  const applyEvent = (event: unknown): void => {
    debugEvent(event);
    snapshotSidebarScrollOffsets();
    setState((current: StatuslineState) => {
      const next = cloneState(current);
      const changed = applySubagentEvent(next, event);
      const hydrated = hydrateStateTokensFromTuiState(api, next);
      if (changed) {
        debugLog({
          kind: "state.changed",
          children: Object.values(next.children).map((child) => ({
            id: child.id,
            parentID: child.parentID,
            title: child.title,
            status: child.status,
            source: child.source,
          })),
        });
      }
      const refreshed = refreshLiveState(next);
      if (!changed && !hydrated && !refreshed) return current;
      persistStateSnapshot(statePath, textPath, next);
      return next;
    });
  };

  const disposers = [
    api.event.on("session.created", applyEvent),
    api.event.on("session.updated", applyEvent),
    api.event.on("session.idle", applyEvent),
    api.event.on("session.error", applyEvent),
    api.event.on("message.updated", applyEvent),
    api.event.on("message.part.updated", applyEvent),
  ];

  api.lifecycle.onDispose(() => {
    disposed = true;
    clearInterval(tick);
    for (const timeout of hydrateRetryTimeouts.values()) {
      clearTimeout(timeout);
    }
    hydrateRetryTimeouts.clear();
    commandDispose();
    for (const dispose of disposers) {
      dispose();
    }
  });

  api.slots.register({
    order: 90,
    slots: {
      sidebar_content(ctx: SidebarContentContext) {
        const routeSessionID = resolveRouteSessionID(api);
        const sessionID = ctx.session_id ?? routeSessionID ?? "";
        debugLog({
          kind: "slot.sidebar_content",
          ctxSessionID: ctx.session_id,
          resolvedSessionID: sessionID,
          route: api.route.current,
          childCount: Object.keys(state().children).length,
        });
        return (
          <Show when={subagentsSectionEnabled()}>
            <SidebarSubagents
              api={api}
              sessionID={sessionID}
              state={state}
              nowMs={nowMs}
              expanded={subagentsExpanded}
              onToggleExpanded={() =>
                setSubagentsExpandedPreference(!subagentsExpanded())
              }
              onSetExpanded={setSubagentsExpandedSilently}
              onReturnFocus={focusActivePrompt}
              onToggleListFocus={toggleSidebarListFocus}
              onNavigateToChild={rememberSidebarChildNavigation}
              sidebarWidth={() => resolveSidebarWidth(ctx)}
              theme={ctx.theme.current}
            />
          </Show>
        );
      },
      home_bottom(ctx: HomeBottomContext) {
        return <HomeBottomStatus state={state} theme={ctx.theme.current} />;
      },
      home_prompt(_ctx: TuiSlotContext, props: HomePromptProps) {
        const promptProps = {
          ...props,
          ...(props.workspaceID === undefined && props.workspace_id !== undefined
            ? { workspaceID: props.workspace_id }
            : {}),
          ref: composePromptRef(props.ref),
        };
        return <api.ui.Prompt {...promptProps} />;
      },
      session_prompt(_ctx: TuiSlotContext, props: SessionPromptProps) {
        const promptProps = {
          ...props,
          ...(props.sessionID === undefined && props.session_id !== undefined
            ? { sessionID: props.session_id }
            : {}),
          ...(props.onSubmit === undefined && props.on_submit !== undefined
            ? { onSubmit: props.on_submit }
            : {}),
          ref: composePromptRef(props.ref),
        };
        return <api.ui.Prompt {...promptProps} />;
      },
    },
  });
};

const plugin: TuiPluginModule = {
  id: TUI_PLUGIN_ID,
  tui,
};

export default plugin;
