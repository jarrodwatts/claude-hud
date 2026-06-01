import type { Language, MessageKey, Messages } from "./types.js";
export type { Language, MessageKey, Messages };
type CanonicalLanguage = "en" | "zh-Hans" | "zh-Hant";
export declare function setLanguage(lang: Language): void;
export declare function getLanguage(): Language;
export declare function getCanonicalLanguage(): CanonicalLanguage;
export declare function isCjkLanguage(): boolean;
export declare function t(key: MessageKey): string;
//# sourceMappingURL=index.d.ts.map