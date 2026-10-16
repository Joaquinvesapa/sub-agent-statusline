// Subagent monitor — OpenCode V2-native entrypoint.
//
// Renders the subagent list appended to `sidebar.content` and a compact
// busy/failed/done summary in the home footer status row, ported from the V1
// `./tui` feature set for OpenCode 2.x. The V1 entrypoint stays untouched.
//
// The keymap layer is owned by a mounted component (not by `setup`) because
// `context.keymap.layer` resolves a Solid context owned by the caller.

import { Plugin, usePlugin } from "@opencode/plugin/tui";
import type { KeymapCommand } from "@opencode/plugin/tui/context";
import {
  For,
  Show,
  createEffect,
  createMemo,
  createSignal,
  onCleanup,
} from "solid-js";
import type { Store } from "solid-js/store";
import {
  CURSOR_MARKER,
  FOCUS_INDICATOR,
  LABEL_INDENT,
  LABEL_WIDTH,
  SIDEBAR_ARROW_COLLAPSED,
  SIDEBAR_ARROW_EXPANDED,
  labelFor,
  metaFor,
  statusMarker,
  wrapLabel,
} from "./format.js";
import {
  byPriority,
  deriveStatus,
  isBusy,
  maxCandidates,
  type V2Session,
} from "./reconcile.js";

const PLUGIN_ID = "subagent-monitor";

// The V2 `sidebar.content` slot publishes no width, so the row budget is a
// constant sized to the sidebar's inner area (about 36 columns at the host
// default). Rows wrap themselves instead of letting the renderer break a line
// at an arbitrary column.
const REFRESH_COALESCE_MS = 200;
const ELAPSED_TICK_MS = 1000;
const MAX_DONE_ROWS = 3;

type MonitorContext = ReturnType<typeof usePlugin>;

interface Prefs {
  expanded: boolean;
  showCompleted: boolean;
}

interface MonitorState {
  context: MonitorContext | null;
  prefs: Store<Prefs> | null;
  setPrefs:
    | ((mutation: (draft: Prefs) => void) => Promise<void>)
    | null;
}

// Plugin-scoped state (one instance per TUI).
const state: MonitorState = { context: null, prefs: null, setPrefs: null };

const [tick, setTick] = createSignal(0);
const [focused, setFocused] = createSignal(false);
const [cursor, setCursor] = createSignal(0);
const [activeSessionID, setActiveSessionID] = createSignal<
  string | undefined
>(undefined);

let lastRefreshAt = 0;

// Coalesce the flood of server events into at most one recompute per frame
// budget.
function requestRefresh(): void {
  const now = Date.now();
  if (now - lastRefreshAt < REFRESH_COALESCE_MS) return;
  lastRefreshAt = now;
  setTick((value) => value + 1);
}

function toV2Session(
  session:
    | (V2Session & {
        parentID?: string;
        title?: string;
        agent?: string;
      })
    | undefined,
): V2Session | undefined {
  if (!session) return undefined;
  return {
    id: session.id,
    parentID: session.parentID,
    title: session.title,
    agent: session.agent,
    outcome: session.outcome,
    tokens: session.tokens,
    time: session.time,
  };
}

function childrenOf(sessionID: string | undefined): V2Session[] {
  const context = state.context;
  tick(); // recompute when the refresh signal changes
  if (!context || !sessionID) return [];
  try {
    return (context.data.session.family(sessionID) ?? [])
      .map((id) => toV2Session(context.data.session.get(id)))
      .filter(
        (session): session is V2Session =>
          Boolean(session && session.parentID),
      )
      .sort((a, b) => byPriority(a, b));
  } catch {
    return [];
  }
}

function allSubagents(): V2Session[] {
  const context = state.context;
  tick();
  if (!context) return [];
  try {
    return (context.data.session.list() ?? [])
      .map((session) => toV2Session(session))
      .filter(
        (session): session is V2Session =>
          Boolean(session && session.parentID),
      );
  } catch {
    return [];
  }
}

// --- theme token resolution with safe fallbacks ---
// Theme tokens resolve to RGBA objects ({ buffer: [r, g, b, a] }), not CSS
// strings. Passing the raw object to `fg` degrades every colour to the
// terminal default, so convert to hex and only then fall back.
function colorToHex(value: unknown): string | undefined {
  if (typeof value === "string") return value;
  const record = value as { buffer?: unknown } | undefined;
  const buffer = record?.buffer;
  if (!Array.isArray(buffer)) return undefined;
  const pair = (channel: unknown): string =>
    Math.max(0, Math.min(255, Math.round(Number(channel) || 0)))
      .toString(16)
      .padStart(2, "0");
  return `#${pair(buffer[0])}${pair(buffer[1])}${pair(buffer[2])}`;
}

function resolveFg(
  context: MonitorContext | null,
  tokenPath: string,
  fallback: string,
): string {
  try {
    const value = tokenPath
      .split(".")
      .reduce<unknown>(
        (acc, key) =>
          (acc as Record<string, unknown> | undefined)?.[key],
        context?.theme,
      );
    return colorToHex(value) ?? fallback;
  } catch {
    return fallback;
  }
}

function fgFor(session: V2Session): string {
  switch (deriveStatus(session)) {
    case "running":
      return resolveFg(state.context, "text.feedback.warning.default", "#ffcb6b");
    case "stale":
      return resolveFg(state.context, "hue.purple.200", "#c792ea");
    case "error":
      return resolveFg(state.context, "text.feedback.error.default", "#f07178");
    case "done":
      return resolveFg(state.context, "text.feedback.success.default", "#c3e88d");
    default:
      return resolveFg(state.context, "text.subdued", "#546e7a");
  }
}

// --- keymap layer (must be owned by a component, not by setup) ---

function commandsFor(context: MonitorContext): KeymapCommand[] {
  const openCursor = () => {
    if (!focused()) return false;
    const target = childrenOf(activeSessionID())[cursor()];
    if (!target) return;
    context.ui.router.navigate({ type: "session", sessionID: target.id });
  };

  const mutatePrefs = (mutation: (draft: Prefs) => void): void => {
    if (!state.setPrefs) return;
    void state.setPrefs(mutation).catch(() => {});
  };

  return [
    {
      id: `${PLUGIN_ID}.focus`,
      title: "Toggle subagent list focus",
      group: "Subagents",
      bind: "alt+b",
      palette: true,
      run: () => {
        setFocused((value) => !value);
      },
    },
    {
      id: `${PLUGIN_ID}.up`,
      bind: "k",
      run: () => {
        if (!focused()) return false;
        setCursor((value) => Math.max(0, value - 1));
      },
    },
    {
      id: `${PLUGIN_ID}.down`,
      bind: "j",
      run: () => {
        if (!focused()) return false;
        setCursor((value) => value + 1);
      },
    },
    {
      id: `${PLUGIN_ID}.open`,
      bind: "enter",
      run: openCursor,
    },
    {
      id: `${PLUGIN_ID}.history`,
      title: "Toggle completed subagent history",
      group: "Subagents",
      bind: "c",
      run: () => {
        if (!focused()) return false;
        mutatePrefs((draft) => {
          draft.showCompleted = !draft.showCompleted;
        });
      },
    },
    {
      id: `${PLUGIN_ID}.collapse`,
      title: "Collapse subagent monitor",
      group: "Subagents",
      bind: "h",
      run: () => {
        if (!focused()) return false;
        mutatePrefs((draft) => {
          draft.expanded = false;
        });
      },
    },
    {
      id: `${PLUGIN_ID}.expand`,
      title: "Expand subagent monitor",
      group: "Subagents",
      bind: "l",
      run: () => {
        if (!focused()) return false;
        mutatePrefs((draft) => {
          draft.expanded = true;
        });
      },
    },
    {
      id: `${PLUGIN_ID}.unfocus`,
      bind: "escape",
      run: () => {
        if (!focused()) return false;
        setFocused(false);
      },
    },
  ];
}

// `context.keymap.layer` resolves a Solid context owned by the calling
// component, so it can only run inside a mounted component body — never inside
// setup().
function useKeymapLayer(context: MonitorContext): void {
  try {
    context.keymap.layer(() => ({
      mode: "global",
      priority: 100,
      commands: commandsFor(context),
    }));
  } catch {
    // Shortcuts stay unavailable when the host has no keymap provider mounted yet.
  }
}

// --- components ---

function SidebarSubagents(props: { sessionID: string }) {
  const context = usePlugin();

  useKeymapLayer(context);

  createEffect(() => {
    const sessionID = props.sessionID;
    if (!sessionID) return;
    setActiveSessionID(sessionID);
    context.data.session.sync(sessionID).catch(() => {});
    requestRefresh();
  });

  const [now, setNow] = createSignal(Date.now());
  createEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), ELAPSED_TICK_MS);
    onCleanup(() => clearInterval(timer));
  });

  const items = createMemo(() => childrenOf(props.sessionID));
  const visible = createMemo(() =>
    maxCandidates(items(), state.prefs?.showCompleted ?? false, MAX_DONE_ROWS),
  );

  createEffect(() => {
    const length = visible().length;
    if (length > 0 && cursor() >= length) setCursor(length - 1);
  });

  const counts = createMemo(() => {
    let running = 0;
    let stale = 0;
    let done = 0;
    let failed = 0;
    for (const session of items()) {
      switch (deriveStatus(session)) {
        case "done":
          done += 1;
          break;
        case "error":
          failed += 1;
          break;
        case "stale":
          stale += 1;
          break;
        default:
          running += 1;
      }
    }
    return { running, stale, done, failed };
  });

  const headerColor = resolveFg(context, "text.default", "#eeffff");
  const subdued = resolveFg(context, "text.subdued", "#546e7a");
  const selected = resolveFg(context, "text.action.primary.selected", "#82aaff");
  const runningColor = resolveFg(context, "text.feedback.warning.default", "#ffcb6b");
  const doneColor = resolveFg(context, "text.feedback.success.default", "#c3e88d");
  const failedColor = resolveFg(context, "text.feedback.error.default", "#f07178");
  const staleColor = resolveFg(context, "hue.purple.200", "#c792ea");

  // V1 parity: the header works as a clickable tab that collapses/expands the
  // subagent list without requiring keyboard focus (mirrors `onToggleExpanded`).
  const toggleExpanded = (): void => {
    if (!state.setPrefs) return;
    void state
      .setPrefs((draft) => {
        draft.expanded = !draft.expanded;
      })
      .catch(() => {});
  };

  // Always rendered, even with zero subagents: the monitor keeps a visible
  // sidebar presence and the counters stay readable at a glance.
  return (
    <box flexDirection="column" paddingX={1} paddingY={1}>
      <box flexDirection="row" onMouseDown={toggleExpanded}>
        <text fg={headerColor}>
          {`${state.prefs?.expanded ? SIDEBAR_ARROW_EXPANDED : SIDEBAR_ARROW_COLLAPSED} Subagents`}
        </text>
        <Show when={focused()}>
          <text fg={selected}>{` ${FOCUS_INDICATOR}`}</text>
        </Show>
      </box>
      <box flexDirection="row">
        <text fg={runningColor}>{`● ${counts().running} run`}</text>
        <text fg={subdued}>{" · "}</text>
        <text fg={doneColor}>{`✓ ${counts().done} done`}</text>
        <text fg={subdued}>{" · "}</text>
        <text fg={failedColor}>{`✕ ${counts().failed} err`}</text>
      </box>
      <Show when={counts().stale > 0}>
        <text fg={staleColor}>{`◐ ${counts().stale} stale`}</text>
      </Show>
      <Show when={state.prefs?.expanded}>
        <For each={visible()}>
          {(item, i) => {
            const labelLines = () => wrapLabel(labelFor(item), LABEL_WIDTH, 2);
            const isCursor = () => focused() && cursor() === i();
            return (
              <box flexDirection="column">
                <box flexDirection="row">
                  <text fg={isCursor() ? selected : subdued}>
                    {isCursor() ? CURSOR_MARKER : " "}
                  </text>
                  <text fg={fgFor(item)}>{`${statusMarker(item)} `}</text>
                  <text fg={isCursor() ? headerColor : fgFor(item)}>
                    {labelLines()[0] ?? ""}
                  </text>
                </box>
                <Show when={(labelLines()[1] ?? "") !== ""}>
                  <text fg={isCursor() ? headerColor : fgFor(item)}>
                    {`${LABEL_INDENT}${labelLines()[1]}`}
                  </text>
                </Show>
                <text fg={isCursor() ? headerColor : subdued}>
                  {metaFor(item, now())}
                </text>
              </box>
            );
          }}
        </For>
      </Show>
      <Show when={focused()}>
        <text fg={subdued}>{"j/k · enter · c · h/l · esc"}</text>
      </Show>
    </box>
  );
}

function FooterSummary() {
  const all = createMemo(() => allSubagents());
  const busyCount = createMemo(
    () => all().filter((session) => isBusy(session)).length,
  );
  const failedCount = createMemo(
    () => all().filter((session) => deriveStatus(session) === "error").length,
  );
  const doneCount = createMemo(
    () => all().filter((session) => deriveStatus(session) === "done").length,
  );
  const summary = createMemo(() => {
    if (busyCount() + doneCount() + failedCount() === 0) return "";
    return `↳ ${busyCount()} run · ${doneCount()} done · ${failedCount()} err`;
  });

  const info = resolveFg(state.context, "text.feedback.warning.default", "#ffcb6b");
  const error = resolveFg(state.context, "text.feedback.error.default", "#f07178");

  return (
    <Show when={summary() !== ""}>
      <text fg={failedCount() > 0 ? error : info}>{summary()}</text>
    </Show>
  );
}

// --- plugin entry ---

export default Plugin.define({
  id: PLUGIN_ID,
  setup(context) {
    state.context = context;

    const [prefs, setPrefs] = context.storage.store<Prefs>("prefs", {
      initial: { expanded: true, showCompleted: false },
    });
    state.prefs = prefs;
    state.setPrefs = setPrefs;

    const stopEvents = context.data.listen(() => {
      requestRefresh();
    });

    // Claims appended to `sidebar.content` land after the host's built-in
    // sections; the subagent list is this plugin's only sidebar contribution.
    const releaseSidebar = context.ui.slot({
      append: "sidebar.content",
      render: (input) => <SidebarSubagents sessionID={input.sessionID} />,
    });

    const releaseFooter = context.ui.slot({
      append: "home.footer.status",
      render: () => <FooterSummary />,
    });

    requestRefresh();

    return () => {
      stopEvents?.();
      releaseSidebar?.();
      releaseFooter?.();
      state.context = null;
      state.prefs = null;
      state.setPrefs = null;
    };
  },
});