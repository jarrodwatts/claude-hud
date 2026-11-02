# Architecture

This diagram is a test. `verify/arch.check.mjs` reads it on every pull request and compares it with
the runtime imports in `src/` (type-only imports don't count, because they vanish at runtime). It fails if:

- a file is in no box, or in two;
- an import crosses from one box to another with no arrow for it;
- an arrow is drawn that no import uses.

Square boxes list the files they own. Rounded nodes are Node builtins, so an arrow into one is
permission to touch the world that way: `proc` runs programs, `fsio` reads and writes files.

```mermaid
flowchart TD
  entry["entry: index.ts"]
  files["read and write files: config.ts config-reader.ts transcript.ts auth.ts external-usage.ts daily-cost.ts speed.ts"]
  run["run programs: git.ts git-runner.ts windows-git-worker.ts jj.ts extra-cmd.ts memory.ts"]
  logic["parse stdin: stdin.ts model-source.ts effort.ts cost.ts usage-pace.ts types.ts"]
  render["render lines: render/**"]
  shared["shared: utils/** i18n/** debug.ts claude-config-dir.ts"]

  fsio(["fs fs/promises readline"])
  proc(["child_process"])
  host(["os path url crypto"])

  entry --> files & run & logic & render & shared
  files --> logic & shared
  run --> shared
  logic --> shared
  render --> files & run & logic & shared
  run --> proc
  entry & files & run & render --> fsio
  entry & files & run & render & shared --> host
```

## What a render does today

1. `entry` reads Claude Code's stdin payload (`logic`) and the config (`files`).
2. It gathers only what the enabled elements need, in parallel: the transcript, git or jj, the extra
   command, memory, auth, the usage snapshot, the cost ledger and speed state (`files` and `run`).
3. `render` turns that into lines, and `entry` prints them.

## Where the lines are crossed today

The diagram shows the code as it is, not as it should be. Three arrows break the rule that
rendering does no I/O. They are the work the cage (spec step 3) removes:

- `render --> fsio`: `render/vcs.ts` calls `fs.statSync` to sort changed files newest first.
- `render --> run`: `render/lines.ts` imports `formatBytes` from `memory.ts`, which imports `child_process`.
  Under a load allow list, `render` would fail to load.
- `render --> files`: `render/parts.ts`, `vcs.ts`, `compact.ts` and `expanded.ts` import config
  defaults from `config.ts`, and `parts.ts` imports `formatAuthSegment` from `auth.ts`, so loading
  `render` loads `fs`.

Once those are gone, nothing that `render` or `logic` loads can reach `fsio` or `proc`.
