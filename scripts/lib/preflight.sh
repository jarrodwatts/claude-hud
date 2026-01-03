#!/bin/bash
set -uo pipefail

hud_bootstrap_log() {
  local message="$1"
  local hud_dir="$HOME/.claude/hud"
  local log_dir="$hud_dir/logs"
  local log_file="$log_dir/hud-bootstrap.log"
  local ts

  ts=$(date -u +"%Y-%m-%dT%H:%M:%SZ")
  mkdir -p "$log_dir" 2>/dev/null || true
  echo "$ts $message" >> "$log_file" 2>/dev/null || true
}

hud_preflight() {
  local session_id="${1:-}"
  local terminal_id="${2:-}"
  local plugin_root="${3:-}"
  local output_mode="${4:-log}"
  local hud_dir="$HOME/.claude/hud"
  local stamp_dir="$hud_dir/preflight"
  local stamp_ok="$stamp_dir/${terminal_id}.ok"
  local stamp_fail="$stamp_dir/${terminal_id}.fail"
  local throttle_seconds=60
  local now

  now=$(date +%s)
  mkdir -p "$stamp_dir" 2>/dev/null || true

  if [ -f "$stamp_ok" ]; then
    return 0
  fi

  if [ -f "$stamp_fail" ]; then
    local last
    last=$(cat "$stamp_fail" 2>/dev/null || echo 0)
    if [ $((now - last)) -lt $throttle_seconds ]; then
      return 1
    fi
  fi

  local missing=()
  local missing_notes=()

  if ! command -v jq &>/dev/null; then
    missing+=("jq")
    missing_notes+=("Install jq: macOS 'brew install jq', Ubuntu/Debian 'sudo apt-get install jq', Fedora 'sudo dnf install jq'.")
  fi

  if ! command -v bun &>/dev/null && ! command -v node &>/dev/null; then
    missing+=("node-or-bun")
    missing_notes+=("Install Node.js 18+ or Bun.")
  fi

  if [ -n "$plugin_root" ] && [ ! -f "$plugin_root/tui/dist/index.js" ]; then
    missing+=("tui-dist")
    missing_notes+=("Build HUD: cd \"$plugin_root/tui\" && bun install && bun run build. If installed via /plugin install, try reinstalling the plugin.")
  fi

  if [ ${#missing[@]} -gt 0 ]; then
    echo "$now" > "$stamp_fail" 2>/dev/null || true
    hud_bootstrap_log "preflight failed session=${session_id:-unknown} terminal=${terminal_id:-unknown} missing=${missing[*]}"
    for note in "${missing_notes[@]}"; do
      hud_bootstrap_log "hint: $note"
    done
    if [ "$output_mode" = "stderr" ]; then
      echo "Claude HUD: missing setup. See ~/.claude/hud/logs/hud-bootstrap.log for fixes." >&2
    fi
    return 1
  fi

  echo "$now" > "$stamp_ok" 2>/dev/null || true
  return 0
}
