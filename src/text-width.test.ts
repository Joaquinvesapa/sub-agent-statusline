import { describe, expect, it } from "vitest";
import { takeColumns, textColumns, truncateToColumns } from "./text-width.js";

describe("textColumns", () => {
  it("counts Japanese full-width characters as two terminal columns", () => {
    expect(textColumns("日本語summary")).toBe(13);
  });

  it("does not count combining marks as extra terminal columns", () => {
    expect(textColumns("e\u0301")).toBe(1);
  });
});

describe("takeColumns", () => {
  it("keeps returned text within the requested terminal column budget", () => {
    expect(takeColumns("日本語summary", 6)).toBe("日本語");
    expect(textColumns(takeColumns("日本語summary", 7))).toBeLessThanOrEqual(7);
  });
});

describe("truncateToColumns", () => {
  it("truncates Japanese text by terminal columns instead of string length", () => {
    const result = truncateToColumns("日本語の概要を表示しています", 10);

    expect(result).toBe("日本語の…");
    expect(textColumns(result)).toBeLessThanOrEqual(10);
  });

  it("leaves text unchanged when its terminal column width fits", () => {
    expect(truncateToColumns("日本語", 6)).toBe("日本語");
  });
});
