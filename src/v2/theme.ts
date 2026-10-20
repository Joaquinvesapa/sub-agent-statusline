/**
 * Theme color resolution for the V2 subagent monitor.
 *
 * `context.theme` is an `@opencode/theme` ResolvedTheme whose leaves are
 * `@opentui/core` RGBA instances. `fg` accepts `string | RGBA` and opentui's
 * `parseColor` passes RGBA values through unchanged, so a resolved token is
 * handed to `fg` as-is (keeping indexed/default color intents). Hex fallbacks
 * only apply when a token is missing or the theme is not ready.
 */
import type { ColorInput } from "@opentui/core";

export interface ThemeToken {
  path: string;
  fallback: string;
}

// Token paths follow the ResolvedTheme shape: stateful colors expose `base`
// plus action states (`selected`, ...); there is no raw hue palette.
export const THEME_TOKENS = {
  header: { path: "text.base", fallback: "#eeffff" },
  muted: { path: "text.muted", fallback: "#546e7a" },
  selected: { path: "text.action.primary.selected", fallback: "#82aaff" },
  running: { path: "text.feedback.warning.base", fallback: "#ffcb6b" },
  done: { path: "text.feedback.success.base", fallback: "#c3e88d" },
  error: { path: "text.feedback.error.base", fallback: "#f07178" },
  stale: { path: "text.feedback.info.base", fallback: "#c792ea" },
} as const satisfies Record<string, ThemeToken>;

function isColor(value: unknown): value is ColorInput {
  if (typeof value === "string") return value.length > 0;
  if (typeof value !== "object" || value === null) return false;
  // Duck-typed: the host may load its own copy of @opentui/core, so an
  // `instanceof RGBA` check against this bundle's import is not reliable.
  const buffer = (value as { buffer?: unknown }).buffer;
  return ArrayBuffer.isView(buffer) || Array.isArray(buffer);
}

export function resolveColor(
  theme: unknown,
  tokenPath: string,
  fallback: string,
): ColorInput {
  try {
    const value = tokenPath
      .split(".")
      .reduce<unknown>(
        (acc, key) => (acc as Record<string, unknown> | undefined)?.[key],
        theme,
      );
    return isColor(value) ? value : fallback;
  } catch {
    return fallback;
  }
}
