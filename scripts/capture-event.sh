#!/bin/bash
set -uo pipefail

command -v jq &>/dev/null || exit 0

INPUT=$(cat)

if ! echo "$INPUT" | jq empty 2>/dev/null; then
  exit 0
fi

SESSION_ID=$(echo "$INPUT" | jq -r '.session_id // empty')
if [[ -z "$SESSION_ID" || ! "$SESSION_ID" =~ ^[a-zA-Z0-9_-]+$ ]]; then
  exit 0
fi

EVENT_FIFO="$HOME/.claude/hud/events/$SESSION_ID.fifo"

if [ -p "$EVENT_FIFO" ]; then
  echo "$INPUT" | jq -c '{
    event: .hook_event_name,
    tool: .tool_name,
    toolUseId: .tool_use_id,
    input: .tool_input,
    response: .tool_response,
    session: .session_id,
    permissionMode: .permission_mode,
    transcriptPath: .transcript_path,
    cwd: .cwd,
    prompt: .prompt,
    ts: (now | floor)
  }' >> "$EVENT_FIFO" 2>/dev/null || true
fi

exit 0
