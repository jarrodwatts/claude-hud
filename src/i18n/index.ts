import type { Language, MessageKey, Messages } from "./types.js";
import { en } from "./en.js";
import { zhHans } from "./zh-Hans.js";
import { zhHant } from "./zh-Hant.js";

export type { Language, MessageKey, Messages };

type CanonicalLanguage = "en" | "zh-Hans" | "zh-Hant";

const locales: Record<CanonicalLanguage | "zh" | "zh-TW", Messages> = {
  en,
  zh: zhHans,
  "zh-Hans": zhHans,
  "zh-Hant": zhHant,
  "zh-TW": zhHant,
};

// Resolve short language tags to canonical BCP 47 forms.
// Based on CLDR likely subtags: zh → zh-Hans-CN
// https://www.unicode.org/cldr/charts/latest/supplemental/likely_subtags.html
const CANONICAL: Record<Language, CanonicalLanguage> = {
  "en": "en",
  "zh": "zh-Hans",
  "zh-Hans": "zh-Hans",
  "zh-Hant": "zh-Hant",
  "zh-TW": "zh-Hant",
};

let currentLanguage: Language = "en";

export function setLanguage(lang: Language): void {
  currentLanguage = lang;
}

export function getLanguage(): Language {
  return currentLanguage;
}

// https://www.rfc-editor.org/info/bcp47
export function getCanonicalLanguage(): CanonicalLanguage {
  return CANONICAL[currentLanguage] ?? "en";
}

// https://www.unicode.org/reports/tr11/
export function isCjkLanguage(): boolean {
  const canon = getCanonicalLanguage();
  return canon === "zh-Hans" || canon === "zh-Hant";
}

export function t(key: MessageKey): string {
  const canon = getCanonicalLanguage();
  return locales[canon]?.[key] ?? locales.en[key] ?? key;
}

// Minimal named-placeholder interpolation. Layout that varies by language
// (spacing, affix position) lives in each locale's pattern string rather than in
// render code. Unknown placeholders render as empty string (kept lenient).
export function interpolate(pattern: string, params: Record<string, string | number>): string {
  return pattern.replace(/\{(\w+)\}/g, (_, k) => String(params[k] ?? ""));
}
