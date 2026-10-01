# CLAUDE.md

Claude HUD is a Claude Code plugin: a [status line](https://code.claude.com/docs/en/statusline) command that prints a two-line HUD (model, project, git, context, usage), plus opt-in lines for tools, agents, todos, and more.

## Commands

```bash
npm ci
npm test                           # builds dist/, then runs node --test
npm run test:update-snapshots      # regenerate tests/golden/expected.txt after an intended output change
echo '{"model":{"display_name":"Opus"},"context_window":{"used_percentage":45,"context_window_size":200000}}' | node dist/index.js
```

## How a render works

Claude Code runs the command after each message, `/compact`, a mode change, a rate-limit reset, or a prompt-cache expiry (debounced 300ms), plus on `refreshInterval` if set. Each run is a fresh process:

1. `stdin.ts` reads the payload. It targets Claude Code ≥ 2.1.260 and trusts its fields (`version`, `cost`, `prompt_cache`, `session_name`, `output_style`, `workspace.repo`, `rate_limits`) instead of deriving them.
2. `config.ts` loads `plugins/claude-hud/config.json` plus the per-directory `claude-hud.json` override. `DEFAULT_CONFIG` is the schema; a rules table validates each key.
3. `index.ts` gathers only what enabled elements need, in parallel: the transcript (`transcript.ts`), git or jj (`git.ts`, `jj.ts`), the extra command, memory, auth, config counts, the usage snapshot, the cost ledger, and speed state. All I/O and state writes happen here.
4. `render/` turns that into lines without I/O. Each element has one implementation in `parts.ts`, `context.ts`, `usage.ts`, `vcs.ts`, `lines.ts`, and `activity.ts`. `expanded.ts` and `compact.ts` only arrange those parts, and `ansi.ts` measures and wraps.

## Invariants

- The default HUD is two lines. New display is opt-in; see the scope section of CONTRIBUTING.md.
- Text from stdin, the transcript, git, or config is untrusted terminal input. Sanitize it (`utils/sanitize.ts`) before it's printed.
- Rendering is pure: the clock and terminal width are sampled once in `renderLines`.
- `tests/golden.test.js` pins end-to-end output. An output change must show up as a reviewed diff to `tests/golden/expected.txt`.
- `dist/` is built by CI on main. Never commit it in a PR.
- `README.md` and `README.zh.md` document every key in `DEFAULT_CONFIG`, and `tests/readme-options.test.js` enforces it.

## Setup

`/claude-hud:setup` (`commands/setup.md`) runs `scripts/setup.mjs`. That copies `scripts/statusline.mjs` to `<config dir>/plugins/claude-hud/` and points `statusLine.command` at it. The launcher runs the newest installed version, so plugin updates never need setup again. Plugins can't set `statusLine` themselves, so this step writes the user's `settings.json`.

Runtime: Node.js 18+ or Bun. Build: TypeScript, ES2022, NodeNext modules.
