export type MessageKey =
  // Labels
  | "label.context"
  | "label.usage"
  | "label.weekly"
  | "label.approxRam"
  | "label.rules"
  | "label.hooks"
  | "label.estimatedCost"
  | "label.cacheHitRate"
  | "label.avg"
  // Status
  | "status.limitReached"
  | "status.allTodosComplete"
  // Format
  | "format.resets"
  | "format.resetsIn"
  | "format.in"
  | "format.cache"
  | "format.out"
  | "format.tokPerSec"
  | "format.currentIn"
  | "format.currentOut"
  | "format.currentCache"
  | "format.currentCacheHitRate"
  | "format.totalIn"
  | "format.totalOut"
  | "format.totalCache"
  // Init
  | "init.initializing"
  | "init.macosNote";

export type Messages = Record<MessageKey, string>;

export type Language = "en" | "zh";
