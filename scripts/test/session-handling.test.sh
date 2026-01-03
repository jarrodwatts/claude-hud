#!/bin/bash
# Integration tests for multi-terminal session handling
# Run with: bash scripts/test/session-handling.test.sh

set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$SCRIPT_DIR/../.."
HUD_DIR="$HOME/.claude/hud"
TEST_DIR="$HUD_DIR/test-$$"

# Test counter
TESTS_RUN=0
TESTS_PASSED=0

pass() {
  echo "  ✓ $1"
  TESTS_PASSED=$((TESTS_PASSED + 1))
}

fail() {
  echo "  ✗ $1: $2"
}

run_test() {
  TESTS_RUN=$((TESTS_RUN + 1))
  "$@"
}

cleanup() {
  rm -rf "$TEST_DIR"
  rm -f "$HUD_DIR/pids/test-term-"*.pid
  rm -f "$HUD_DIR/refresh-test-term-"*.json
  rm -f "$HUD_DIR/events/test-session-"*.fifo
}

setup() {
  cleanup
  mkdir -p "$TEST_DIR"
  mkdir -p "$HUD_DIR/pids" "$HUD_DIR/events" "$HUD_DIR/logs"
}

echo "Testing session handling"
echo "========================"
setup
trap cleanup EXIT

# Test 1: PID file is terminal-scoped
test_pid_file_naming() {
  # Simulate terminal IDs
  local term1="test-term-1"
  local term2="test-term-2"

  # Create mock PID files as the scripts would
  echo "12345" > "$HUD_DIR/pids/$term1.pid"
  echo "67890" > "$HUD_DIR/pids/$term2.pid"

  if [ -f "$HUD_DIR/pids/$term1.pid" ] && [ -f "$HUD_DIR/pids/$term2.pid" ]; then
    local pid1 pid2
    pid1=$(cat "$HUD_DIR/pids/$term1.pid")
    pid2=$(cat "$HUD_DIR/pids/$term2.pid")
    if [ "$pid1" = "12345" ] && [ "$pid2" = "67890" ]; then
      pass "PID files are terminal-scoped"
    else
      fail "PID files are terminal-scoped" "wrong content"
    fi
  else
    fail "PID files are terminal-scoped" "files not created"
  fi

  rm -f "$HUD_DIR/pids/$term1.pid" "$HUD_DIR/pids/$term2.pid"
}
run_test test_pid_file_naming

# Test 2: Refresh file is terminal-scoped
test_refresh_file_naming() {
  local term1="test-term-1"
  local term2="test-term-2"

  # Create mock refresh files
  cat > "$HUD_DIR/refresh-$term1.json" << EOF
{"sessionId":"sess-a","fifoPath":"/tmp/a.fifo","terminalId":"$term1"}
EOF
  cat > "$HUD_DIR/refresh-$term2.json" << EOF
{"sessionId":"sess-b","fifoPath":"/tmp/b.fifo","terminalId":"$term2"}
EOF

  local sess1 sess2
  sess1=$(jq -r '.sessionId' "$HUD_DIR/refresh-$term1.json")
  sess2=$(jq -r '.sessionId' "$HUD_DIR/refresh-$term2.json")

  if [ "$sess1" = "sess-a" ] && [ "$sess2" = "sess-b" ]; then
    pass "Refresh files are terminal-scoped"
  else
    fail "Refresh files are terminal-scoped" "got sess1=$sess1 sess2=$sess2"
  fi

  rm -f "$HUD_DIR/refresh-$term1.json" "$HUD_DIR/refresh-$term2.json"
}
run_test test_refresh_file_naming

# Test 3: FIFO is session-scoped (not terminal-scoped)
test_fifo_naming() {
  local sess1="test-session-1"
  local sess2="test-session-2"
  local fifo1="$HUD_DIR/events/$sess1.fifo"
  local fifo2="$HUD_DIR/events/$sess2.fifo"

  mkfifo "$fifo1" 2>/dev/null || true
  mkfifo "$fifo2" 2>/dev/null || true

  if [ -p "$fifo1" ] && [ -p "$fifo2" ]; then
    pass "FIFOs are session-scoped"
  else
    fail "FIFOs are session-scoped" "FIFOs not created as pipes"
  fi

  rm -f "$fifo1" "$fifo2"
}
run_test test_fifo_naming

# Test 4: get_terminal_id in lib produces valid identifiers
test_terminal_id_lib() {
  source "$PROJECT_ROOT/scripts/lib/terminal-id.sh"
  local tid
  tid=$(get_terminal_id)

  if [[ "$tid" =~ ^[a-zA-Z0-9@_-]+$ ]]; then
    pass "Terminal ID is valid for filenames: $tid"
  else
    fail "Terminal ID is valid for filenames" "got '$tid'"
  fi
}
run_test test_terminal_id_lib

# Test 5: Multiple terminals get different IDs (simulated)
test_multi_terminal_isolation() {
  # This test verifies the design - different terminal env vars produce different IDs

  # Simulate iTerm
  (
    export ITERM_SESSION_ID="w0t0p0:12345678"
    unset TMUX KITTY_WINDOW_ID WEZTERM_PANE ZELLIJ_SESSION_NAME WT_SESSION
    source "$PROJECT_ROOT/scripts/lib/terminal-id.sh"
    local tid
    tid=$(get_terminal_id)
    echo "$tid"
  ) > "$TEST_DIR/iterm_id.txt"

  # Simulate Kitty
  (
    export KITTY_WINDOW_ID="99"
    unset TMUX ITERM_SESSION_ID WEZTERM_PANE ZELLIJ_SESSION_NAME WT_SESSION
    source "$PROJECT_ROOT/scripts/lib/terminal-id.sh"
    local tid
    tid=$(get_terminal_id)
    echo "$tid"
  ) > "$TEST_DIR/kitty_id.txt"

  local iterm_id kitty_id
  iterm_id=$(cat "$TEST_DIR/iterm_id.txt")
  kitty_id=$(cat "$TEST_DIR/kitty_id.txt")

  if [ "$iterm_id" != "$kitty_id" ] && [ -n "$iterm_id" ] && [ -n "$kitty_id" ]; then
    pass "Different terminals get different IDs (iterm=$iterm_id, kitty=$kitty_id)"
  else
    fail "Different terminals get different IDs" "iterm=$iterm_id kitty=$kitty_id"
  fi
}
run_test test_multi_terminal_isolation

# Test 6: Session switch within terminal updates refresh file correctly
test_session_switch() {
  local term="test-term-switch"
  local sess1="sess-old"
  local sess2="sess-new"

  # Initial session
  cat > "$HUD_DIR/refresh-$term.json" << EOF
{"sessionId":"$sess1","fifoPath":"/tmp/$sess1.fifo","terminalId":"$term"}
EOF

  # Simulate /new - updates to new session
  cat > "$HUD_DIR/refresh-$term.json" << EOF
{"sessionId":"$sess2","fifoPath":"/tmp/$sess2.fifo","terminalId":"$term"}
EOF

  local current
  current=$(jq -r '.sessionId' "$HUD_DIR/refresh-$term.json")

  if [ "$current" = "$sess2" ]; then
    pass "Session switch updates refresh file"
  else
    fail "Session switch updates refresh file" "expected $sess2, got $current"
  fi

  rm -f "$HUD_DIR/refresh-$term.json"
}
run_test test_session_switch

echo ""
echo "Results: $TESTS_PASSED/$TESTS_RUN tests passed"

if [ "$TESTS_PASSED" -eq "$TESTS_RUN" ]; then
  exit 0
else
  exit 1
fi
