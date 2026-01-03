---
description: Configure claude-hud as your statusline
---

Add statusLine configuration to ~/.claude/settings.json.

The command value must be exactly: `node $` + `{CLAUDE_PLUGIN_ROOT}` + `/dist/index.js`

This creates the literal string `node ${CLAUDE_PLUGIN_ROOT}/dist/index.js` - Claude Code resolves this variable at runtime.

```json
{
  "statusLine": {
    "type": "command",
    "command": "node ${CLAUDE_PLUGIN_ROOT}/dist/index.js"
  }
}
```

DO NOT resolve the variable to an absolute path. Write it exactly as shown with the dollar sign and braces.

Merge with existing settings. Do not overwrite other fields.

After updating, confirm success. The HUD appears immediately - no restart needed.
