#!/bin/bash
set -uo pipefail

command -v jq &>/dev/null || { echo "jq required" >&2; exit 1; }

INPUT=$(cat)

if ! echo "$INPUT" | jq empty 2>/dev/null; then
  exit 1
fi

SESSION_ID=$(echo "$INPUT" | jq -r '.session_id // empty')
if [[ -z "$SESSION_ID" || ! "$SESSION_ID" =~ ^[a-zA-Z0-9_-]+$ ]]; then
  exit 1
fi

PLUGIN_ROOT="${CLAUDE_PLUGIN_ROOT:-$(dirname "$0")/..}"
HUD_DIR="$HOME/.claude/hud"

# Source terminal ID helper
source "$PLUGIN_ROOT/scripts/lib/terminal-id.sh"
# Source preflight helper
source "$PLUGIN_ROOT/scripts/lib/preflight.sh"
TERMINAL_ID=$(get_terminal_id)

# Terminal-scoped files (one HUD per terminal window)
PID_FILE="$HUD_DIR/pids/$TERMINAL_ID.pid"
REFRESH_FILE="$HUD_DIR/refresh-$TERMINAL_ID.json"

# Session-scoped FIFO (each session has its own event stream)
EVENT_FIFO="$HUD_DIR/events/$SESSION_ID.fifo"
LOG_FILE="$HUD_DIR/logs/$SESSION_ID.log"

mkdir -p "$HUD_DIR/events" "$HUD_DIR/logs" "$HUD_DIR/pids"

rm -f "$EVENT_FIFO"
mkfifo "$EVENT_FIFO"

if ! hud_preflight "$SESSION_ID" "$TERMINAL_ID" "$PLUGIN_ROOT" "stderr"; then
  exit 0
fi

if [ ! -f "$PLUGIN_ROOT/tui/dist/index.js" ]; then
  echo "claude-hud build missing. Run 'bun install' and 'bun run build' in $PLUGIN_ROOT/tui." >&2
  exit 1
fi

if command -v bun &> /dev/null; then
  HUD_CMD="bun $PLUGIN_ROOT/tui/dist/index.js --session $SESSION_ID --fifo $EVENT_FIFO --terminal-id $TERMINAL_ID"
else
  HUD_CMD="node $PLUGIN_ROOT/tui/dist/index.js --session $SESSION_ID --fifo $EVENT_FIFO --terminal-id $TERMINAL_ID"
fi

find_existing_hud() {
  # Check if there's already a HUD for THIS terminal window
  if [ -f "$PID_FILE" ]; then
    local pid
    pid=$(cat "$PID_FILE" 2>/dev/null)
    if [ -n "$pid" ] && kill -0 "$pid" 2>/dev/null; then
      # Verify the process is still in a visible pane (tmux only)
      if [ -n "${TMUX:-}" ]; then
        # Check current window's panes only (not -a which is global)
        if tmux list-panes -F '#{pane_pid}' 2>/dev/null | grep -q "^${pid}$"; then
          echo "$pid"
          return 0
        fi
        # Process exists but not in current window - stale PID file
        rm -f "$PID_FILE"
        return 1
      fi
      # Non-tmux: trust the PID file if process is alive
      echo "$pid"
      return 0
    fi
    # PID file exists but process is dead - clean up
    rm -f "$PID_FILE"
  fi
  return 1
}

signal_existing_hud() {
  local pid="$1"
  # Write refresh file with new session info for THIS terminal
  cat > "$REFRESH_FILE" << EOF
{"sessionId":"$SESSION_ID","fifoPath":"$EVENT_FIFO","terminalId":"$TERMINAL_ID"}
EOF
  # Send SIGUSR1 to trigger refresh
  kill -USR1 "$pid" 2>/dev/null
}

launch_split_pane() {
  # Check for existing HUD in THIS terminal window - signal it to switch sessions
  local existing_pid
  existing_pid=$(find_existing_hud)
  if [ -n "$existing_pid" ]; then
    signal_existing_hud "$existing_pid"
    return 0
  fi

  # Write initial refresh file
  cat > "$REFRESH_FILE" << EOF
{"sessionId":"$SESSION_ID","fifoPath":"$EVENT_FIFO","terminalId":"$TERMINAL_ID"}
EOF

  # tmux - most reliable split pane support
  if [ -n "${TMUX:-}" ]; then
    tmux split-window -d -h -l 48 "$HUD_CMD" 2>/dev/null && {
      # Get PID of the new pane's process
      sleep 0.1
      local new_pid
      new_pid=$(tmux list-panes -F '#{pane_pid}' | tail -1)
      [ -n "$new_pid" ] && echo "$new_pid" > "$PID_FILE"
      return 0
    }
  fi

  # iTerm2 on macOS
  if [ "${TERM_PROGRAM:-}" = "iTerm.app" ]; then
    osascript -e "
      tell application \"iTerm2\"
        tell current session of current window
          split vertically with default profile command \"$HUD_CMD\"
        end tell
      end tell
    " 2>/dev/null && return 0
  fi

  # Kitty terminal
  if [ -n "${KITTY_PID:-}" ]; then
    kitty @ launch --location=vsplit --cwd=current $HUD_CMD 2>/dev/null && return 0
  fi

  # WezTerm
  if [ "${TERM_PROGRAM:-}" = "WezTerm" ]; then
    wezterm cli split-pane --right --percent 25 -- $HUD_CMD 2>/dev/null && return 0
  fi

  # Zellij
  if [ -n "${ZELLIJ:-}" ]; then
    zellij run -f -- $HUD_CMD 2>/dev/null && return 0
  fi

  # Windows Terminal (WSL)
  if [ -n "${WT_SESSION:-}" ]; then
    wt.exe -w 0 sp -H -s 0.25 wsl.exe $HUD_CMD 2>/dev/null && return 0
  fi

  # macOS Terminal.app - open in new window
  if [ "$(uname)" = "Darwin" ] && [ "${TERM_PROGRAM:-}" = "Apple_Terminal" ]; then
    osascript -e "
      tell application \"Terminal\"
        do script \"$HUD_CMD\"
        set bounds of front window to {100, 100, 500, 600}
      end tell
    " 2>/dev/null && return 0
  fi

  # Linux with xterm available - open in new window
  if [ "$(uname)" = "Linux" ] && command -v xterm &> /dev/null; then
    xterm -geometry 48x40 -e "$HUD_CMD" &
    echo $! > "$PID_FILE"
    return 0
  fi

  # Fallback: run in background with logging
  hud_bootstrap_log "split not available; running HUD in background (session=$SESSION_ID terminal=$TERMINAL_ID) log=$LOG_FILE"
  nohup $HUD_CMD > "$LOG_FILE" 2>&1 &
  echo $! > "$PID_FILE"
  return 0
}

launch_split_pane

exit 0
