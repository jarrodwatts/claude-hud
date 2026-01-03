---
active: true
iteration: 1
max_iterations: 50
completion_promise: "STATUSLINE V2 COMPLETE"
started_at: "2026-01-03T03:24:24Z"
---

Implement claude-hud v2 statusline architecture per the plan at ~/.claude/plans/moonlit-jingling-flurry.md

## GOAL
Rewrite claude-hud from split-pane TUI to multi-line statusline. X-ray vision for Claude Code - show whats happening during long operations.

## TARGET OUTPUT
[Opus] ████████░░ 45% | 📋 3 rules | 🔌 5 MCPs | ⏱️ 12m
◐ Edit: auth.ts | ✓ Read ×3 | ✓ Grep ×2
◐ explore [haiku]: Finding auth code (2m 15s)
▸ Fix authentication bug (2/5)

## PHASE 1: Setup
- Tag v1: git tag v1.0.0-split-pane
- Create branch: git checkout -b v2-statusline
- Clean out old files (hooks/, tui/, scripts/)
- Create new structure: src/index.ts, src/stdin.ts, src/transcript.ts, src/render/
- Update plugin.json with statusLine config
- PUSH after phase

## PHASE 2: Core Parsers
- stdin.ts: Parse Claudes JSON (model, context_window, transcript_path)
- transcript.ts: Parse JSONL for tools (tool_use/tool_result), agents (Task), todos (TodoWrite)
- Detect running tools = tool_use without matching tool_result
- Types for everything
- PUSH after phase

## PHASE 3: Render Lines
- colors.ts: ANSI helpers (green, yellow, red, reset)
- session-line.ts: [Model] context bar % | rules | MCPs | duration
- tools-line.ts: Running tool + completed counts
- agents-line.ts: Type [model]: description (elapsed)
- todos-line.ts: Current todo (completed/total)
- index.ts: Orchestrate all lines, console.log each
- PUSH after phase

## PHASE 4: Polish and Ship
- Error handling (graceful degradation)
- Config reader for MCP/rules counts
- Performance (cache transcript parsing)
- Test: build, then simulate stdin pipe
- Update README
- PUSH after phase

## RULES
1. Commit after meaningful progress
2. PUSH after each PHASE completes
3. If stuck 3+ times on same issue, TODO comment and move on
4. No hooks needed - read transcript directly
5. Target <50ms render time
6. Zero config - must just work

## COMPLETION
Output <promise>STATUSLINE V2 COMPLETE</promise> ONLY when:
- All 4 lines rendering with correct format
- Context bar with color thresholds (green/yellow/red)
- Tool activity showing ◐ running and ✓ completed
- Agent tracking with [model] and description
- Todo progress with (x/y) format
- plugin.json has statusLine config
- Builds successfully
- README updated with new architecture
