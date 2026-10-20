import { describe, expect, it } from "vitest";
import { RGBA } from "@opentui/core";
import { THEME_TOKENS, resolveColor } from "./theme.js";

// Shape of the slice of `@opencode/theme` ResolvedTheme the monitor reads.
function theme() {
  return {
    text: {
      base: RGBA.fromHex("#111111"),
      muted: RGBA.fromHex("#222222"),
      action: {
        primary: {
          base: RGBA.fromHex("#333333"),
          selected: RGBA.fromHex("#444444"),
        },
      },
      feedback: {
        success: { base: RGBA.fromHex("#555555") },
        warning: { base: RGBA.fromHex("#666666") },
        error: { base: RGBA.fromHex("#777777") },
        info: { base: RGBA.fromHex("#888888") },
      },
    },
  };
}

describe("resolveColor", () => {
  it("returns the theme RGBA object itself, not the fallback", () => {
    const resolved = theme();
    expect(resolveColor(resolved, "text.base", "#eeffff")).toBe(
      resolved.text.base,
    );
  });

  it("resolves every monitor token against a ResolvedTheme-shaped object", () => {
    const resolved = theme();
    for (const [name, token] of Object.entries(THEME_TOKENS)) {
      const color = resolveColor(resolved, token.path, token.fallback);
      expect(color, name).toBeInstanceOf(RGBA);
    }
  });

  it("falls back for a missing token path", () => {
    expect(resolveColor(theme(), "hue.purple.200", "#c792ea")).toBe("#c792ea");
    expect(resolveColor(undefined, "text.base", "#eeffff")).toBe("#eeffff");
  });

  it("passes through string colors", () => {
    expect(resolveColor({ text: { base: "#abcdef" } }, "text.base", "#000000")).toBe(
      "#abcdef",
    );
  });

  it("falls back for values that are not colors", () => {
    expect(resolveColor({ text: { base: { base: 1 } } }, "text.base", "#000000")).toBe(
      "#000000",
    );
    expect(resolveColor({ text: { base: 42 } }, "text.base", "#000000")).toBe(
      "#000000",
    );
  });

  it("falls back when reading the theme throws", () => {
    const hostile = {
      get text(): never {
        throw new Error("theme not ready");
      },
    };
    expect(resolveColor(hostile, "text.base", "#eeffff")).toBe("#eeffff");
  });
});
