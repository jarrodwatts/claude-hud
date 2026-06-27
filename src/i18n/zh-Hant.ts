import type { Messages } from "./types.js";

export const zhHant: Messages = {
  // Labels
  "label.context": "上下文",
  "label.usage": "用量",
  "label.weekly": "本週",
  "label.approxRam": "記憶體",
  "label.promptCache": "快取",
  "label.rules": "規則",
  "label.hooks": "Hook",
  "label.estimatedCost": "估算",
  "label.cost": "費用",
  "label.tokens": "Token",
  "label.sessionStarted": "開始",
  "label.lastReply": "上次回覆",
  "label.advisor": "顧問",
  "label.compactions": "壓縮次數",

  // Status
  "status.limitReached": "已達上限",
  "status.allTodosComplete": "全部完成",
  "status.expired": "已過期",

  // Format
  "format.resets": "重置於",
  "format.resetsIn": "重置剩餘",
  "format.absoluteTime": "{time}",
  "format.in": "輸入",
  "format.cache": "快取",
  "format.out": "輸出",
  "format.tok": "tok",
  "format.tokPerSec": "tok/s",
  "format.justNow": "剛剛",
  "format.relativeTime": "{value} 前",

  // Init
  "init.initializing": "[claude-hud] 正在初始化...",
  "init.macosNote":
    "[claude-hud] 注意：在 macOS 上，您可能需要重新啟動 Claude Code 才能顯示 HUD。",
};
