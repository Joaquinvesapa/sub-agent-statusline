/**
 * Row formatting for the V2 subagent monitor.
 *
 * All width/ellipsize helpers are reused from the shared `../text-width.ts`
 * module so the V1 and V2 entries stay consistent on column math.
 */
import { takeColumns, textColumns, truncateToColumns } from "../text-width.js";
import { deriveStatus, type V2Session } from "./reconcile.js";

export const SIDEBAR_ROW_WIDTH = 34;
export const LABEL_WIDTH = SIDEBAR_ROW_WIDTH - 5;
export const LABEL_INDENT = "    ";

// Nerd Font glyphs, same codepoints the V1 plugin used for the elapsed-time
// and token markers (clock U+F017, coins U+F51E).
export const CLOCK_ICON = "\u{f017}";
export const TOKEN_ICON = "\u{f51e}";
export const SIDEBAR_ARROW_EXPANDED = "▼";
export const SIDEBAR_ARROW_COLLAPSED = "▶";
export const FOCUS_INDICATOR = "●";
export const CURSOR_MARKER = "›";

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

export function resolveTokensTotal(session: V2Session): number | undefined {
  const tokens = session.tokens;
  if (!tokens) return undefined;
  const input = tokens.input;
  const output = tokens.output;
  if (typeof input === "number" || typeof output === "number") {
    return Math.max(0, (input ?? 0) + (output ?? 0));
  }
  return undefined;
}

/** Compact token count: `1.2M tok` at or above a million, raw otherwise. */
export function tokensFor(session: V2Session): string | undefined {
  const tokens = resolveTokensTotal(session);
  if (tokens === undefined || tokens <= 0) return undefined;
  if (tokens >= 1_000_000) return `${(tokens / 1_000_000).toFixed(1)}M tok`;
  return `${formatNumber(tokens)} tok`;
}

/** Original V1 row markers: bracketed checkboxes per derived status. */
export function statusMarker(session: V2Session): string {
  switch (deriveStatus(session)) {
    case "done":
      return "[✓]";
    case "error":
      return "[x]";
    case "stale":
      return "[~]";
    default:
      return "[ ]";
  }
}

/**
 * Original V1 row shape: the child session title is the primary text and the
 * agent name is the trailing parenthetical, e.g. "Fix the login bug (explore)".
 * V2 titles already carry an agent tag, so only append when it is missing.
 */
export function labelFor(session: V2Session): string {
  const title = typeof session.title === "string" ? session.title.trim() : "";
  const agent = typeof session.agent === "string" ? session.agent.trim() : "";
  const hasAgent = agent.length > 0 && agent !== "code";
  const mentionsAgent =
    hasAgent && title.toLowerCase().includes(agent.toLowerCase());
  if (title && hasAgent && !mentionsAgent) return `${title} (${agent})`;
  if (title) return title;
  return hasAgent ? agent : "subagent";
}

/**
 * A terminal outcome is recorded at `time.idle`, so prefer it for the end of a
 * finished run and fall back to `time.updated` only for legacy rows. Using
 * `time.updated` on its own rendered `00:00` for every finished V2 session,
 * because V2 rows write created/updated within milliseconds of each other.
 */
export function elapsedFor(session: V2Session, now: number): string {
  const end = session.outcome
    ? (session.time?.idle ?? session.time?.updated ?? now)
    : now;
  return formatDuration(end - (session.time?.created ?? now));
}

/** Original V1 meta line, indented under the label: "↳ <clock> MM:SS <coins> tok". */
export function metaFor(session: V2Session, now: number): string {
  const parts = [`↳ ${CLOCK_ICON} ${elapsedFor(session, now)}`];
  const tokens = tokensFor(session);
  if (tokens) parts.push(`${TOKEN_ICON} ${tokens}`);
  return `${LABEL_INDENT}${parts.join(" ")}`;
}

export function ellipsize(value: string, width: number): string {
  return truncateToColumns(value, width);
}

/** Word-aware label wrapping with a hard ellipsis on the final line. */
export function wrapLabel(
  value: string | undefined,
  width: number,
  maxLines: number,
): string[] {
  const normalized = String(value ?? "").replace(/\s+/g, " ").trim();
  if (!normalized) return [""];

  const lines: string[] = [];
  let remaining = normalized;

  while (textColumns(remaining) > width && lines.length < maxLines - 1) {
    const probe = takeColumns(remaining, width);
    const breakAt = probe.lastIndexOf(" ");
    const cut = breakAt > 0 ? breakAt : probe.length;
    if (cut <= 0) break;
    lines.push(remaining.slice(0, cut).trimEnd());
    remaining = remaining.slice(cut).trimStart();
  }

  lines.push(
    lines.length === maxLines - 1
      ? ellipsize(remaining, Math.max(1, width))
      : remaining,
  );
  return lines;
}