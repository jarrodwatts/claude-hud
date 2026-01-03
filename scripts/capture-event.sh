#!/bin/bash
set -uo pipefail

INPUT=$(cat)

PLUGIN_ROOT="${CLAUDE_PLUGIN_ROOT:-$(dirname "$0")/..}"

# Source terminal ID helper
source "$PLUGIN_ROOT/scripts/lib/terminal-id.sh"
# Source preflight helper
source "$PLUGIN_ROOT/scripts/lib/preflight.sh"
TERMINAL_ID=$(get_terminal_id)

if ! command -v jq &>/dev/null; then
  hud_preflight "" "$TERMINAL_ID" "$PLUGIN_ROOT" "log"
  exit 0
fi

if ! echo "$INPUT" | jq empty 2>/dev/null; then
  exit 0
fi

SESSION_ID=$(echo "$INPUT" | jq -r '.session_id // empty')
if [[ -z "$SESSION_ID" || ! "$SESSION_ID" =~ ^[a-zA-Z0-9_-]+$ ]]; then
  exit 0
fi

HUD_DIR="$HOME/.claude/hud"
hud_preflight "$SESSION_ID" "$TERMINAL_ID" "$PLUGIN_ROOT" "log" || true

# Terminal-scoped refresh file
REFRESH_FILE="$HUD_DIR/refresh-$TERMINAL_ID.json"

# Session-scoped FIFO
EVENT_FIFO="$HUD_DIR/events/$SESSION_ID.fifo"

mkdir -p "$HUD_DIR/events"

# Atomic FIFO creation: mkfifo fails if file exists, which is fine
# We avoid rm -f to prevent TOCTOU race when multiple events fire simultaneously
if [ ! -p "$EVENT_FIFO" ]; then
  # Remove any non-pipe file at this path first
  [ -e "$EVENT_FIFO" ] && rm -f "$EVENT_FIFO"
  mkfifo -m 600 "$EVENT_FIFO" 2>/dev/null || [ -p "$EVENT_FIFO" ] || true
fi

# Ensure refresh file points at this session in case SessionStart didn't fire.
CURRENT_SESSION=$(jq -r '.sessionId // empty' "$REFRESH_FILE" 2>/dev/null)
TRANSCRIPT_PATH=$(echo "$INPUT" | jq -r '.transcript_path // empty')
if [ -z "$CURRENT_SESSION" ] || [ "$CURRENT_SESSION" != "$SESSION_ID" ]; then
  if [ -n "$TRANSCRIPT_PATH" ]; then
    cat > "$REFRESH_FILE" << EOF
{"sessionId":"$SESSION_ID","fifoPath":"$EVENT_FIFO","terminalId":"$TERMINAL_ID","transcriptPath":"$TRANSCRIPT_PATH"}
EOF
  else
    cat > "$REFRESH_FILE" << EOF
{"sessionId":"$SESSION_ID","fifoPath":"$EVENT_FIFO","terminalId":"$TERMINAL_ID"}
EOF
  fi
  CURRENT_SESSION="$SESSION_ID"
fi

# Update refresh file with transcriptPath when available (for session resume)
if [ -n "$TRANSCRIPT_PATH" ] && [ -f "$REFRESH_FILE" ]; then
  # Only update if this session matches the current refresh file session
  if [ "$CURRENT_SESSION" = "$SESSION_ID" ]; then
    jq --arg tp "$TRANSCRIPT_PATH" '.transcriptPath = $tp' "$REFRESH_FILE" > "$REFRESH_FILE.tmp" && mv "$REFRESH_FILE.tmp" "$REFRESH_FILE"
  fi
fi

if [ -p "$EVENT_FIFO" ]; then
  EVENT_JSON=$(echo "$INPUT" | jq -c '{
    schemaVersion: 1,
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
  }' 2>/dev/null) || true

  if [ -n "$EVENT_JSON" ]; then
    # Non-blocking write using read-write mode (prevents blocking on unread FIFOs)
    exec 3<>"$EVENT_FIFO" 2>/dev/null && {
      echo "$EVENT_JSON" >&3 2>/dev/null || true
      exec 3>&-
    } || true
  fi
fi

exit 0
