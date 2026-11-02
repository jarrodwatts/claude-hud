#!/usr/bin/env bash
# CI: runs the escape matrix and times renders against main's last built dist/, into the job summary.
set -euo pipefail
summary="${GITHUB_STEP_SUMMARY:-/dev/stdout}"

node tests/escape/run.mjs >> "$summary"

base="${RUNNER_TEMP:-/tmp}/hud-base"
rm -rf "$base" && mkdir -p "$base"
git fetch --quiet --depth=1 origin main
git archive FETCH_HEAD -- dist package.json | tar -x -C "$base"

{
  echo
  echo "### Render latency (full render: stdin, git, transcript, output)"
  echo
  if [ -f "$base/dist/auth.js" ]; then
    node scripts/latency.mjs 40 "$base/dist/index.js" hud.mjs
    echo
    echo "The first row is main's compiled dist/, the second this branch."
  else
    node scripts/latency.mjs 40 hud.mjs
  fi
} >> "$summary"
