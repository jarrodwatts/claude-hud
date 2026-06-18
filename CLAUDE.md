# CLAUDE.md

This file provides guidance to Claude Code when working with this repository.

## Project Overview

Claude HUD is a Claude Code plugin that displays a real-time multi-line statusline. It shows context health, tool activity, agent status, and todo progress.

## Build Commands

```bash
npm ci               # Install dependencies
npm run build        # Build TypeScript to dist/

# Test with sample stdin data
echo '{"model":{"display_name":"Opus"},"context_window":{"current_usage":{"input_tokens":45000},"context_window_size":200000}}' | node dist/index.js
```

## Architecture

### Data Flow

```
Claude Code → stdin JSON → parse → render lines → stdout → Claude Code displays
           ↘ transcript_path → parse JSONL → tools/agents/todos
```

**Key insight**: The statusline is invoked every ~300ms by Claude Code. Each invocation:
1. Receives JSON via stdin (model, context, tokens - native accurate data)
2. Parses the transcript JSONL file for tools, agents, and todos
3. Renders multi-line output to stdout
4. Claude Code displays all lines

### Data Sources

**Native from stdin JSON** (accurate, no estimation):
- `model.display_name` - Current model
- `context_window.current_usage` - Token counts
- `context_window.context_window_size` - Max context
- `transcript_path` - Path to session transcript

**From transcript JSONL parsing**:
- `tool_use` blocks → tool name, input, start time
- `tool_result` blocks → completion, duration
- Running tools = `tool_use` without matching `tool_result`
- `TodoWrite` calls → todo list
- `Task` calls → agent info

**From config files**:
- MCP count from `~/.claude/settings.json` (mcpServers)
- Hooks count from `~/.claude/settings.json` (hooks)
- Rules count from CLAUDE.md files

**From Claude Code stdin rate limits**:
- `rate_limits.five_hour.used_percentage` - 5-hour subscriber usage percentage
- `rate_limits.five_hour.resets_at` - 5-hour reset timestamp
- `rate_limits.seven_day.used_percentage` - 7-day subscriber usage percentage
- `rate_limits.seven_day.resets_at` - 7-day reset timestamp

### File Structure

```
src/
├── index.ts             # Entry point
├── stdin.ts             # Parse Claude's JSON input
├── transcript.ts        # Parse transcript JSONL
├── config-reader.ts     # Read MCP/rules configs
├── config.ts            # Load/validate user config
├── git.ts               # Git status (branch, dirty, ahead/behind)
├── cost.ts              # Cost estimation (native stdin cost preferred)
├── effort.ts            # Thinking effort parsing
├── external-usage.ts    # External usage snapshot fallback / balance_label
├── speed-tracker.ts     # Output speed tracking
├── context-cache.ts     # Context/usage caching across invocations
├── memory.ts            # System memory stats
├── claude-config-dir.ts # Resolve the Claude config directory
├── constants.ts         # Shared constants
├── debug.ts             # Debug logging
├── extra-cmd.ts         # Run an optional user command for a custom label
├── version.ts           # Plugin version handling
├── i18n/                # HUD label translations (en, zh-Hans)
├── utils/               # Shared helpers
├── types.ts             # TypeScript interfaces
└── render/
    ├── index.ts             # Main render coordinator
    ├── session-line.ts      # Compact mode: single line with all info
    ├── tools-line.ts        # Tool activity (opt-in)
    ├── skills-mcp-line.ts   # Skills & MCP activity (opt-in)
    ├── agents-line.ts       # Agent status (opt-in)
    ├── todos-line.ts        # Todo progress (opt-in)
    ├── colors.ts            # ANSI color helpers
    ├── width.ts             # Terminal width / CJK-aware measurement
    ├── format-reset-time.ts # Usage reset time formatting
    └── lines/
        ├── index.ts         # Barrel export
        ├── project.ts       # Model bracket + project + git (+ advisor)
        ├── identity.ts      # Context bar
        ├── usage.ts         # Usage bar (merged with context by default)
        ├── environment.ts   # Config counts (opt-in)
        ├── advisor.ts       # Advisor model label (opt-in)
        ├── cost.ts          # Session cost display
        ├── prompt-cache.ts  # Prompt cache countdown
        ├── memory.ts        # Memory usage display
        ├── session-time.ts  # Session duration / timestamps
        ├── session-tokens.ts # Session token totals
        ├── added-dirs.ts    # /add-dir workspace directories
        └── label-align.ts   # Label column alignment
```

### Output Format (default expanded layout)

```
[Opus] │ my-project git:(main*)
Context █████░░░░░ 45% │ Usage ██░░░░░░░░ 25% (1h 30m / 5h)
```

Lines 1-2 always shown. Additional lines are opt-in via config:
- Tools line (`showTools`): ◐ Edit: auth.ts | ✓ Read ×3
- Skills/MCP lines (`showSkills` / `showMcp`): active Skill invocations and MCP servers; when the Skills line is enabled, Skill-tool entries are suppressed from the tools line
- Agents line (`showAgents`): ◐ explore [haiku]: Finding auth code
- Todos line (`showTodos`): ▸ Fix authentication bug (2/5)
- Environment line (`showConfigCounts`): 2 CLAUDE.md | 4 rules
- Advisor label (`showAdvisor`): inlined on the project line, e.g. `Advisor: Opus 4.7`

### Context Thresholds

| Threshold | Color | Action |
|-----------|-------|--------|
| <70% | Green | Normal |
| 70-85% | Yellow | Warning |
| >85% | Red | Show token breakdown |

## Plugin Configuration

The plugin manifest is in `.claude-plugin/plugin.json` (metadata only - name, description, version, author).

**StatusLine configuration** must be added to the user's `~/.claude/settings.json` via `/claude-hud:setup`.

The setup command adds an auto-updating command that finds the latest installed version at runtime.

Note: `statusLine` is NOT a valid plugin.json field. It must be configured in settings.json after plugin installation. Updates are automatic - no need to re-run setup.

## Dependencies

- **Runtime**: Node.js 18+ or Bun
- **Build**: TypeScript 5, ES2022 target, NodeNext modules


<!-- BEGIN BEADS INTEGRATION v:1 profile:minimal hash:7510c1e2 -->
## Beads Issue Tracker

This project uses **bd (beads)** for issue tracking. Run `bd prime` to see full workflow context and commands.

### Quick Reference

```bash
bd ready              # Find available work
bd show <id>          # View issue details
bd update <id> --claim  # Claim work
bd close <id>         # Complete work
```

### Rules

- Use `bd` for ALL task tracking — do NOT use TodoWrite, TaskCreate, or markdown TODO lists
- Run `bd prime` for detailed command reference and session close protocol
- Use `bd remember` for persistent knowledge — do NOT use MEMORY.md files

**Architecture in one line:** issues live in a local Dolt DB; sync uses `refs/dolt/data` on your git remote; `.beads/issues.jsonl` is a passive export. See https://github.com/gastownhall/beads/blob/main/docs/SYNC_CONCEPTS.md for details and anti-patterns.

## Session Completion

**When ending a work session**, you MUST complete ALL steps below. Work is NOT complete until `git push` succeeds.

**MANDATORY WORKFLOW:**

1. **File issues for remaining work** - Create issues for anything that needs follow-up
2. **Run quality gates** (if code changed) - Tests, linters, builds
3. **Update issue status** - Close finished work, update in-progress items
4. **PUSH TO REMOTE** - This is MANDATORY:
   ```bash
   git pull --rebase
   git push
   git status  # MUST show "up to date with origin"
   ```
5. **Clean up** - Clear stashes, prune remote branches
6. **Verify** - All changes committed AND pushed
7. **Hand off** - Provide context for next session

**CRITICAL RULES:**
- Work is NOT complete until `git push` succeeds
- NEVER stop before pushing - that leaves work stranded locally
- NEVER say "ready to push when you are" - YOU must push
- If push fails, resolve and retry until it succeeds
<!-- END BEADS INTEGRATION -->
