export type MessageKey =
  // Labels
  | "label.context"
  | "label.usage"
  | "label.weekly"
  | "label.approxRam"
  | "label.promptCache"
  | "label.rules"
  | "label.hooks"
  | "label.estimatedCost"
  | "label.cost"
  | "label.tokens"
  | "label.sessionStarted"
  | "label.lastReply"
  // Status
  | "status.limitReached"
  | "status.allTodosComplete"
  | "status.expired"
  // Format
  | "format.resets"
  | "format.resetsIn"
  | "format.at"
  | "format.in"
  | "format.cache"
  | "format.out"
  | "format.tok"
  | "format.tokPerSec"
  | "format.justNow"
  | "format.ago"
  // Init
  | "init.initializing"
  | "init.macosNote";

export type Messages = Record<MessageKey, string>;

export type Language = "en" | "zh" | "zh-Hans";
