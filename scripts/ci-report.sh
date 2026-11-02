#!/usr/bin/env bash
# CI: runs the escape matrix and times renders against main's last built dist/. The report goes to
# the job log and the job summary.
set -euo pipefail
report="${RUNNER_TEMP:-/tmp}/hud-report.md"
base="${RUNNER_TEMP:-/tmp}/hud-base"

status=0
node tests/escape/run.mjs > "$report" || status=$?

rm -rf "$base" && mkdir -p "$base"
git fetch --quiet --depth=1 origin main
# tar -x from inside $base: GNU tar reads a Windows path like D:\a as host:path.
git archive FETCH_HEAD -- dist package.json | (cd "$base" && tar -x)
{
  echo "### Render latency (full render: stdin, git, transcript, output)"
  echo
  if [ -f "$base/dist/auth.js" ]; then
    node scripts/latency.mjs 40 "$base/dist/index.js" hud.mjs
    echo
    echo "The first row is main's compiled dist/, the second this branch."
  else
    node scripts/latency.mjs 40 hud.mjs
  fi
} >> "$report"

cat "$report"
if [ -n "${GITHUB_STEP_SUMMARY:-}" ]; then cat "$report" >> "$GITHUB_STEP_SUMMARY"; fi
exit "$status"
