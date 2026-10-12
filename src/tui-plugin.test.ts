import { describe, expect, it } from "vitest";
import * as tuiPlugin from "./tui-plugin.js";

describe("TUI plugin entrypoint", () => {
  it("exposes only the default plugin export", () => {
    expect(Object.keys(tuiPlugin)).toEqual(["default"]);
  });
});
