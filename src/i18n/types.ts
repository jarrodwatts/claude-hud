export type MessageKey =
  // Labels
  | "label.context"
  | "label.usage"
  | "label.weekly"
  | "label.approxRam"
  | "label.rules"
  | "label.hooks"
  | "label.estimatedCost"
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
  // Init
  | "init.initializing"
  | "init.macosNote";

export type Messages = Record<MessageKey, string>;

export type Language = "en" | "zh";
