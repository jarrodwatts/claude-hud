// The scorecard (owner-owned): how the maintainer did over the last 30 days, computed from GitHub's records,
// never from the agent's own report. It goes into every inbox, so a worse playbook shows up in the numbers.
// Each list is GitHub's newest 100, which covers this repo's volume.
const DAY = 864e5;
const median = (xs) => (xs.length ? xs.sort((a, b) => a - b)[Math.floor(xs.length / 2)] : null);

export async function scorecard(gh) {
  const since = new Date(Date.now() - 30 * DAY).toISOString();
  const isBot = (pr) => pr.head.ref.startsWith('bot/');
  const [closed, commits, runs, events, issues, comments, artifacts] = await Promise.all([
    gh('pulls?state=closed&sort=updated&direction=desc&per_page=100'),
    gh(`commits?sha=main&since=${since}&per_page=100`),
    gh(`actions/runs?event=pull_request&created=>${since.slice(0, 10)}&per_page=100`),
    gh('issues/events?per_page=100'),
    gh(`issues?state=all&since=${since}&per_page=100`),
    gh(`issues/comments?since=${since}&per_page=100`),
    gh('actions/artifacts?per_page=100'),
  ]);
  const merged = closed.filter((pr) => isBot(pr) && pr.merged_at > since);
  const reverted = merged.filter((pr) => commits.some((c) => c.commit.message.includes(`This reverts commit ${pr.merge_commit_sha}`)
    && new Date(c.commit.committer.date) - new Date(pr.merged_at) < 14 * DAY));
  const firstRun = new Map();
  for (const r of runs.workflow_runs.filter((r) => r.name === 'verify' && r.head_branch.startsWith('bot/')).reverse())
    if (!firstRun.has(r.head_branch)) firstRun.set(r.head_branch, r);
  const opened = issues.filter((i) => !i.pull_request && i.created_at > since
    && !['OWNER', 'MEMBER', 'COLLABORATOR'].includes(i.author_association));
  const waits = opened.map((i) => comments.find((c) => c.issue_url === i.url && c.user.login !== i.user.login))
    .map((c, n) => c && (new Date(c.created_at) - new Date(opened[n].created_at)) / 6e4).filter((m) => m != null);
  // The relay's spend per run is recorded in the name of an artifact, "relay-tokens-<n>".
  const tokens = artifacts.artifacts.filter((a) => a.created_at > since).map((a) => /^relay-tokens-(\d+)$/.exec(a.name)?.[1])
    .filter(Boolean).reduce((sum, n) => sum + Number(n), 0);
  return {
    window_days: 30,
    bot_prs_merged: merged.length,
    bot_prs_reverted_within_14_days: reverted.length,
    issues_reopened: events.filter((e) => e.event === 'reopened' && e.created_at > since).length,
    bot_prs_red_on_first_ci_run: [...firstRun.values()].filter((r) => r.conclusion !== 'success').length,
    bot_prs_with_ci: firstRun.size,
    median_minutes_to_first_reply: median(waits),
    issues_still_waiting_for_a_reply: opened.length - waits.length,
    relay_tokens: tokens,
    relay_tokens_per_merged_pr: merged.length ? Math.round(tokens / merged.length) : null,
  };
}
