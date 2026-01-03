# Architecture

Claude HUD is a Claude Code plugin that renders a real-time TUI from hook events.

## High-Level Flow

```
Claude Code hooks
  -> scripts/capture-event.sh
  -> session FIFO (~/.claude/hud/events/<session>.fifo)
  -> tui/src/lib/event-reader.ts
  -> tui/src/hooks/useHudState.ts
  -> tui/src/app.tsx
  -> Ink UI panels
```

## Plugin Structure

```
claude-hud/
  .claude-plugin/plugin.json
  hooks/hooks.json
  scripts/
  tui/
```

- `.claude-plugin/plugin.json` declares the plugin and hook entrypoints.
- `hooks/hooks.json` subscribes to Claude Code lifecycle events.
- `scripts/` normalizes event payloads and launches the HUD.
- `tui/` contains the Ink-based terminal UI.

## Runtime Files

The HUD writes runtime artifacts under `~/.claude/hud/`:

- `events/<session_id>.fifo` - Event stream (session-scoped)
- `pids/<terminal_id>.pid` - HUD process ID (terminal-scoped)
- `refresh-<terminal_id>.json` - Current session state (terminal-scoped)
- `logs/<session_id>.log` - Fallback output

### Terminal vs Session Scoping

Each terminal window gets ONE HUD instance, tracked by a terminal ID derived from:
- tmux: `#{window_id}` (e.g., `tmux-@0`)
- iTerm2: `ITERM_SESSION_ID`
- Kitty: `KITTY_WINDOW_ID`
- WezTerm: `WEZTERM_PANE`
- Fallback: TTY device or parent PID

This ensures:
- Multiple Claude instances in different windows → separate HUDs
- `/new` within same window → HUD switches sessions (not duplicated)

## Key Components

- `tui/src/lib/event-reader.ts` reads the FIFO and reconnects if it drops.
- `tui/src/hooks/useHudState.ts` is the single source of truth for HUD state.
- `tui/src/components/` renders panels such as ContextMeter, ToolStream, AgentList.
- `tui/src/lib/unified-context-tracker.ts` handles context usage and burn rate.
- `tui/src/lib/cost-tracker.ts` calculates input/output cost.

## Hook Events

Common events used by the HUD:

- `SessionStart`: spawn HUD in a split pane
- `PreToolUse`: show tool in running state
- `PostToolUse`: record completion and metrics
- `UserPromptSubmit`: track prompts and idle state
- `Stop`: mark idle
- `PreCompact`: compaction counter
- `SubagentStop`: agent completion
- `SessionEnd`: cleanup
