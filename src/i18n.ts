/**
 * Internationalization module for subagent-statusline.
 *
 * Detects system locale and provides translation function.
 * Extend translations dictionary as new UI strings are added.
 */

export type Locale = "es" | "en";

const translations = {
  es: {
    subagents: "Subagentes",
  },
  en: {
    subagents: "Subagents",
  },
} as const;

export type TranslationKey = keyof (typeof translations)["en"];

// Cached locale to avoid repeated Intl calls
let _cachedLocale: Locale | null = null;

/**
 * Detects the system locale using Intl.DateTimeFormat.
 * Falls back to English if the system locale is not supported.
 */
export function detectSystemLocale(): Locale {
  // Check common environment variables as first fallback
  const envLang =
    process.env.LANG ??
    process.env.LC_ALL ??
    process.env.LANGUAGE ??
    Intl.DateTimeFormat().resolvedOptions().locale;

  const lang = envLang.toLowerCase();

  if (lang.startsWith("es")) return "es";
  return "en"; // default fallback
}

/**
 * Returns the current locale, caching the result after first call.
 */
export function getLocale(): Locale {
  if (_cachedLocale === null) {
    _cachedLocale = detectSystemLocale();
  }
  return _cachedLocale;
}

/**
 * Translates a key to the current locale.
 * Throws if the key is not found in translations.
 */
export function t(key: TranslationKey): string {
  const locale = getLocale();
  const translation = translations[locale][key];

  if (translation === undefined) {
    // Fallback to English if key missing in current locale
    const fallback = translations.en[key];
    if (fallback === undefined) {
      throw new Error(`Missing translation key: ${key}`);
    }
    return fallback;
  }

  return translation;
}