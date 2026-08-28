import type { Messages } from "./types.js";

export const en: Messages = {
  // Labels
  "label.context": "Context",
  "label.usage": "Usage",
  "label.weekly": "Weekly",
  "label.approxRam": "Approx RAM",
  "label.promptCache": "Cache",
  "label.rules": "rules",
  "label.hooks": "hooks",
  "label.estimatedCost": "Est.",
  "label.cost": "Cost",
  "label.today": "Today",
  "label.tokens": "Tokens",
  "label.sessionStarted": "Started",
  "label.lastReply": "Last reply",
  "label.advisor": "Advisor",
  "label.compactions": "Compactions",

  // Status
  "status.limitReached": "Limit reached",
  "status.allTodosComplete": "All todos complete",
  "status.expired": "expired",

  // Format
  "format.resets": "resets",
  "format.resetsIn": "resets in",
  "format.absoluteTime": "at {time}",
  "format.untilTime": "until {time}",
  "format.in": "in",
  "format.cache": "cache",
  "format.out": "out",
  "format.tok": "tok",
  "format.tokPerSec": "tok/s",
  "format.justNow": "just now",
  "format.relativeTime": "{value} ago",

  // Init
  "init.initializing": "[claude-hud] Initializing...",
  "init.macosNote":
    "[claude-hud] Note: On macOS, you may need to restart Claude Code for the HUD to appear.",
};
