# Troubleshooting Claude HUD

## HUD Not Appearing

### 1. Check Plugin Installation
```bash
# Verify the plugin is installed
ls ~/.claude/plugins/ | grep claude-hud
```

If not listed, install with:
```bash
claude /plugin install github.com/jarrodwatts/claude-hud
```

### 2. Check Plugin Validation
```bash
# Validate the plugin structure
claude plugin validate ~/.claude/plugins/claude-hud
```

You should see: `✔ Validation passed`

### 3. Check Terminal Support
The HUD works best with terminals that support split panes:
- **tmux** - Best support, native split
- **iTerm2** - Native split on macOS
- **Kitty** - Remote control split
- **WezTerm** - CLI split pane
- **Zellij** - Native split

For other terminals, the HUD runs in a separate window or background.

### 4. Check Dependencies
```bash
# Ensure jq is installed (required for hook scripts)
which jq || echo "jq not found - install with: brew install jq"

# Check Node.js or Bun is available
which node || which bun || echo "Node.js or Bun required"
```

### 4b. Check Bootstrap Log
If the HUD fails to launch, a bootstrap log is written with actionable fixes:
```bash
cat ~/.claude/hud/logs/hud-bootstrap.log
```

### 5. Manual Testing
Test the HUD manually:
```bash
# Create a test FIFO
mkfifo /tmp/test-hud.fifo

# Start the HUD (in one terminal)
cd ~/.claude/plugins/claude-hud/tui
node dist/index.js --session test --fifo /tmp/test-hud.fifo

# Send a test event (in another terminal)
echo '{"event":"PostToolUse","tool":"Read","input":{"file_path":"/test.ts"},"response":{"content":"test"},"session":"test","ts":1234567890}' > /tmp/test-hud.fifo
```

You should see the event appear in the HUD.

## HUD Appears But No Data

### Check FIFO Connection
The HUD connects via a named pipe. Check if it exists:
```bash
ls -la ~/.claude/hud/events/
```

You should see `.fifo` files for active sessions.

### Check Hook Execution
Run Claude with debug mode to see hook execution:
```bash
claude --debug hooks
```

Look for messages about `capture-event.sh` being called.

### Check Logs
View HUD logs if running in background:
```bash
cat ~/.claude/hud/logs/*.log
```

## Common Issues

### "jq: command not found"
Install jq:
```bash
# macOS
brew install jq

# Ubuntu/Debian
sudo apt-get install jq

# Other Linux
# Use your package manager
```

### "Permission denied" on Scripts
Make scripts executable:
```bash
chmod +x ~/.claude/plugins/claude-hud/scripts/*.sh
```

### HUD Freezes or Crashes
1. Check for error in logs: `cat ~/.claude/hud/logs/*.log`
2. Kill any stuck processes: `pkill -f claude-hud`
3. Remove stale FIFOs: `rm ~/.claude/hud/events/*.fifo`
4. Start a new Claude session

### tmux Split Not Working
Ensure you're running Claude inside tmux:
```bash
# Check if in tmux
echo $TMUX

# Start tmux if not
tmux new-session
```

### iTerm2 Split Not Working
Ensure iTerm2 is the active terminal:
```bash
echo $TERM_PROGRAM
# Should output: iTerm.app
```

## Getting Help

If you're still having issues:
1. Check the [GitHub Issues](https://github.com/jarrodwatts/claude-hud/issues)
2. Open a new issue with:
   - Your terminal type
   - Output of `claude plugin validate`
   - Any error messages from logs
   - Steps to reproduce

## Debug Mode

Enable debug logging for more verbose output:
```bash
# Method 1: Environment variable (recommended)
CLAUDE_HUD_DEBUG=1 claude

# Method 2: Claude's built-in debug mode
claude --debug hooks

# Method 3: Manual testing with debug output
cd ~/.claude/plugins/claude-hud/tui
CLAUDE_HUD_DEBUG=1 node dist/index.js --session test --fifo /tmp/test.fifo
```

Debug output is written to stderr and includes:
- Event parsing errors
- FIFO connection status
- Transcript file reading attempts
