# Contributing

Thanks for contributing to Claude HUD. This repo is small and fast-moving, so we optimize for clarity and quick review.

## How to Contribute

1) Fork and clone the repo
2) Create a branch
3) Make your changes
4) Run tests and update docs if needed
5) Open a pull request

## Development

```bash
npm ci
npm run build
npm test
```

## Tests

See `TESTING.md` for the full testing strategy, fixtures, and snapshot updates.

## Code Style

- Keep changes focused and small.
- Prefer tests for behavior changes.
- Avoid introducing dependencies unless necessary.

## Build Process

**Important**: PRs should only modify files in `src/` — do not include changes to `dist/`.

CI automatically builds and commits `dist/` after your PR is merged. This keeps PRs focused on source code and makes review easier.

To ignore `dist/` changes locally, run at the project root:

Mac/Linux or Git Bash:
```bash
git ls-files dist/ | xargs git update-index --skip-worktree
```

Windows (PowerShell):
```powershell
git ls-files dist/ | ForEach-Object { git update-index --skip-worktree $_ }
```

```
Your PR: src/ changes only → Merge → CI builds dist/ → Committed automatically
```

## Pull Requests

- Describe the problem and the fix.
- Include tests or explain why they are not needed.
- Link issues when relevant.
- Only modify `src/` files — CI handles `dist/` automatically.

## Releasing New Versions

When shipping a new version:

1. **Update version numbers** in all three files:
   - `package.json` → `"version": "X.Y.Z"`
   - `.claude-plugin/plugin.json` → `"version": "X.Y.Z"`
   - `.claude-plugin/marketplace.json` → `"version": "X.Y.Z"`

2. **Update CHANGELOG.md** with changes since last release

3. **Commit and merge** — CI builds dist/ automatically

### How Users Get Updates

Claude Code plugins support updates through the `/plugin` interface:

- **Update now** — Fetches latest from main branch, installs immediately
- **Mark for update** — Stages update for later

Claude Code compares the `version` field in `plugin.json` against the installed version. Bumping the version number (e.g., 0.0.1 → 0.0.2) allows users to see an update is available.

### Version Strategy

We use semantic versioning (`MAJOR.MINOR.PATCH`):
- **PATCH** (0.0.x): Bug fixes, minor improvements
- **MINOR** (0.x.0): New features, non-breaking changes
- **MAJOR** (x.0.0): Breaking changes
