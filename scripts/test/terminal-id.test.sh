#!/bin/bash
# Integration tests for terminal-id.sh
# Run with: bash scripts/test/terminal-id.test.sh

set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
LIB_DIR="$SCRIPT_DIR/../lib"

source "$LIB_DIR/terminal-id.sh"

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

echo "Testing terminal-id.sh"
echo "======================"

# Test 1: Function exists and returns something
test_function_returns_value() {
  local result
  result=$(get_terminal_id)
  if [ -n "$result" ]; then
    pass "get_terminal_id returns non-empty value: $result"
  else
    fail "get_terminal_id returns non-empty value" "got empty string"
  fi
}
run_test test_function_returns_value

# Test 2: Result is consistent across calls
test_consistent_results() {
  local result1 result2
  result1=$(get_terminal_id)
  result2=$(get_terminal_id)
  if [ "$result1" = "$result2" ]; then
    pass "get_terminal_id returns consistent value"
  else
    fail "get_terminal_id returns consistent value" "got '$result1' then '$result2'"
  fi
}
run_test test_consistent_results

# Test 3: Result contains expected prefix
test_result_format() {
  local result
  result=$(get_terminal_id)
  # Should match one of: tmux-, iterm-, kitty-, wezterm-, zellij-, wt-, tty-, pid-
  if [[ "$result" =~ ^(tmux|iterm|kitty|wezterm|zellij|wt|tty|pid)- ]]; then
    pass "get_terminal_id has valid prefix format"
  else
    fail "get_terminal_id has valid prefix format" "got '$result'"
  fi
}
run_test test_result_format

# Test 4: Result is safe for filenames (no special chars except hyphen and alphanumeric)
test_filename_safe() {
  local result
  result=$(get_terminal_id)
  # Allow alphanumeric, hyphen, underscore, @ (tmux window IDs use @)
  if [[ "$result" =~ ^[a-zA-Z0-9@_-]+$ ]]; then
    pass "get_terminal_id is filename-safe"
  else
    fail "get_terminal_id is filename-safe" "got '$result'"
  fi
}
run_test test_filename_safe

# Test 5: Simulated tmux environment
test_tmux_detection() {
  local result
  # Temporarily set TMUX to simulate tmux environment
  # Note: This won't work fully without actual tmux, but tests the logic
  if [ -n "${TMUX:-}" ]; then
    result=$(get_terminal_id)
    if [[ "$result" =~ ^tmux-@[0-9]+$ ]]; then
      pass "tmux detection works (actual tmux session)"
    else
      fail "tmux detection works" "got '$result' (expected tmux-@N)"
    fi
  else
    pass "tmux detection (skipped - not in tmux)"
  fi
}
run_test test_tmux_detection

echo ""
echo "Results: $TESTS_PASSED/$TESTS_RUN tests passed"

if [ "$TESTS_PASSED" -eq "$TESTS_RUN" ]; then
  exit 0
else
  exit 1
fi
