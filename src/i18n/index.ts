import type { Language, MessageKey, Messages } from "./types.js";
import { en } from "./en.js";
import { zhHans } from "./zh-Hans.js";

export type { Language, MessageKey, Messages };

type CanonicalLanguage = "en" | "zh-Hans";

const locales: Record<CanonicalLanguage | "zh", Messages> = {
  en,
  zh: zhHans,
  "zh-Hans": zhHans,
};

// Resolve short language tags to canonical BCP 47 forms.
// Based on CLDR likely subtags: zh → zh-Hans-CN
// https://www.unicode.org/cldr/charts/latest/supplemental/likely_subtags.html
const CANONICAL: Record<Language, CanonicalLanguage> = {
  "en": "en",
  "zh": "zh-Hans",
  "zh-Hans": "zh-Hans",
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
  return getCanonicalLanguage() === "zh-Hans";
}

export function t(key: MessageKey): string {
  const canon = getCanonicalLanguage();
  return locales[canon]?.[key] ?? locales.en[key] ?? key;
}
