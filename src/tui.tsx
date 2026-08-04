import type {
  TuiPlugin,
  TuiPluginApi,
  TuiPluginModule,
  TuiPromptRef,
  TuiSlotContext,
  TuiThemeCurrent,
} from "@opencode-ai/plugin/tui";
import type {
  BoxRenderable,
  KeyEvent,
  MouseEvent,
  ScrollBoxRenderable,
} from "@opentui/core";
import { useKeyboard } from "@opentui/solid";
import { execFileSync } from "node:child_process";
import { appendFileSync, existsSync, mkdirSync, readdirSync } from "node:fs";
import { createRequire } from "node:module";
import os from "node:os";
import { dirname, join } from "node:path";
import {
  For,
  Show,
  createRoot,
  createEffect,
  createMemo,
  createSignal,
  onCleanup,
} from "solid-js";
import type { Accessor } from "solid-js";
import {
  applySubagentEvent,
  extractChildDetails,
  extractLatestAssistantModel,
  extractTaskToolEvidence,
} from "./events.js";
import { readOpenCodeLogFileIfSmall } from "./logs.js";
import {
  byPriority,
  formatDuration,
  renderStatusLine,
  visibleSubagentWorkItems,
} from "./render.js";
import {
  canSafelyCloseNoTargetPersistedCandidate,
  capCandidates,
  deriveOpenCodeSessionStatus,
  hasRecentMessageActivity,
  nextBackoffState,
  parseStaleRunningThresholdMs as parseConfiguredStaleRunningThresholdMs,
  resolvePersistedStaleSubtaskFromParentMessages,
  resolveSessionStatusWithMessageSummary,
  shouldApplyStaleRunningFallback,
  shouldSkipCandidateForBackoff,
  summarizeSessionMessages,
  type PersistedStaleSubtaskCandidate,
  type RunningReconcileCacheEntry,
  type RunningReconcileEvidence,
  type SessionMessageSummary,
} from "./reconcile.js";
import {
  focusPromptWithDeferredRetry,
  resolveSidebarReturnFocusAction,
  resolveSiblingSidebarRefocus,
  shouldReleaseSidebarListFocus,
  type PendingSidebarRefocus,
} from "./tui-focus.js";
import {
  createEmptyState,
  countCountedSubagentExecutions,
  countHistoricalSubagentExecutions,
  countRetainedSubagentStatuses,
  markChildStatus,
  refreshDerivedFields,
  resolveStatePath,
  resolveTextPath,
  saveState,
  saveStatusText,
  setChildModel,
  upsertChildDetails,
  type ChildTokenState,
  type ChildSessionState,
  type StatusCounts,
  type StatuslineState,
} from "./state.js";
import { takeColumns, textColumns, truncateToColumns } from "./text-width.js";
import { registerSubagentCommands } from "./tui-commands.js";
import { t } from "./i18n.js";

const TUI_PLUGIN_ID = "subagent-statusline.tui";
const ELAPSED_TICK_MS = 1000;
const FALLBACK_SIDEBAR_WIDTH = 34;
const MIN_ROW_WIDTH = 24;
const MIN_LABEL_WIDTH = 8;
const DONE_TOKEN_REHYDRATE_THROTTLE_MS = 2000;
const DONE_TOKEN_REHYDRATE_MAX_ATTEMPTS = 15;
const MAINTENANCE_TICK_MS = DONE_TOKEN_REHYDRATE_THROTTLE_MS;
const HYDRATE_RETRY_BASE_DELAY_MS = 1000;
const HYDRATE_RETRY_MAX_DELAY_MS = 30_000;
const HYDRATE_RETRY_MAX_ATTEMPTS = 6;
const RUNNING_RECONCILE_MAINTENANCE_INTERVAL_MS = 10 * 60_000;
const RUNNING_RECONCILE_MAX_CANDIDATES = 8;
const RUNNING_RECONCILE_INITIAL_BACKOFF_MS = 15_000;
const RUNNING_RECONCILE_MAX_BACKOFF_MS = 5 * 60_000;
const RUNNING_RECONCILE_MESSAGE_AGE_GATE_MS = 60_000;
const RUNNING_RECONCILE_OLD_CANDIDATE_AGE_MS = 5 * 60_000;
const CLOCK_ICON = "";
const TOKEN_ICON = "";
const SIDEBAR_ARROW_EXPANDED = "▼";
const SIDEBAR_ARROW_COLLAPSED = "▶";
const SUBAGENTS_EXPANDED_KV_KEY = "subagents.sidebar.expanded";
const SUBAGENTS_SECTION_ENABLED_KV_KEY = "subagents.sidebar.enabled";
const SUBAGENTS_MAX_VISIBLE_ROWS = 5;
const SUBAGENTS_RUNNING_ROW_HEIGHT = 3;
const SUBAGENTS_TERMINAL_ROW_HEIGHT = 2;
const SUBAGENTS_MODEL_ROW_HEIGHT = 1;
const SUBAGENTS_ROW_GAP = 0;
const SUBAGENTS_ROW_MARKER_WIDTH = 4;
const SUBAGENTS_MAX_LIST_HEIGHT =
  SUBAGENTS_MAX_VISIBLE_ROWS *
    (SUBAGENTS_RUNNING_ROW_HEIGHT + SUBAGENTS_MODEL_ROW_HEIGHT) +
  (SUBAGENTS_MAX_VISIBLE_ROWS - 1) * SUBAGENTS_ROW_GAP;
const INACTIVE_SUBAGENT_OPACITY = 0.65;
const SIDEBAR_VERSION_OPACITY = 0.7;
const SIDEBAR_FOCUS_INDICATOR = "●";

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
  getAnchor: () => SidebarScrollAnchor | undefined;
  getRows: () => SidebarScrollRowLayout[];
  getLeadingHeight: () => number;
  offsetTop: number;
  anchor?: SidebarScrollAnchor;
  restoreFramesRemaining: number;
}

export interface SidebarScrollAnchor {
  childIDs: string[];
  intraRowOffset: number;
}

export interface SidebarScrollRowLayout {
  id: string;
  height: number;
}

interface SidebarListFocusRegistration {
  focusList: (preferredChildID?: string) => boolean;
  blurList: () => boolean;
  isListFocusModeActive: () => boolean;
}

interface SidebarCompletedHistoryRegistration {
  toggleCompletedHistory: () => boolean;
}

const sidebarScrollRegistrations = new Set<SidebarScrollRegistration>();
const sidebarListFocusRegistrations = new Set<SidebarListFocusRegistration>();
const sidebarCompletedHistoryRegistrations =
  new Set<SidebarCompletedHistoryRegistration>();
const SIDEBAR_SCROLL_RESTORE_FRAME_BUDGET = 2;

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

function toggleVisibleSidebarCompletedHistory(): boolean {
  for (const registration of [
    ...sidebarCompletedHistoryRegistrations,
  ].reverse()) {
    if (registration.toggleCompletedHistory()) return true;
  }
  return false;
}

function maxScrollTop(scrollbox: ScrollBoxRenderable): number {
  return Math.max(0, scrollbox.scrollHeight - scrollbox.viewport.height);
}

function clampedScrollTop(
  scrollbox: ScrollBoxRenderable,
  value: number,
): number {
  return Math.max(0, Math.min(value, maxScrollTop(scrollbox)));
}

function snapshotSidebarScrollOffsets(): void {
  for (const registration of sidebarScrollRegistrations) {
    const scrollbox = registration.getScrollbox();
    if (!scrollbox) continue;
    registration.offsetTop = clampedScrollTop(scrollbox, scrollbox.scrollTop);
    registration.anchor = registration.getAnchor();
    registration.restoreFramesRemaining = SIDEBAR_SCROLL_RESTORE_FRAME_BUDGET;
  }
}

function resolveSidebarAnchorScrollTop(input: {
  expanded: boolean;
  anchor?: SidebarScrollAnchor;
  rows: SidebarScrollRowLayout[];
  leadingHeight: number;
  scrollTop: number;
  scrollHeight: number;
  viewportHeight: number;
}): { matched: boolean; offsetTop?: number; scrollTop?: number } {
  if (!input.expanded || !input.anchor || input.anchor.childIDs.length === 0) {
    return { matched: false };
  }

  let top = input.leadingHeight;
  const rowTops = new Map<string, number>();
  for (const row of input.rows) {
    rowTops.set(row.id, top);
    top += row.height + SUBAGENTS_ROW_GAP;
  }

  for (const [index, childID] of input.anchor.childIDs.entries()) {
    const rowTop = rowTops.get(childID);
    if (rowTop === undefined) continue;

    const desiredTop = rowTop + (index === 0 ? input.anchor.intraRowOffset : 0);
    const maxTop = Math.max(0, input.scrollHeight - input.viewportHeight);
    const nextTop = Math.max(0, Math.min(desiredTop, maxTop));
    return {
      matched: true,
      offsetTop: nextTop,
      scrollTop: input.scrollTop !== nextTop ? nextTop : undefined,
    };
  }

  return { matched: false };
}

export function preservedSidebarAnchorScrollTop(input: {
  expanded: boolean;
  anchor?: SidebarScrollAnchor;
  rows: SidebarScrollRowLayout[];
  leadingHeight?: number;
  scrollTop: number;
  scrollHeight: number;
  viewportHeight: number;
}): number | undefined {
  return resolveSidebarAnchorScrollTop({
    ...input,
    leadingHeight: input.leadingHeight ?? 0,
  }).scrollTop;
}

export function preservedSidebarScrollTop(input: {
  expanded: boolean;
  offsetTop: number;
  anchor?: SidebarScrollAnchor;
  rows?: SidebarScrollRowLayout[];
  leadingHeight?: number;
  scrollTop: number;
  scrollHeight: number;
  viewportHeight: number;
}): number | undefined {
  if (!input.expanded) return undefined;

  const anchorTop = resolveSidebarAnchorScrollTop({
    expanded: input.expanded,
    anchor: input.anchor,
    rows: input.rows ?? [],
    leadingHeight: input.leadingHeight ?? 0,
    scrollTop: input.scrollTop,
    scrollHeight: input.scrollHeight,
    viewportHeight: input.viewportHeight,
  });
  if (anchorTop.matched) return anchorTop.scrollTop;

  const maxTop = Math.max(0, input.scrollHeight - input.viewportHeight);
  const top = Math.max(0, Math.min(input.offsetTop, maxTop));
  return top > 0 && input.scrollTop !== top ? top : undefined;
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
  right?: unknown;
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
  targetSessionID?: string;
  parentID?: string;
  messageID?: string;
  source?: ChildSessionState["source"];
  title?: string;
  summary?: string;
  agentName?: string;
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
          model: child.model ? { ...child.model } : undefined,
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
    const contents = readOpenCodeLogFileIfSmall(join(logDir, file));
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
    if (child.status !== "running" && hasTokenTotal(child.tokens)) continue;
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
      await saveStatusText(textPath, renderStatusLine(snapshot));
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

export function runTuiStateMaintenance(
  api: TuiPluginApi,
  current: StatuslineState,
): StatuslineState {
  const next = cloneState(current);
  const hydrated = hydrateStateTokensFromTuiState(api, next);
  const refreshed = refreshLiveState(next);
  return hydrated || refreshed ? next : current;
}

export function createTuiMaintenanceTimers(input: {
  onElapsedTick: () => void;
  onMaintenanceTick: () => void;
}): {
  syncElapsedTimer: (hasRunningChild: boolean) => void;
  dispose: () => void;
} {
  let elapsedTimer: ReturnType<typeof setInterval> | undefined;
  const maintenanceTimer = setInterval(
    input.onMaintenanceTick,
    MAINTENANCE_TICK_MS,
  );

  return {
    syncElapsedTimer(hasRunningChild) {
      if (hasRunningChild && !elapsedTimer) {
        elapsedTimer = setInterval(input.onElapsedTick, ELAPSED_TICK_MS);
      } else if (!hasRunningChild && elapsedTimer) {
        clearInterval(elapsedTimer);
        elapsedTimer = undefined;
      }
    },
    dispose() {
      if (elapsedTimer) clearInterval(elapsedTimer);
      clearInterval(maintenanceTimer);
      elapsedTimer = undefined;
    },
  };
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

export function backfillHydratedTargetSessionIDs(
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
  return parseConfiguredStaleRunningThresholdMs(
    process.env.OPENCODE_SUBAGENT_STATUSLINE_STALE_RUNNING_MS,
  );
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

function ellipsize(value: string, maxColumns: number): string {
  return truncateToColumns(value, maxColumns);
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

  const parentheticalWidth = Math.min(textColumns(parenthetical), width);
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

export function wrapCompactText(
  value: string,
  width: number,
  maxLines: number,
): string[] {
  const normalized = value.replace(/\s+/g, " ").trim();
  if (!normalized) return [""];

  const lines: string[] = [];
  let remaining = normalized;

  while (textColumns(remaining) > width && lines.length < maxLines - 1) {
    const probe = takeColumns(remaining, width + 1);
    const breakAt = probe.lastIndexOf(" ");
    const breakPrefix = breakAt >= 0 ? probe.slice(0, breakAt) : "";
    const fit = takeColumns(remaining, width);
    const take =
      breakAt >= 0 &&
      textColumns(breakPrefix) >= MIN_LABEL_WIDTH &&
      textColumns(breakPrefix) <= width
        ? breakAt
        : fit.length;
    if (take <= 0) break;

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
    const detailChars =
      2 + textColumns(elapsed) + (meta ? 3 + textColumns(meta) : 0);
    const labelBudget = Math.min(
      width - 2,
      width - Math.max(0, detailChars - width),
    );
    if (labelBudget >= MIN_LABEL_WIDTH || textColumns(meta) === 0) {
      const labelLines = wrapCompactText(
        title.label,
        Math.max(1, labelBudget),
        2,
      );
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
    secondaryLine: formatSecondaryLine(
      labelLines[1],
      parenthetical,
      MIN_LABEL_WIDTH,
    ),
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
  const context = contextVariants(input.child).find(
    (variant) => variant.length > 0,
  );

  return {
    label: ellipsize(
      labelSource,
      Math.max(1, width - (input.reservedWidth ?? 0)),
    ),
    meta: context ? `${elapsed} ${context}` : elapsed,
  };
}

export function subagentRowHeight(input: {
  child: ChildSessionState;
  nowMs: number;
  sidebarWidth?: number;
  reservedWidth?: number;
}): number {
  const modelHeight = input.child.model?.variant
    ? SUBAGENTS_MODEL_ROW_HEIGHT
    : 0;
  if (input.child.status !== "running") {
    return SUBAGENTS_TERMINAL_ROW_HEIGHT + modelHeight;
  }

  const line = formatChildRowLine(input);
  return (
    (line.secondaryLine
      ? SUBAGENTS_RUNNING_ROW_HEIGHT
      : SUBAGENTS_RUNNING_ROW_HEIGHT - 1) + modelHeight
  );
}

export function formatChildModelLine(
  child: ChildSessionState,
  providers: TuiPluginApi["state"]["provider"],
  width: number,
): string | undefined {
  if (!child.model?.variant) return undefined;
  const provider = providers.find(
    (candidate) => candidate.id === child.model?.providerID,
  );
  const name = provider?.models[child.model.modelID]?.name || child.model.modelID;
  return ellipsize(`${name} · ${child.model.variant}`, Math.max(1, width));
}

export interface TuiSubagentSnapshot {
  visibleChildren: ChildSessionState[];
  visibleCounts: StatusCounts;
  totalExecuted: number;
  showingOtherSessions: boolean;
}

export function resolveTuiSubagentSnapshot(input: {
  state: StatuslineState;
  sessionID?: string;
  nowMs?: number;
  showCompletedHistory?: boolean;
}): TuiSubagentSnapshot {
  const allChildren = Object.values(input.state.children);
  const options = { showCompletedHistory: input.showCompletedHistory };
  const nowMs = input.nowMs ?? Date.now();
  const ownChildren = input.sessionID
    ? allChildren.filter((child) => child.parentID === input.sessionID)
    : allChildren;
  const ownVisibleChildren = visibleSubagentWorkItems(
    ownChildren,
    nowMs,
    options,
  ).sort(byPriority);
  const totalExecuted = input.sessionID
    ? countCountedSubagentExecutions({
        children: allChildren,
        countedChildIDs: input.state.countedChildIDs,
        parentSessionID: input.sessionID,
      })
    : countHistoricalSubagentExecutions({ children: allChildren });

  return {
    visibleChildren: ownVisibleChildren,
    visibleCounts: countRetainedSubagentStatuses({
      children: allChildren,
      parentSessionID: input.sessionID,
    }),
    totalExecuted,
    showingOtherSessions: false,
  };
}

export function resolveSidebarSubagentSnapshot(input: {
  state: StatuslineState;
  sessionID: string;
  nowMs?: number;
  showCompletedHistory?: boolean;
}): TuiSubagentSnapshot {
  return resolveTuiSubagentSnapshot(input);
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
    showCompletedHistory: boolean;
  }) => void;
  sidebarWidth?: () => number | undefined;
  theme: TuiThemeCurrent;
  restoreFromChild?: {
    childRowID: string;
    showCompletedHistory: boolean;
  };
}) {
  const [showCompletedHistory, setShowCompletedHistory] = createSignal(
    props.restoreFromChild?.showCompletedHistory ?? false,
  );
  const completedHistoryOptions = () => ({
    showCompletedHistory: showCompletedHistory(),
  });
  const snapshot = createMemo(() =>
    resolveSidebarSubagentSnapshot({
      state: props.state(),
      sessionID: props.sessionID,
      nowMs: props.nowMs(),
      ...completedHistoryOptions(),
    }),
  );
  const visibleChildren = createMemo(() => snapshot().visibleChildren);
  const counts = createMemo(() => snapshot().visibleCounts);
  const totalExecuted = createMemo(() => snapshot().totalExecuted);

  const visibleChildIDs = createMemo(() =>
    visibleChildren().map((child) => child.id),
  );
  const [selectedChildID, setSelectedChildID] = createSignal<
    string | undefined
  >(props.restoreFromChild?.childRowID);
  let restoreChildRowID = props.restoreFromChild?.childRowID;
  const [mouseDownChildID, setMouseDownChildID] = createSignal<
    string | undefined
  >();
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
          child.model?.providerID ?? "",
          child.model?.modelID ?? "",
          child.model?.variant ?? "",
        ]),
      )
      .join("|"),
  );

  const listHeight = createMemo(() => {
    const nowMs = props.nowMs();
    const sidebarWidth = props.sidebarWidth?.();
    const contentHeight =
      visibleChildren().reduce(
        (height, child) =>
          height +
          subagentRowHeight({
            child,
            nowMs,
            sidebarWidth,
            reservedWidth: SUBAGENTS_ROW_MARKER_WIDTH,
          }),
        0,
      ) +
      Math.max(0, visibleChildren().length - 1) * SUBAGENTS_ROW_GAP;

    return Math.max(1, Math.min(SUBAGENTS_MAX_LIST_HEIGHT, contentHeight));
  });

  let listContainer: BoxRenderable | undefined;
  let scrollbox: ScrollBoxRenderable | undefined;
  const scrollRegistration: SidebarScrollRegistration = {
    getScrollbox: () => scrollbox,
    getAnchor: () => currentSidebarScrollAnchor(),
    getRows: () => rowLayouts(),
    getLeadingHeight: () => 0,
    offsetTop: 0,
    restoreFramesRemaining: 0,
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
  let previousRunningCount: number | undefined;
  createEffect(() => {
    const runningCount = counts().running;
    const shouldReleaseFocus = shouldReleaseSidebarListFocus({
      previousRunningCount,
      runningCount,
      listFocusModeActive: listFocusModeActive(),
    });
    previousRunningCount = runningCount;
    if (!shouldReleaseFocus) return;

    focusRegistration.blurList();
    props.onReturnFocus();
  });
  const completedHistoryRegistration: SidebarCompletedHistoryRegistration = {
    toggleCompletedHistory: () => {
      setShowCompletedHistory((current) => !current);
      return true;
    },
  };
  sidebarCompletedHistoryRegistrations.add(completedHistoryRegistration);
  onCleanup(() => {
    sidebarScrollRegistrations.delete(scrollRegistration);
    sidebarListFocusRegistrations.delete(focusRegistration);
    sidebarCompletedHistoryRegistrations.delete(completedHistoryRegistration);
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
    let top = 0;
    const nowMs = props.nowMs();
    const sidebarWidth = props.sidebarWidth?.();
    for (let i = 0; i < index; i += 1) {
      const child = visibleChildren()[i];
      if (child) {
        top +=
          subagentRowHeight({
            child,
            nowMs,
            sidebarWidth,
            reservedWidth: SUBAGENTS_ROW_MARKER_WIDTH,
          }) + SUBAGENTS_ROW_GAP;
      }
    }
    return top;
  };

  const rowLayouts = (): SidebarScrollRowLayout[] => {
    const nowMs = props.nowMs();
    const sidebarWidth = props.sidebarWidth?.();
    return visibleChildren().map((child) => ({
      id: child.id,
      height: subagentRowHeight({
        child,
        nowMs,
        sidebarWidth,
        reservedWidth: SUBAGENTS_ROW_MARKER_WIDTH,
      }),
    }));
  };

  const currentSidebarScrollAnchor = (): SidebarScrollAnchor | undefined => {
    if (!scrollbox) return undefined;
    const rows = rowLayouts();
    if (rows.length === 0) return undefined;

    const viewportTop = clampedScrollTop(scrollbox, scrollbox.scrollTop);
    let top = 0;
    for (let index = 0; index < rows.length; index += 1) {
      const row = rows[index];
      if (!row) continue;
      const rowBottom = top + row.height;
      if (rowBottom > viewportTop) {
        return {
          childIDs: rows.slice(index).map((candidate) => candidate.id),
          intraRowOffset: Math.max(0, viewportTop - top),
        };
      }
      top = rowBottom + SUBAGENTS_ROW_GAP;
    }

    const lastRow = rows[rows.length - 1];
    return lastRow ? { childIDs: [lastRow.id], intraRowOffset: 0 } : undefined;
  };

  const scrollChildIntoView = (childID: string | undefined): void => {
    if (!scrollbox) return;
    const selectedIndex = visibleChildIDs().findIndex((id) => id === childID);
    if (selectedIndex < 0) return;
    const selectedChild = visibleChildren()[selectedIndex];
    if (!selectedChild) return;

    const rowTop = rowTopForIndex(selectedIndex);
    const rowBottom =
      rowTop +
      subagentRowHeight({
        child: selectedChild,
        nowMs: props.nowMs(),
        sidebarWidth: props.sidebarWidth?.(),
        reservedWidth: SUBAGENTS_ROW_MARKER_WIDTH,
      });
    const viewportTop = scrollbox.scrollTop;
    const viewportBottom = viewportTop + listHeight();

    if (rowTop < viewportTop) {
      const nextTop = clampedScrollTop(scrollbox, rowTop);
      scrollRegistration.offsetTop = nextTop;
      scrollbox.scrollTop = nextTop;
    } else if (rowBottom > viewportBottom) {
      const nextTop = clampedScrollTop(scrollbox, rowBottom - listHeight());
      scrollRegistration.offsetTop = nextTop;
      scrollbox.scrollTop = nextTop;
    }
  };

  const scrollSelectedChildIntoView = (): void => {
    if (!listFocusModeActive()) return;
    scrollChildIntoView(selectedChildID());
  };

  const moveSelection = (delta: number): void => {
    const ids = visibleChildIDs();
    if (ids.length === 0) return;
    const currentIndex = ids.findIndex((id) => id === selectedChildID());
    const fallbackIndex = delta > 0 ? 0 : ids.length - 1;
    const nextIndex = Math.max(
      0,
      Math.min(
        ids.length - 1,
        currentIndex < 0 ? fallbackIndex : currentIndex + delta,
      ),
    );
    setSelectedChildID(ids[nextIndex]);
    scrollChildIntoView(ids[nextIndex]);
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
    return selected
      ? resolveNavigableChildTargetSessionID(selected)
      : undefined;
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

  const toggleCompletedHistory = (): void => {
    completedHistoryRegistration.toggleCompletedHistory();
  };

  createEffect(() => {
    selectedChildID();
    listHeight();
    if (!listFocused()) return;
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
    } else if (name === "c") {
      toggleCompletedHistory();
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

  const restorePreservedScroll = (): void => {
    if (!scrollbox) return;
    if (scrollRegistration.restoreFramesRemaining <= 0) return;
    scrollRegistration.restoreFramesRemaining -= 1;

    if (restoreChildRowID) {
      const childRowID = restoreChildRowID;
      restoreChildRowID = undefined;
      scrollRegistration.restoreFramesRemaining = 0;
      if (visibleChildIDs().includes(childRowID)) {
        scrollChildIntoView(childRowID);
      } else {
        scrollbox.scrollTop = 0;
      }
      return;
    }

    const top = preservedSidebarScrollTop({
      expanded: props.expanded(),
      offsetTop: scrollRegistration.offsetTop,
      anchor: scrollRegistration.anchor,
      rows: scrollRegistration.getRows(),
      leadingHeight: scrollRegistration.getLeadingHeight(),
      scrollTop: scrollbox.scrollTop,
      scrollHeight: scrollbox.scrollHeight,
      viewportHeight: scrollbox.viewport.height,
    });
    if (top === undefined) return;
    scrollRegistration.offsetTop = top;
    scrollbox.scrollTop = top;
  };

  createEffect(() => {
    props.expanded();
    visibleChildIDs().join("|");
    visibleChildLayoutSignature();
    props.sidebarWidth?.();

    restorePreservedScroll();
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
    const line = createMemo(() => {
      const currentChild = child();
      if (!currentChild) {
        return { labelLines: [""], elapsed: "00:00", meta: "" };
      }
      return formatChildRowLine({
        child: currentChild,
        nowMs: props.nowMs(),
        sidebarWidth: props.sidebarWidth?.(),
        reservedWidth: SUBAGENTS_ROW_MARKER_WIDTH,
      });
    });
    const terminalLine = createMemo(() => {
      const currentChild = child();
      if (!currentChild) return { label: "", meta: "00:00" };
      return formatTerminalChildRowLine({
        child: currentChild,
        nowMs: props.nowMs(),
        sidebarWidth: props.sidebarWidth?.(),
        reservedWidth: SUBAGENTS_ROW_MARKER_WIDTH,
      });
    });
    const rowHeight = createMemo(() => {
      const currentChild = child();
      if (!currentChild) return SUBAGENTS_TERMINAL_ROW_HEIGHT;
      return subagentRowHeight({
        child: currentChild,
        nowMs: props.nowMs(),
        sidebarWidth: props.sidebarWidth?.(),
        reservedWidth: SUBAGENTS_ROW_MARKER_WIDTH,
      });
    });
    const modelLine = createMemo(() => {
      const currentChild = child();
      if (!currentChild) return undefined;
      return formatChildModelLine(
        currentChild,
        props.api.state.provider,
        rowWidthBudget(props.sidebarWidth?.()) - SUBAGENTS_ROW_MARKER_WIDTH,
      );
    });
    const activate = () => {
      const target = targetSessionID();
      if (target) {
        props.onNavigateToChild({
          parentSessionID: props.sessionID,
          childSessionID: target,
          childRowID: rowProps.childID,
          showCompletedHistory: showCompletedHistory(),
        });
      }
      snapshotSidebarScrollOffsets();
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
                setMouseDownChildID(undefined);
              }
            : undefined
        }
        onMouseDown={
          clickable()
            ? (event: MouseEvent) => {
                event.stopPropagation();
                setSelectedChildID(rowProps.childID);
                setMouseDownChildID(rowProps.childID);
              }
            : undefined
        }
        onMouseUp={
          clickable()
            ? (event: MouseEvent) => {
                if (mouseDownChildID() === rowProps.childID) {
                  event.stopPropagation();
                  activate();
                }
                setMouseDownChildID(undefined);
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
                <text
                  fg={selected() ? props.theme.accent : props.theme.textMuted}
                >
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
              <Show when={modelLine()}>
                {(metadata: Accessor<string>) => (
                  <text fg={props.theme.textMuted}>{`    ${metadata()}`}</text>
                )}
              </Show>
            </box>
          }
        >
          <box flexDirection="column">
            <box flexDirection="row">
              <text
                fg={selected() ? props.theme.accent : props.theme.textMuted}
              >
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
            <Show when={modelLine()}>
              {(metadata: Accessor<string>) => (
                <text fg={props.theme.textMuted}>{`    ${metadata()}`}</text>
              )}
            </Show>
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
      {/* biome-ignore lint/a11y/noStaticElementInteractions: OpenTUI text supports mouse targets. */}
      <text
        fg={showCompletedHistory() ? props.theme.accent : props.theme.text}
        selectable={false}
        onMouseDown={toggleCompletedHistory}
      >{`Σ ${totalExecuted()}`}</text>
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
      renderBefore={() => {
        refreshListFocused();
        restorePreservedScroll();
      }}
    >
      <box flexDirection="row">
        <text
          fg={props.theme.text}
          selectable={false}
          onMouseDown={props.onToggleExpanded}
        >{`${props.expanded() ? SIDEBAR_ARROW_EXPANDED : SIDEBAR_ARROW_COLLAPSED} ${t("subagents")}`}</text>
        <Show when={PLUGIN_VERSION}>
          {(version: Accessor<string>) => (
            <box flexDirection="row">
              <text
                fg={props.theme.textMuted}
                opacity={SIDEBAR_VERSION_OPACITY}
                selectable={false}
                onMouseDown={props.onToggleExpanded}
              >{` ${version()}`}</text>
              <Show when={listFocused()}>
                <text
                  fg={props.theme.accent}
                  selectable={false}
                  onMouseDown={props.onToggleExpanded}
                >{` ${SIDEBAR_FOCUS_INDICATOR}`}</text>
              </Show>
            </box>
          )}
        </Show>
      </box>
      <AggregateBar />

      <Show when={props.expanded()}>
        <scrollbox
          ref={(element) => {
            scrollbox = element;
            restorePreservedScroll();
          }}
          height={listHeight()}
          scrollY
          viewportCulling={false}
        >
          <box flexDirection="column" rowGap={SUBAGENTS_ROW_GAP}>
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
  const snapshot = createMemo(() =>
    resolveTuiSubagentSnapshot({ state: props.state() }),
  );
  const counts = createMemo(() => snapshot().visibleCounts);
  const totalExecuted = createMemo(() => snapshot().totalExecuted);
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

export async function hydratePreviousSubagents(
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
    let parentMessageHydrationFailed = false;

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
        if (!response) {
          topLevelHydrationFailed = true;
          parentMessageHydrationFailed = true;
        }
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
    const parentTaskEvidenceByChildID =
      collectParentTaskEvidenceByChildSessionID(messages, currentSessionID);
    let childHydrationFailed = false;
    const childMessageResults: Array<
      SessionMessageSummary & {
        childID?: string;
        fetchFailed: boolean;
        model?: ReturnType<typeof extractLatestAssistantModel>;
      }
    > = await Promise.all(
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
          model: extractLatestAssistantModel(childMessages),
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
        const status = allStatuses[session.id];
        const sessionStatus = deriveSessionChildStatus(status);
        const childSummary = childMessageSummaryByID.get(session.id);
        const hasHydrationEvidence = shouldHydrateSessionChild({
          childID: session.id,
          sessionStatus,
          childSummary,
          parentTaskEvidenceByChildID,
        });
        const parentTaskEvidence = parentTaskEvidenceByChildID.get(session.id);
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
        const shouldHydrateChildFromSession = hasHydrationEvidence;

        if (!shouldHydrateChildFromSession) {
          const existing = next.children[session.id];
          if (
            !statusHydrationFailed &&
            !parentMessageHydrationFailed &&
            !!childSummary &&
            !childSummary.fetchFailed &&
            existing?.parentID === currentSessionID &&
            existing.source === "session" &&
            existing.status === "running"
          ) {
            delete next.children[session.id];
            changed = true;
          }
          continue;
        }

        const fakeEvent = {
          type: "session.created",
          properties: {
            sessionID: session.id,
            info: session,
          },
        };
        if (applySubagentEvent(next, fakeEvent)) changed = true;
        if (childSummary?.model) {
          changed =
            setChildModel(
              next,
              session.id,
              childSummary.model.model,
              childSummary.model.updatedAt,
            ) || changed;
        }

        const resolvedStatus = resolveSessionStatusWithMessageSummary({
          status: sessionStatus ?? parentTaskEvidence?.status,
          summary: childSummary,
        });

        if (
          resolvedStatus.status === "done" ||
          resolvedStatus.status === "error"
        ) {
          if (
            markChildStatus(
              next,
              session.id,
              resolvedStatus.status,
              resolvedStatus.endedAt ??
                parentTaskEvidence?.endedAt ??
                statusEndedAt,
            )
          )
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
        const eventInfo = {
          id: typeof info?.id === "string" ? info.id : undefined,
          role: typeof info?.role === "string" ? info.role : undefined,
          parentID:
            typeof info?.parentID === "string" ? info.parentID : undefined,
          time,
        };
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

function shouldHydrateSessionChild(input: {
  childID: string;
  sessionStatus?: ChildSessionState["status"];
  childSummary?: SessionMessageSummary;
  parentTaskEvidenceByChildID: ReadonlyMap<string, ParentTaskEvidence>;
}): boolean {
  if (input.sessionStatus) return true;
  if (input.parentTaskEvidenceByChildID.has(input.childID)) return true;

  const summary = input.childSummary;
  if (!summary || summary.fetchFailed) return false;

  return (
    summary.hasError === true ||
    typeof summary.completedAt === "string" ||
    typeof summary.evidenceAt === "string" ||
    typeof summary.latestAssistantActivityAt === "string" ||
    typeof summary.latestMessageActivityAt === "string"
  );
}

type ParentTaskEvidence = {
  status: ChildSessionState["status"];
  endedAt?: string;
};

function collectParentTaskEvidenceByChildSessionID(
  messages: unknown[],
  parentSessionID: string,
): Map<string, ParentTaskEvidence> {
  const evidenceByID = new Map<string, ParentTaskEvidence>();
  for (const rawMessage of messages) {
    const message = asRecord(rawMessage);
    const info = asRecord(message?.info);
    const parts = Array.isArray(message?.parts) ? message.parts : [];
    for (const rawPart of parts) {
      const part = asRecord(rawPart);
      if (!part || part.type !== "tool" || part.tool !== "task") continue;
      const state = asRecord(part.state);
      const metadata = asRecord(state?.metadata);
      const childID =
        typeof metadata?.sessionId === "string"
          ? metadata.sessionId
          : undefined;
      if (!childID || childID === parentSessionID) continue;

      const taskEvidence = extractTaskToolEvidence({
        type: "message.part.updated",
        properties: {
          sessionID: parentSessionID,
          info: {
            time: info?.time,
          },
          part: rawPart,
        },
      });
      evidenceByID.set(childID, {
        status: taskEvidence?.status ?? "running",
        endedAt: taskEvidence?.endedAt,
      });
    }
  }
  return evidenceByID;
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

function deriveSessionChildStatus(
  status: unknown,
): ChildSessionState["status"] | undefined {
  return deriveOpenCodeSessionStatus(status);
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

function resolveRunningChildAgeMillis(
  child: ChildSessionState,
  nowMs: number,
): {
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
  return (
    resolveChildTargetSessionID(child) ??
    resolveSyntheticTargetFromHydratedState(state, child)
  );
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
    const age = resolveRunningChildAgeMillis(child, input.nowMs);
    const targetSessionID = resolveReconcileTargetSessionID(input.state, child);
    const canProbePersistedSubtask =
      child.source === "subtask" &&
      !targetSessionID &&
      typeof child.parentID === "string" &&
      child.parentID.length > 0 &&
      typeof child.messageID === "string" &&
      child.messageID.length > 0 &&
      (age.startedMs >= RUNNING_RECONCILE_OLD_CANDIDATE_AGE_MS ||
        age.updatedMs >= RUNNING_RECONCILE_OLD_CANDIDATE_AGE_MS);
    if (!targetSessionID && !canProbePersistedSubtask) continue;
    selected.push({
      childID: child.id,
      targetSessionID,
      parentID: child.parentID,
      messageID: child.messageID,
      source: child.source,
      title: child.title,
      summary: child.summary,
      agentName: child.agentName,
      startedMs: age.startedMs,
      updatedMs: age.updatedMs,
    });
    if (selected.length >= input.maxCandidates) break;
  }

  return capCandidates(selected, input.maxCandidates);
}

export async function probeRunningEvidence(input: {
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
  const statusFromState = deriveSessionChildStatus(directStatus);
  if (statusFromState === "error") {
    return { status: statusFromState, endedAt: new Date().toISOString() };
  }
  if (statusFromState === "running") {
    return { status: "running", sawRunningEvidence: true };
  }

  const doneFromState = statusFromState === "done";
  let doneFromClient = false;

  const statusResp = await safeReadAsync(() =>
    input.api.client.session.status({ directory: input.directory }),
  );
  if (statusResp === undefined) probeFailed = true;
  const statuses = asRecord(statusResp?.data);
  const statusFromClient = deriveSessionChildStatus(
    statuses?.[input.targetSessionID],
  );
  if (statusFromClient === "error") {
    return { status: statusFromClient, endedAt: new Date().toISOString() };
  }
  if (statusFromClient === "running") {
    return { status: "running", sawRunningEvidence: true };
  }
  doneFromClient = statusFromClient === "done";

  const hasDoneStatus = doneFromState || doneFromClient;

  if (
    !hasDoneStatus &&
    input.candidateAgeMs < RUNNING_RECONCILE_MESSAGE_AGE_GATE_MS
  ) {
    return { probeFailed, canApplyStaleFallback: false };
  }

  const messagesResp = await safeReadAsync(() =>
    input.api.client.session.messages({
      sessionID: input.targetSessionID,
      directory: input.directory,
    }),
  );
  if (messagesResp === undefined || !Array.isArray(messagesResp?.data)) {
    if (hasDoneStatus) {
      return {
        status: "done",
        endedAt: new Date().toISOString(),
        checkedMessages: false,
        probeFailed: true,
        canApplyStaleFallback: false,
      };
    }
    return {
      checkedMessages: false,
      probeFailed: true,
      canApplyStaleFallback: false,
    };
  }
  const messages = Array.isArray(messagesResp?.data) ? messagesResp.data : [];
  const summary = summarizeSessionMessages(messages);
  const resolvedStatus = resolveSessionStatusWithMessageSummary({
    status: hasDoneStatus ? "done" : undefined,
    summary,
  });

  if (resolvedStatus.status === "error") {
    return {
      status: "error",
      endedAt: resolvedStatus.endedAt,
      checkedMessages: true,
      canApplyStaleFallback: false,
    };
  }

  if (resolvedStatus.status === "done") {
    return {
      status: "done",
      endedAt: resolvedStatus.endedAt ?? new Date().toISOString(),
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

function initializeTui(api: TuiPluginApi, disposeRoot: () => void): void {
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
  let pendingSidebarRefocus: PendingSidebarRefocus | undefined;
  let pendingRefocusConsumed = false;
  let activePromptRef: TuiPromptRef | undefined;

  const consumePendingSidebarRefocus = ():
    | PendingSidebarRefocus
    | undefined => {
    if (pendingRefocusConsumed) return undefined;
    pendingRefocusConsumed = true;
    return pendingSidebarRefocus;
  };

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
    focusPromptWithDeferredRetry(() => {
      if (!activePromptRef) return false;
      activePromptRef.focus();
      return true;
    });
  };

  const rememberSidebarChildNavigation = (
    input: PendingSidebarRefocus,
  ): void => {
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

  const toggleSidebarCompletedHistory = (): void => {
    api.ui.dialog.clear();
    setSubagentsSectionEnabled(true);
    setSubagentsExpanded(true);
    api.kv.set(SUBAGENTS_SECTION_ENABLED_KV_KEY, true);
    api.kv.set(SUBAGENTS_EXPANDED_KV_KEY, true);
    setTimeout(() => {
      toggleVisibleSidebarCompletedHistory();
    }, 0);
  };

  const commandDispose = registerSubagentCommands({
    api,
    sectionEnabled: subagentsSectionEnabled,
    toggleSection: setSubagentsSectionEnabledPreference,
    focusSidebarList: toggleSidebarListFocus,
    toggleCompletedHistory: toggleSidebarCompletedHistory,
  });

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
    void api.route.current;
    const routeSessionID = resolveRouteSessionID(api);

    if (previousRouteSessionID && previousRouteSessionID !== routeSessionID) {
      resetHydrateRetry(previousRouteSessionID);
    }

    const siblingRefocus = resolveSiblingSidebarRefocus({
      pendingSidebarRefocus,
      routeSessionID,
      children: state().children,
    });
    if (siblingRefocus && pendingSidebarRefocus) {
      pendingSidebarRefocus = {
        ...pendingSidebarRefocus,
        ...siblingRefocus,
      };
    }

    const sidebarReturnAction = resolveSidebarReturnFocusAction({
      pendingSidebarRefocus,
      previousRouteSessionID,
      routeSessionID,
    });
    pendingRefocusConsumed = false;
    if (sidebarReturnAction === "focus-prompt") {
      blurVisibleSidebarSubagentList();
      focusActivePrompt();
    } else if (sidebarReturnAction === "clear-pending") {
      pendingSidebarRefocus = undefined;
    }

    previousRouteSessionID = routeSessionID;

    if (!routeSessionID) return;

    const sessionID = routeSessionID;
    if (
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

      const delayMs = Math.min(
        HYDRATE_RETRY_MAX_DELAY_MS,
        HYDRATE_RETRY_BASE_DELAY_MS * 2 ** attempts,
      );

      setHydrateRetryAttempts((prev) => {
        const next = new Map(prev);
        next.set(sessionID, Math.min(attempts + 1, HYDRATE_RETRY_MAX_ATTEMPTS));
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
        childID: string;
        targetSessionID: string;
        status: "done" | "error";
        endedAt?: string;
        reconcileWithoutTargetSessionID?: boolean;
      }> = [];

      const parentMessagesCache = new Map<string, unknown[] | null>();

      for (const candidate of selected) {
        const key = candidate.targetSessionID ?? candidate.childID;
        const cache = runningReconcileBackoff.get(key);
        if (shouldSkipCandidateForBackoff(cache, nowMs)) continue;

        if (!candidate.targetSessionID) {
          const isPersistedSubtaskCandidate =
            candidate.source === "subtask" &&
            typeof candidate.parentID === "string" &&
            candidate.parentID.length > 0 &&
            typeof candidate.messageID === "string" &&
            candidate.messageID.length > 0;
          if (!isPersistedSubtaskCandidate) continue;

          const parentSessionID = candidate.parentID as string;
          let parentMessages = parentMessagesCache.get(parentSessionID);
          if (parentMessages === undefined) {
            const parentMessagesResp = await safeReadAsync(() =>
              api.client.session.messages({
                sessionID: parentSessionID,
                directory,
              }),
            );
            parentMessages = Array.isArray(parentMessagesResp?.data)
              ? parentMessagesResp.data
              : null;
            parentMessagesCache.set(parentSessionID, parentMessages);
          }
          if (parentMessages === null) {
            runningReconcileBackoff.set(
              key,
              nextBackoffState({
                cache,
                nowMs,
                initialBackoffMs: RUNNING_RECONCILE_INITIAL_BACKOFF_MS,
                maxBackoffMs: RUNNING_RECONCILE_MAX_BACKOFF_MS,
              }),
            );
            continue;
          }

          const evidence = resolvePersistedStaleSubtaskFromParentMessages({
            candidate: {
              childID: candidate.childID,
              parentID: candidate.parentID as string,
              messageID: candidate.messageID as string,
              title: candidate.title,
              summary: candidate.summary,
              agentName: candidate.agentName,
            } satisfies PersistedStaleSubtaskCandidate,
            messages: parentMessages,
          });
          if (!evidence) {
            const parentSummary = summarizeSessionMessages(parentMessages);
            const canSafelyFallbackByParentInactivity =
              canSafelyCloseNoTargetPersistedCandidate({
                nowMs,
                staleThresholdMs: STALE_RUNNING_THRESHOLD_MS,
                startedMs: candidate.startedMs,
                updatedMs: candidate.updatedMs,
                latestMessageActivityAtMs:
                  parentSummary.latestMessageActivityAtMs,
              });
            if (canSafelyFallbackByParentInactivity) {
              mutations.push({
                childID: candidate.childID,
                targetSessionID: candidate.childID,
                status: "done",
                endedAt:
                  parentSummary.latestMessageActivityAt ??
                  new Date(nowMs - candidate.updatedMs).toISOString(),
                reconcileWithoutTargetSessionID: true,
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
            continue;
          }

          mutations.push({
            childID: candidate.childID,
            targetSessionID: evidence.targetSessionID ?? candidate.childID,
            status: evidence.status,
            endedAt: evidence.endedAt,
            reconcileWithoutTargetSessionID: true,
          });
          runningReconcileBackoff.delete(key);
          continue;
        }

        const evidence = await probeRunningEvidence({
          api,
          targetSessionID: candidate.targetSessionID,
          directory,
          candidateAgeMs: Math.max(candidate.startedMs, candidate.updatedMs),
          nowMs,
        });

        if (evidence.status === "done" || evidence.status === "error") {
          mutations.push({
            childID: candidate.childID,
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
            childID: candidate.childID,
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
            mutation.reconcileWithoutTargetSessionID &&
            mutation.targetSessionID.startsWith("ses_")
          ) {
            changed =
              upsertChildDetails(next, mutation.childID, {
                targetSessionID: mutation.targetSessionID,
                updatedAt: mutation.endedAt,
              }) || changed;
          }
          if (
            markChildStatus(
              next,
              mutation.reconcileWithoutTargetSessionID
                ? mutation.childID
                : mutation.targetSessionID,
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

  const timers = createTuiMaintenanceTimers({
    onElapsedTick: () => {
      snapshotSidebarScrollOffsets();
      setNowMs(Date.now());
    },
    onMaintenanceTick: () => {
      const currentNowMs = Date.now();
      if (
        currentNowMs - lastRunningReconcileAtMs >=
        RUNNING_RECONCILE_MAINTENANCE_INTERVAL_MS
      ) {
        void reconcileRunningChildren();
      }

      setState((current: StatuslineState) => {
        const next = runTuiStateMaintenance(api, current);
        if (next === current) return current;
        snapshotSidebarScrollOffsets();
        persistStateSnapshot(statePath, textPath, next);
        return next;
      });
    },
  });

  createEffect(() => {
    timers.syncElapsedTimer(
      Object.values(state().children).some((child) => child.status === "running"),
    );
  });

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
    api.event.on("session.status", applyEvent),
    api.event.on("session.idle", applyEvent),
    api.event.on("session.error", applyEvent),
    api.event.on("message.updated", applyEvent),
    api.event.on("message.part.updated", applyEvent),
  ];

  api.lifecycle.onDispose(() => {
    disposed = true;
    timers.dispose();
    for (const timeout of hydrateRetryTimeouts.values()) {
      clearTimeout(timeout);
    }
    hydrateRetryTimeouts.clear();
    commandDispose();
    for (const dispose of disposers) {
      dispose();
    }
    disposeRoot();
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
        const restoreFromChild = (() => {
          const pending = consumePendingSidebarRefocus();
          if (pending?.parentSessionID !== sessionID) return undefined;
          return {
            childRowID: pending.childRowID,
            showCompletedHistory: pending.showCompletedHistory ?? false,
          };
        })();
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
              restoreFromChild={restoreFromChild}
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
          ...(props.workspaceID === undefined &&
          props.workspace_id !== undefined
            ? { workspaceID: props.workspace_id }
            : {}),
          ref: composePromptRef(props.ref),
        };
        return <api.ui.Prompt {...promptProps} />;
      },
      session_prompt(_ctx: TuiSlotContext, props: SessionPromptProps) {
        const sessionID = props.sessionID ?? props.session_id;
        const promptProps = {
          ...props,
          ...(props.sessionID === undefined && props.session_id !== undefined
            ? { sessionID: props.session_id }
            : {}),
          ...(props.onSubmit === undefined && props.on_submit !== undefined
            ? { onSubmit: props.on_submit }
            : {}),
          right:
            props.right ??
            (sessionID ? (
              <api.ui.Slot name="session_prompt_right" session_id={sessionID} />
            ) : undefined),
          ref: composePromptRef(props.ref),
        };
        return <api.ui.Prompt {...promptProps} />;
      },
    },
  });
}

const tui: TuiPlugin = async (api: TuiPluginApi) => {
  createRoot((disposeRoot) => initializeTui(api, disposeRoot));
};

const plugin: TuiPluginModule = {
  id: TUI_PLUGIN_ID,
  tui,
};

export default plugin;
