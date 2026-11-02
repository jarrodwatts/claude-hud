# Architecture

Agents own the logic. The owner owns the capabilities. The runtime enforces the line, twice: on
GitHub's machines, where the maintainer agent works, and on every user's machine, where the HUD runs.
A capability is anything that touches the world: running a program, writing a file outside one
folder, the network, a key, posting, merging. Everything else is logic.

```
                 MAINTAINER (a fresh GitHub VM)                    USER (after each Claude Code message)
 LOGIC     ┌─ agent job: Claude as unix user `agent` ────┐    ┌─ src/**/*.ts, caged ───────────────────────┐
 (agent)   │ reads inbox.json, writes outbox + patches   │    │ parse stdin, ask for probes, render lines, │
           │ no keys; network = the loopback relay only  │    │ the /hud subcommands; writes data/ only    │
═══════════╪════════ files only ════ THE LINE ═══════════╪════╪═════ JSON lines on fd 0 and 1 ════════════╪═══
 CAPABILITY│ harness.mjs + relay: holds the token,       │    │ hud.mjs: runCage, terminalFilter           │
 (owner)   │   per-run and daily token caps              │    │ collector.mjs: every path, every program   │
           │ act.mjs: reply | label | close | propose,   │    │   (git, jj, vm_stat, the extra command)    │
           │   and the `gate` check                      │    │ fence.mjs + node --permission: the cage    │
           └─ ruleset: one required check, `gate` ───────┘    └─ verify/: the checks, run on every PR ─────┘
                     merged to main = shipped
```

On the user's side, one render is:

```
Claude Code ─stdin─▶ hud.mjs ─▶ collector.mjs: paths (logicPaths), data/, probes
                        └─▶ runCage: node --permission --allow-fs-read=<each path> --allow-fs-write=data/
                                     --import=fence.mjs src/main.ts
                              ─▶ {stdin, now, paths}  ◀─ ask: ["git.status", …] ─▶ answers  ◀─ {lines, snapshot?}
           terminal ◀─ terminalFilter: colour, and links to file: or the session's own GitHub repo
```

A test case (`tests/corpus/*.json`) is the same render with the probes' answers recorded as `facts`,
so the corpus replays git and jj states without running either. Every check in `verify/` goes
through the same `runCage`.

## The logic side, as a test

This diagram is a test. `verify/arch.check.mjs` reads it on every pull request and compares it with
the runtime imports in `src/` (type-only imports vanish when Node strips the types). It fails if a
file is in no box or in two, if an import crosses boxes with no arrow for it, if an arrow is drawn
that no import uses, or if the rounded nodes are not exactly the builtins `fence.mjs` lets logic
load. Square boxes own the files they list. A rounded node is a set of Node builtins, so an arrow
into one is permission to touch the world that way. `hud.mjs` is the owner's code: only the stub
that launchers already on users' machines import may point at it.

```mermaid
flowchart TD
  stub["launcher stub: index.ts"]
  entry["entry: main.ts channel.ts commands.ts schema.ts"]
  read["read files: config.ts config-reader.ts transcript.ts auth.ts external-usage.ts daily-cost.ts speed.ts"]
  parse["parse stdin and probe answers: stdin.ts model-source.ts effort.ts cost.ts usage-pace.ts types.ts git.ts jj.ts memory.ts extra-cmd.ts"]
  render["render lines: render/**"]
  shared["shared: utils/** i18n/** debug.ts"]

  hud[["hud.mjs"]]
  fsio(["node:fs node:fs/promises node:readline"])
  host(["node:path node:os node:url node:crypto"])

  stub --> hud
  entry --> read & parse & render & shared & fsio & host
  read --> parse & shared & fsio & host
  parse --> shared & host
  render --> read & parse & shared & fsio & host
  shared --> host
```

`fsio` is bounded by `--permission`: logic reads only the paths `collector.mjs` names in `paths`
and writes only `data/`. Nothing in `src/` can reach `node:child_process`, `node:net` or any other
builtin: `fence.mjs` refuses the import, and this test refuses the diagram.
