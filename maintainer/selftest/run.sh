#!/usr/bin/env bash
# The maintainer selftest. It runs the real harness, relay, jail, reach probe, ACT verbs and gate on this runner,
# against fakes: fake tokens, a scripted model, a fake GitHub API and a local git origin. Only the inbox reads
# real (public) GitHub data. It stops at the first broken promise. Needs a GitHub-hosted ubuntu-24.04 runner.
set -euo pipefail
here=$(cd "$(dirname "$0")" && pwd)
m=$(dirname "$here")
st=/tmp/selftest
rm -rf "$st" && mkdir -p "$st"
trap 'kill $(jobs -p) 2>/dev/null || true' EXIT
export GITHUB_REPOSITORY=${GITHUB_REPOSITORY:-jarrodwatts/claude-hud}
owner=${GITHUB_REPOSITORY%%/*}
token=sk-ant-oat01-FAKE-selftest-token-0000000000
pass() { echo "PASS $*"; echo "- PASS $*" >> "${GITHUB_STEP_SUMMARY:-/dev/null}"; }
fail() { echo "FAIL $*"; echo "- **FAIL** $*" >> "${GITHUB_STEP_SUMMARY:-/dev/null}"; exit 1; }
check() { local what=$1; shift; if "$@" > /dev/null; then pass "$what"; else fail "$what"; fi; }

echo "== 1. A full agent run, with a scripted model behind the relay"
node "$here/fake-model.mjs" 18787 "$here/steps-run.json" "$st/model-run.log" & sleep 0.5
RELAY_TOKEN=$token RELAY_UPSTREAM=http://127.0.0.2:18787 node "$m/harness.mjs" "$st/run" | tee "$st/harness-run.txt"
grep -E '^(REACHABLE|blocked)' "$st/harness-run.txt" | sed 's/^/    /' >> "${GITHUB_STEP_SUMMARY:-/dev/null}"
check "the reach probe found nothing reachable from the agent user" grep -qE 'reach probe: 0/[0-9]+ reachable' "$st/harness-run.txt"
check "every model call carried the real token and the pinned model" \
  jq -es --arg auth "Bearer $token" 'length > 1 and all(.auth == $auth and .model == "claude-opus-5-5")' "$st/model-run.log"
check "Claude answered with an outbox" test -s "$st/run/outbox.json"
check "a symlink the agent left in out/ was not collected" grep -q 'ignored out/steal-file.patch' "$st/harness-run.txt"

echo "== 2. ACT carries out that outbox against a fake GitHub and a local origin"
origin=$st/server/$GITHUB_REPOSITORY
git init -q --bare -b main "$origin" && git push -q "$origin" HEAD:refs/heads/main
git clone -q "$origin" "$st/act" && git clone -q "$origin" "$st/prs"
echo '{}' > "$st/routes.json"
node "$here/fake-github.mjs" 18788 "$st/routes.json" "$st/github.log" & sleep 0.5
act() (cd "$st/act" && GH_TOKEN=ghs_fake-app-token GITHUB_REPOSITORY_OWNER=$owner GITHUB_API_URL=http://127.0.0.2:18788 \
  GITHUB_SERVER_URL=file://$st/server node "$m/act.mjs" "$@")
act apply "$st/run" | tee "$st/act.txt"
writes() { jq -r '.key' "$st/github.log" | sort | uniq -c | sed 's/^ *//'; }
writes
check "the reply lost its outside link and its @mention, and kept the repo link" jq -es --arg r "$GITHUB_REPOSITORY" '.[0].body.body == "Thanks @​jarrodwatts, see [link removed] and https://github.com/\($r)/issues/1"' "$st/github.log"
check "label and close went through" grep -q 'not_planned' "$st/github.log"
check "the ordinary patch became branch bot/note-changelog" git -C "$origin" rev-parse -q --verify refs/heads/bot/note-changelog
check "  ...with a PR and auto-merge" test "$(grep -cE '"POST /repos/[^ ]+/pulls"|"POST /graphql"' "$st/github.log")" = 2
check "ACT refused the patch to a workflow" grep -q 'FAIL propose sneak-workflow: refused: .github/workflows/ci.yml is owner-owned' "$st/act.txt"
check "ACT refused the patch that adds a symlink" grep -q 'FAIL propose sneak-symlink: refused: sneaky-link: a mode, symlink' "$st/act.txt"
check "ACT had no file for the symlinked patch" grep -q 'FAIL propose steal-file' "$st/act.txt"
check "no branch exists for any refused patch" test -z "$(git -C "$origin" branch --list 'bot/sneak*' 'bot/steal*')"
check "every write used the App token" jq -es 'all(.auth == "Bearer ghs_fake-app-token")' "$st/github.log"
mkdir -p "$st/bad" && echo '{"actions":[{"do":"merge","item":1}]}' > "$st/bad/outbox.json" && : > "$st/github.log"
if act apply "$st/bad" 2> "$st/bad.txt"; then fail "ACT accepted an outbox with a verb outside the schema"; fi
check "an outbox with a verb outside the schema does nothing at all" test ! -s "$st/github.log"

echo "== 3. The relay refuses once the run's budget is spent"
node "$here/fake-model.mjs" 18789 "$here/steps-spend.json" "$st/model-spend.log" & sleep 0.5
RELAY_TOKEN=$token RELAY_UPSTREAM=http://127.0.0.2:18789 RELAY_BUDGET=600 node "$m/harness.mjs" "$st/spend" | tee "$st/harness-spend.txt"
check "the relay answered 400 once 600 tokens were spent" grep -q 'refused POST /v1/messages?beta=true: run budget of 600 tokens spent' "$st/harness-spend.txt"
check "Claude stopped on the 400 instead of retrying until a timeout" grep -q 'claude exit 1: API Error: 400 relay: run budget' "$st/harness-spend.txt"
after() { sed -n '/run budget of 600 tokens spent/,$p' "$st/harness-spend.txt"; }
check "no call reached the model once the budget was spent" test -z "$(after | grep ' 200, ')"
check "no outbox came out of a run that ran out of budget" test ! -e "$st/spend/outbox.json"

echo "== 4. The gate, run on fake verify results for PR heads in the local origin"
commit() (cd "$st/prs" && git checkout -q --detach origin/main && eval "$2" && git add -A \
  && git -c user.name=t -c user.email=t@t commit -qm "$1" && git push -q origin "HEAD:$3" && git rev-parse HEAD)
commit fixture 'mkdir -p tests/corpus && echo "{}" > tests/corpus/old.json' refs/heads/main >/dev/null
git -C "$st/prs" fetch -q origin
s7=$(commit src 'echo x >> CHANGELOG.md' refs/pull/7/head)
s8=$(commit wf 'echo "# x" >> .github/workflows/ci.yml' refs/pull/8/head)
s9=$(commit edit 'echo "[]" > tests/corpus/old.json' refs/pull/9/head)
s10=$(commit add 'echo "{}" > tests/corpus/new.json' refs/pull/10/head)
s11=$(commit wf2 'echo "# y" >> .github/workflows/ci.yml' refs/pull/11/head)
jq -n --arg r "/repos/$GITHUB_REPOSITORY" --arg owner "$owner" --arg s7 "$s7" --arg s8 "$s8" --arg s9 "$s9" --arg s10 "$s10" --arg s11 "$s11" '
  def pr(n; sha): {number: n, head: {sha: sha}, user: {login: "stranger"}};
  def jobs(c): {jobs: [{name: "corpus", conclusion: "success"}, {name: "escape matrix", conclusion: c}]};
  { "GET \($r)/pulls?state=open&per_page=100": [pr(7; $s7), pr(8; $s8), pr(9; $s9), pr(10; $s10), pr(11; $s11)],
    "GET \($r)/actions/runs/1/jobs?per_page=100": jobs("success"),
    "GET \($r)/actions/runs/2/jobs?per_page=100": jobs("skipped"),
    "GET \($r)/actions/runs/3/jobs?per_page=100": jobs("neutral"),
    "GET \($r)/pulls/8/reviews?per_page=100": [{state: "APPROVED", user: {login: $owner}, commit_id: "0000000stale"}],
    "GET \($r)/pulls/11/reviews?per_page=100": [{state: "APPROVED", user: {login: $owner}, commit_id: $s11}] }' > "$st/routes.json"
gate() { # gate <verify run id> <head sha> <expected conclusion, or "" for no check> <what> [workflow path]
  jq -n --argjson id "$1" --arg sha "$2" --arg path "${5:-.github/workflows/verify.yml}" \
    '{workflow_run: {id: $id, path: $path, event: "pull_request", head_sha: $sha}}' > "$st/event.json"
  : > "$st/github.log"
  GITHUB_EVENT_PATH=$st/event.json act gate > "$st/gate.txt"
  local got; got=$(jq -r 'select(.key | endswith("/check-runs")) | .body.conclusion' "$st/github.log")
  sed 's/^/    /' "$st/gate.txt"
  check "gate ${3:-not posted}: $4" test "$got" = "$3"
}
gate 1 "$s7" success "a src change with every verify job green"
gate 2 "$s7" failure "the same change with one verify job skipped"
gate 3 "$s7" failure "the same change with one verify job neutral"
gate 1 "$s8" failure "a workflow change whose owner approval is for an older head"
gate 1 "$s11" success "a workflow change the owner approved at this exact head"
gate 1 "$s9" failure "a change that edits an existing fixture"
gate 1 "$s10" success "a change that only adds a fixture"
gate 1 "$s7" "" "a green run of some other workflow file named verify" .github/workflows/fake.yml
echo "selftest passed"
