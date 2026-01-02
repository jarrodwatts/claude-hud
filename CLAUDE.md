# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

Claude HUD is a Claude Code plugin that displays a real-time terminal HUD (Heads-Up Display) in a split pane. It shows context usage, tool activity, agent status, todos, git status, and cost estimation.

## Build Commands

```bash
# All commands run from tui/ directory
cd tui

bun install          # Install dependencies
bun run build        # Build TypeScript
bun run dev          # Watch mode for development
bun test             # Run all tests
bun test <pattern>   # Run specific test (e.g., bun test sparkline)

# Manual testing with a FIFO
mkfifo /tmp/test.fifo
bun run start -- --session test --fifo /tmp/test.fifo
# Then in another terminal, send test events to the FIFO
```

## Architecture

### Data Flow

```
Claude Code Hooks → capture-event.sh → FIFO → EventReader → React State → Ink Components
```

1. **hooks/hooks.json** - Registers shell scripts for Claude Code lifecycle events
2. **scripts/capture-event.sh** - Transforms hook JSON into HudEvent format, writes to session FIFO
3. **scripts/session-start.sh** - Creates FIFO, builds TUI if needed, spawns HUD in terminal split
4. **tui/src/lib/event-reader.ts** - Reads FIFO line-by-line, parses JSON, emits events with auto-reconnect
5. **tui/src/index.tsx** - Main App component, processes events and manages all state

### Hook Events

| Event | Script | Purpose |
|-------|--------|---------|
| SessionStart | session-start.sh | Spawns HUD in split pane |
| PreToolUse | capture-event.sh | Shows tool as "running" |
| PostToolUse | capture-event.sh | Updates tool completion, tracks context/cost |
| UserPromptSubmit | capture-event.sh | Tracks user prompts, clears idle state |
| Stop | capture-event.sh | Sets idle state |
| PreCompact | capture-event.sh | Increments compaction count |
| SubagentStop | capture-event.sh | Marks agent complete |
| SessionEnd | cleanup.sh | Kills process, removes FIFO |

### Library Structure (tui/src/lib/)

- **types.ts** - All TypeScript interfaces (HudEvent, ToolEntry, TodoItem, ContextHealth, etc.)
- **event-reader.ts** - FIFO reader with connection status and exponential backoff reconnect
- **context-tracker.ts** - Estimates token usage, burn rate, compaction warnings
- **cost-tracker.ts** - Calculates API costs based on model pricing

### Component Structure (tui/src/components/)

- **ContextMeter** - Token usage bar, sparkline history, burn rate
- **ToolStream** - Live tool calls with status, duration, path truncation
- **AgentList** - Running/completed subagents with elapsed time
- **SessionStats** - Tool counts, lines changed, session duration
- **GitStatus** - Branch, staged/modified/untracked counts
- **TodoList** - Current task list from TodoWrite events
- **ModifiedFiles** - Files changed via Edit/Write
- **McpStatus** - Connected MCP servers
- **Sparkline** - Unicode sparkline chart (▁▂▃▄▅▆▇█)

### Session Files

Runtime files stored in `~/.claude/hud/`:
- `events/<session_id>.fifo` - Named pipe for event streaming
- `pids/<session_id>.pid` - Process ID for cleanup
- `logs/<session_id>.log` - Fallback output when split pane unavailable

## Dependencies

- **Runtime**: Node.js 18+ or Bun, jq (JSON parsing in hooks)
- **TUI Framework**: React 18 + Ink 5 (terminal UI via Yoga layout)
- **Build**: TypeScript 5, ES2022 target, NodeNext modules
- **Testing**: Vitest + @testing-library/react + ink-testing-library
