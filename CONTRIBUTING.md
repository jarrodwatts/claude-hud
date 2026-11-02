# Contributing

Thanks for contributing to Claude HUD. This repo is small and fast-moving, so we optimize for clarity and quick review.

## Scope

The default HUD stays a two-line local statusline. New display stays opt-in unless it fixes a wrong default. Do not add onboarding steps.

We will not take:

- `extra-cmd` in `config.json`, or raw multiline extra-cmd output. The command stays on argv behind `CLAUDE_HUD_ALLOW_EXTRA_CMD`.
- Per-window `timeFormat` knobs. Use `display.timeFormat`.
- Per-metric color slots beyond the existing `colors.*` keys.
- Timer-based fade for Skills or MCP. Use `showTools`, `showSkills`, and `showMcp`.
- A hardcoded catalog of Anthropic-compatible proxies. Use `display.providerName`.
- OS disk or other system gauges. Use `extra-cmd`.
- A HUD-side guess for advisor or multi-iteration context double-count, or for local models that omit `context_window`. Those need a same-invocation stdin fixture from Claude Code.
- Code in `src/` that runs a program, opens a connection, or writes outside the data directory. Logic runs caged; anything that needs a capability is a fixed probe in `collector.mjs`.

## Development

```bash
npm ci
npm test
```

There is no build: Node runs the TypeScript in `src/` directly, so use only erasable syntax and end imports in `.ts`. `npm run typecheck` runs `tsc` without emitting. `tests/golden.test.js` runs the CLI end to end for every case in `tests/golden/cases.mjs` and compares stdout with `tests/golden/expected.txt`. When a change is meant to alter output, run `npm run test:update-snapshots` and check the diff to `expected.txt` before committing it. Keep tests deterministic: pin the clock and use temp directories. `tests/clean-env.js` clears your own `CLAUDE_*`, `ANTHROPIC_*`, `GIT_*`, `COLUMNS` and `DEBUG` variables before each test file runs. Run a single file with `npm test -- tests/<name>.test.js` so it still applies.

Those tests are the agent's and yours, and advisory. The owner's checks live in `verify/` and run on every pull request (`.github/workflows/verify.yml`): the escape matrix, the corpus in `tests/corpus/` (fixtures may be added, never changed), the real Claude Code end-to-end run, the launcher on old Node and Bun, the diagram test against `ARCHITECTURE.md`, the owner's own walls (`owner`), and the maintainer. The one required check, `gate`, reads all of them.

## Pull Requests

- Keep changes focused, and describe the problem and the fix.
- Add tests for behavior changes, or explain why they aren't needed.
- Treat any text from stdin, the transcript, git, or config as untrusted: sanitize it before it reaches the terminal.
- Describe any new config key in `src/schema.ts`; that is what `/hud` tells users.
- Avoid new dependencies.

## Releases

There is nothing to build or tag. Users get a new version of the plugin on their next plugin update (automatic only if they turned auto-update on) once the version in `.claude-plugin/plugin.json` changes, so a release is a PR that bumps the version in `plugin.json`, `marketplace.json`, `package.json` and `package-lock.json` together, with a `CHANGELOG.md` entry. A PR that moves only the version in those files needs no owner approval, so the maintainer can release too. Keep the version fields even if that changes: launchers already on users' machines find installs by version folder.
