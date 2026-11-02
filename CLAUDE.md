# CLAUDE.md

Claude HUD is a Claude Code plugin: a [status line](https://code.claude.com/docs/en/statusline) command that prints a two-line HUD (model, project, git, context, usage), plus opt-in lines for tools, agents, todos, and more.

## Commands

```bash
npm ci
npm test                           # node --test; there is no build
npm test -- tests/auth.test.js     # one file; plain `node --test` skips tests/clean-env.js
npm run typecheck                  # tsc, noEmit
npm run test:update-snapshots      # regenerate tests/golden/expected.txt after an intended output change
echo '{"model":{"display_name":"Opus"},"context_window":{"used_percentage":45,"context_window_size":200000}}' | node hud.mjs
node hud.mjs doctor                # the /hud skill's subcommands: doctor, schema, preview, set, report, install
node verify/run.mjs corpus escape arch   # some of the owner's checks that gate every PR (verify.yml runs all of them)
```

## The line

Logic is everything in `src/`. It runs caged and holds no capabilities. The owner's files below hold them, and logic can't change them. `ARCHITECTURE.md` draws the line and one render, and is itself a test. Your side of the line is the `AGENT` list at the top of `maintainer/act.mjs`.

- `hud.mjs`: Node gate, stdin, `runCage` (the one way logic runs, for renders, subcommands and every check), the terminal filter, the heartbeat, subcommand dispatch. It runs Node: the cage, or, under Bun, the whole run.
- `collector.mjs`: the only code that runs a program other than Node (`git`, `jj`, `vm_stat`, `taskkill`, the extra command), and the only code that works out a path. It writes the HUD's own files (`config.json` for `set`, the heartbeat, `stripped/`). Logic picks probes by name and reads files only from the `paths` it is given (`logicPaths`), which are exactly its read grants.
- `fence.mjs`: the import allow list, deleted globals, and the loader for `stripped/`.
- `install.mjs`: `hud install`, which writes `statusLine` in the user's `settings.json` and copies the launcher.
- `scripts/statusline.mjs`: the launcher `hud install` copies; it runs the newest installed version through `dist/index.js` or `src/index.ts`.
- `skills/hud/SKILL.md`: the `/hud` skill. Its list of subcommands Claude may run without asking is a capability too.

Logic may write only `data/`. It must never be able to write anything it later runs: its code is stripped of types once, by Node's own `stripTypeScriptTypes`, into `stripped/` beside `data/`, which the collector writes and logic only reads. There is no compile cache logic can write. `verify/lib/escape-probe.mjs` is the list of things logic must not do. It is owner-owned: when you find a new way out, describe it in an issue.

## How a render works

Claude Code runs the command after each message, `/compact`, a mode change, a rate-limit reset, or a prompt-cache expiry (debounced 300ms), plus on `refreshInterval` if set. Each run is a fresh pair of processes:

1. `hud.mjs` reads the payload. `stdin.ts` targets Claude Code ≥ 2.1.260 and trusts its fields (`version`, `cost`, `prompt_cache`, `session_name`, `output_style`, `workspace.repo`, `rate_limits`) instead of deriving them.
2. `config.ts` loads `plugins/claude-hud/config.json` plus the per-directory `claude-hud.json` override. `DEFAULT_CONFIG` holds the defaults and a rules table validates each key; `schema.ts` describes each key for `hud schema`. A bad value shows one line ending in `/hud`.
3. `main.ts` gathers only what enabled elements need, in parallel: the transcript (`transcript.ts`), git or jj answers (`git.ts`, `jj.ts` parse what the collector ran), the extra command, memory, auth, config counts, the usage snapshot, the cost ledger, and speed state.
4. `render/` turns that into lines without I/O. Each element has one implementation in `parts.ts`, `context.ts`, `usage.ts`, `vcs.ts`, `lines.ts`, and `activity.ts`. `expanded.ts` and `compact.ts` only arrange those parts, and `ansi.ts` measures and wraps.

`commands.ts` runs the subcommands the `/hud` skill (`skills/hud/SKILL.md`) uses. The skill pre-approves only the read-only ones; `set` and `install` go through Claude Code's permission prompt.

## Invariants

- The default HUD is two lines. New display is opt-in; see the scope section of CONTRIBUTING.md.
- Text from stdin, the transcript, git, or config is untrusted terminal input. Sanitize it (`utils/sanitize.ts`) before it's printed.
- Rendering is pure: the clock is sampled once by `hud.mjs` and terminal width once in `renderLines`.
- `tests/golden.test.js` pins end-to-end output. An output change must show up as a reviewed diff to `tests/golden/expected.txt`.
- `tests/corpus/*.json` are fixtures for `verify/corpus.check.mjs`. Add new ones; never edit, rename or delete one. Only the owner can, by writing or approving that exact change, when a case itself was wrong. A case's `facts` are the probes' recorded answers, so git and jj states replay without running either.
- Imports end in `.ts`, and only erasable TypeScript is allowed (`erasableSyntaxOnly`), because users run the source.
- Every key in `DEFAULT_CONFIG` has a description in `schema.ts`; `tests/commands.test.js` enforces it.
- `dist/index.js` and `src/index.ts` are the stubs every launcher imports, the one `hud install` copies today included. Keep them, and keep the `version` fields: launchers find installs by version folder.

## Setup

`hud install` copies `scripts/statusline.mjs` to `<config dir>/plugins/claude-hud/` and points `statusLine.command` at it, with the absolute path of the Node running it. The launcher runs the newest installed version, so plugin updates never need setup again. Plugins can't set `statusLine` themselves, so this step writes the user's `settings.json`.

Runtime: Node.js 22.18+. Bun can launch the HUD, which hands the run to Node.
