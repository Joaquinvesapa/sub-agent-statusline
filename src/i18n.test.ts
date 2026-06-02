import { describe, it, expect } from "vitest";
import { t, detectSystemLocale, type Locale } from "./i18n.js";

describe("i18n", () => {
  describe("detectSystemLocale", () => {
    it("returns 'es' when LANG environment starts with 'es'", () => {
      const original = process.env.LANG;
      process.env.LANG = "es_ES.UTF-8";
      const result = detectSystemLocale();
      if (original !== undefined) process.env.LANG = original;
      else delete process.env.LANG;
      expect(result).toBe("es");
    });

    it("returns 'en' when LANG environment starts with 'en'", () => {
      const original = process.env.LANG;
      process.env.LANG = "en_US.UTF-8";
      const result = detectSystemLocale();
      if (original !== undefined) process.env.LANG = original;
      else delete process.env.LANG;
      expect(result).toBe("en");
    });

    it("returns 'en' as fallback for unsupported locales", () => {
      const original = process.env.LANG;
      process.env.LANG = "ja_JP.UTF-8";
      const result = detectSystemLocale();
      if (original !== undefined) process.env.LANG = original;
      else delete process.env.LANG;
      expect(result).toBe("en");
    });

    it("returns 'en' when no LANG env var is set", () => {
      const original = process.env.LANG;
      delete process.env.LANG;
      const result = detectSystemLocale();
      if (original !== undefined) process.env.LANG = original;
      expect(result).toBe("en");
    });
  });

  describe("t()", () => {
    it("returns translated string for 'subagents' key", () => {
      const result = t("subagents");
      expect(typeof result).toBe("string");
      expect(result.length).toBeGreaterThan(0);
    });
  });
});