#!/bin/bash
# Terminal identification for per-window HUD tracking
# Each terminal window gets its own HUD instance

get_terminal_id() {
  # tmux: use window ID (unique per window, survives pane splits)
  if [ -n "${TMUX:-}" ]; then
    local window_id
    window_id=$(tmux display-message -p '#{window_id}' 2>/dev/null)
    if [ -n "$window_id" ]; then
      echo "tmux-${window_id}"
      return 0
    fi
  fi

  # iTerm2: use session ID
  if [ -n "${ITERM_SESSION_ID:-}" ]; then
    echo "iterm-${ITERM_SESSION_ID}"
    return 0
  fi

  # Kitty: use window ID
  if [ -n "${KITTY_WINDOW_ID:-}" ]; then
    echo "kitty-${KITTY_WINDOW_ID}"
    return 0
  fi

  # WezTerm: use pane ID
  if [ -n "${WEZTERM_PANE:-}" ]; then
    echo "wezterm-${WEZTERM_PANE}"
    return 0
  fi

  # Zellij: use session + pane
  if [ -n "${ZELLIJ_SESSION_NAME:-}" ]; then
    local pane_id="${ZELLIJ_PANE_ID:-0}"
    echo "zellij-${ZELLIJ_SESSION_NAME}-${pane_id}"
    return 0
  fi

  # Windows Terminal: use session ID
  if [ -n "${WT_SESSION:-}" ]; then
    echo "wt-${WT_SESSION}"
    return 0
  fi

  # Fallback: use TTY device name (unique per terminal)
  local tty_name
  tty_name=$(tty 2>/dev/null | tr '/' '-' | sed 's/^-//')
  if [ -n "$tty_name" ] && [ "$tty_name" != "not a tty" ]; then
    echo "tty-${tty_name}"
    return 0
  fi

  # Last resort: parent process ID (each shell has unique parent)
  echo "pid-${PPID:-$$}"
}
