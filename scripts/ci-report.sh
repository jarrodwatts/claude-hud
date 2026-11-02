#!/usr/bin/env bash
# CI: runs the escape matrix and times renders against main's last built dist/ and, for a stacked
# PR, the branch it stacks on. The report goes to the job log and the job summary.
set -euo pipefail
tmp="${RUNNER_TEMP:-/tmp}"
report="$tmp/hud-report.md"

status=0
node tests/escape/run.mjs > "$report" || status=$?

# Extracts a ref's files into $tmp/hud-<name>. tar -x runs from inside the folder, because GNU tar
# reads a Windows path like D:\a as host:path.
extract() {
  rm -rf "$tmp/hud-$1" && mkdir -p "$tmp/hud-$1"
  git fetch --quiet --depth=1 origin "$2"
  git archive FETCH_HEAD | (cd "$tmp/hud-$1" && tar -x)
}
entries=()
extract main main
if [ -f "$tmp/hud-main/dist/auth.js" ]; then entries+=("main's compiled dist=$tmp/hud-main/dist/index.js"); fi
base="${GITHUB_BASE_REF:-main}"
if [ "$base" != main ]; then
  extract base "$base"
  entries+=("base branch $base=$tmp/hud-base/hud.mjs")
fi
entries+=("this branch=hud.mjs")

{
  echo "### Render latency (full render: stdin, git, transcript, output)"
  echo
  node scripts/latency.mjs 40 "${entries[@]}"
} >> "$report"

cat "$report"
if [ -n "${GITHUB_STEP_SUMMARY:-}" ]; then cat "$report" >> "$GITHUB_STEP_SUMMARY"; fi
exit "$status"
