---
description: Run common Git workspace actions from an interactive menu
allowed-tools: Bash, Read, AskUserQuestion
---

# Git Actions

Use this command as the action companion to the HUD git segment. It should help
the user perform the common Git operations they expect after seeing branch,
dirty, ahead, or behind state in the statusline.

## Step 1: Verify Workspace

Run:

```bash
git rev-parse --show-toplevel
git status --short --branch
git remote -v
```

If the current directory is not inside a Git repository, stop and say:

> This directory is not a Git repository, so there are no Git actions to run here.

Do not initialize a repository unless the user explicitly asks.

## Step 2: Collect Current State

Run these commands and keep the output for decisions:

```bash
repo_root=$(git rev-parse --show-toplevel)
current_branch=$(git branch --show-current)
git_status=$(git status --short)
git_branch_status=$(git status --short --branch)
git remote
```

If `current_branch` is empty, treat the checkout as detached HEAD. Disable Pull,
Push, and Create branch from upstream unless the user first creates a branch.

## Step 3: Ask For The Action

Use AskUserQuestion.

- header: "Git"
- question: "What Git action do you want to run for this workspace?"
- multiSelect: false
- options:
  - "Refresh" - Run `git fetch --prune` and show the updated status
  - "Pull" - Pull the current branch with `git pull --ff-only`
  - "Switch branch" - Pick a local or remote branch and switch to it
  - "New branch" - Create and switch to a new branch from the current commit
  - "Push" - Push the current branch, setting upstream if needed
  - "Status only" - Show current branch, remote, dirty, ahead, and behind state

Prefer showing all options even when some may later need a safety check. If the
checkout is detached, explain after selection that Pull or Push requires a branch.

## Step 4: Shared Safety Checks

Before any operation that can move HEAD or modify files (`Pull`, `Switch branch`):

1. Run `git status --short`.
2. If there are uncommitted changes, ask:
   - header: "Changes"
   - question: "You have uncommitted changes. How should I handle them before this Git action?"
   - multiSelect: false
   - options:
     - "Keep and continue" - Try the Git action with the working tree as-is
     - "Stash first" - Run `git stash push -u -m "claude-hud git action"` before continuing
     - "Cancel" - Stop without changing Git state
3. If the user chooses "Stash first", run:

```bash
git stash push -u -m "claude-hud git action"
```

After a successful stashed operation, tell the user how to restore it:

```bash
git stash pop
```

Do not discard or reset user changes.

## Action: Refresh

Run:

```bash
git fetch --prune
git status --short --branch
```

Summarize whether the branch is ahead, behind, diverged, dirty, or clean.

## Action: Pull

If `git branch --show-current` is empty, stop and say Pull requires a named
branch.

Run the shared safety check, then:

```bash
git pull --ff-only
git status --short --branch
```

If fast-forward pull fails because branches diverged, do not merge or rebase
automatically. Explain the divergence and ask the user whether they want a rebase
or merge in a separate follow-up.

## Action: Switch Branch

Run:

```bash
git fetch --prune
git branch --format='%(refname:short)'
git branch -r --format='%(refname:short)' | sed 's#^origin/##' | grep -v '^HEAD$' | sort -u
```

Build a short branch list:

- Include the current branch first, labeled clearly.
- Include up to 10 local branches.
- Include up to 10 remote branches that are not already local.
- If the target branch is not shown, offer an "Enter branch name" option.

Ask:

- header: "Branch"
- question: "Which branch do you want to switch to?"
- multiSelect: false
- options:
  - Use the branch list above, plus "Enter branch name" when needed.

If the user chooses "Enter branch name", ask for the branch name and validate:

- non-empty
- does not start with `-`
- does not contain whitespace
- passes `git check-ref-format --branch <name>`

Run the shared safety check.

Switch behavior:

- If the branch exists locally:

```bash
git switch <branch>
```

- Else if `origin/<branch>` exists:

```bash
git switch --track origin/<branch>
```

- Else stop and say the branch was not found locally or on `origin`.

Then show:

```bash
git status --short --branch
```

## Action: New Branch

Ask:

- header: "New Branch"
- question: "What should the new branch be named?"

Validate:

- non-empty
- does not start with `-`
- does not contain whitespace
- passes `git check-ref-format --branch <name>`
- does not already exist locally

Run:

```bash
git switch -c <branch>
git status --short --branch
```

Do not push automatically unless the user selected Push.

## Action: Push

If `git branch --show-current` is empty, stop and say Push requires a named
branch.

Run:

```bash
git rev-parse --abbrev-ref --symbolic-full-name @{upstream}
```

If upstream exists:

```bash
git push
```

If upstream does not exist:

Ask:

- header: "Upstream"
- question: "This branch has no upstream. Push and set upstream on origin?"
- multiSelect: false
- options:
  - "Set upstream" - Run `git push -u origin <current_branch>`
  - "Cancel" - Stop without pushing

If confirmed:

```bash
git push -u origin <current_branch>
```

Then show:

```bash
git status --short --branch
```

## Action: Status Only

Run:

```bash
git status --short --branch
git log -1 --oneline --decorate
```

If `gh` is available, also run:

```bash
gh pr status
```

Summarize the status in plain language. Keep it short.

## Reporting

After every action, report:

- repo root
- current branch or detached ref
- whether there are uncommitted changes
- ahead/behind state if available
- exact command that changed Git state

Keep output concise. Do not print full diffs unless the user asks.
