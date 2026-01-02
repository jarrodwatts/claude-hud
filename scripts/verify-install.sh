#!/bin/bash
# Claude HUD Installation Verification Script

set -uo pipefail

GREEN='\033[0;32m'
YELLOW='\033[1;33m'
RED='\033[0;31m'
NC='\033[0m' # No Color

echo "🔍 Claude HUD Installation Verification"
echo "========================================"
echo ""

ERRORS=0

# Check jq
echo -n "Checking jq... "
if command -v jq &> /dev/null; then
    echo -e "${GREEN}✓${NC} $(jq --version)"
else
    echo -e "${RED}✗ Not found${NC}"
    echo "  Install with: brew install jq (macOS) or apt-get install jq (Linux)"
    ERRORS=$((ERRORS + 1))
fi

# Check Node.js or Bun
echo -n "Checking Node.js/Bun... "
if command -v bun &> /dev/null; then
    echo -e "${GREEN}✓${NC} bun $(bun --version)"
elif command -v node &> /dev/null; then
    echo -e "${GREEN}✓${NC} node $(node --version)"
else
    echo -e "${RED}✗ Neither found${NC}"
    echo "  Install Node.js or Bun"
    ERRORS=$((ERRORS + 1))
fi

# Check plugin directory
PLUGIN_DIR="${CLAUDE_PLUGIN_ROOT:-$(dirname "$0")/..}"
echo -n "Checking plugin directory... "
if [ -d "$PLUGIN_DIR" ]; then
    echo -e "${GREEN}✓${NC} $PLUGIN_DIR"
else
    echo -e "${RED}✗ Not found${NC}"
    ERRORS=$((ERRORS + 1))
fi

# Check plugin.json
echo -n "Checking plugin.json... "
if [ -f "$PLUGIN_DIR/.claude-plugin/plugin.json" ]; then
    VERSION=$(jq -r '.version' "$PLUGIN_DIR/.claude-plugin/plugin.json" 2>/dev/null)
    echo -e "${GREEN}✓${NC} v$VERSION"
else
    echo -e "${RED}✗ Not found${NC}"
    ERRORS=$((ERRORS + 1))
fi

# Check hooks.json
echo -n "Checking hooks.json... "
if [ -f "$PLUGIN_DIR/hooks/hooks.json" ]; then
    HOOK_COUNT=$(jq '.hooks | keys | length' "$PLUGIN_DIR/hooks/hooks.json" 2>/dev/null)
    echo -e "${GREEN}✓${NC} $HOOK_COUNT hooks configured"
else
    echo -e "${RED}✗ Not found${NC}"
    ERRORS=$((ERRORS + 1))
fi

# Check TUI build
echo -n "Checking TUI build... "
if [ -f "$PLUGIN_DIR/tui/dist/index.js" ]; then
    echo -e "${GREEN}✓${NC} Built"
else
    echo -e "${YELLOW}○${NC} Not built yet (will auto-build on first run)"
fi

# Check scripts are executable
echo -n "Checking scripts... "
SCRIPT_ERRORS=0
for script in session-start.sh capture-event.sh cleanup.sh; do
    if [ ! -x "$PLUGIN_DIR/scripts/$script" ]; then
        SCRIPT_ERRORS=$((SCRIPT_ERRORS + 1))
    fi
done
if [ $SCRIPT_ERRORS -eq 0 ]; then
    echo -e "${GREEN}✓${NC} All executable"
else
    echo -e "${YELLOW}○${NC} Making scripts executable..."
    chmod +x "$PLUGIN_DIR/scripts/"*.sh 2>/dev/null || true
fi

# Check HUD directory
echo -n "Checking HUD data directory... "
HUD_DIR="$HOME/.claude/hud"
if [ -d "$HUD_DIR" ]; then
    echo -e "${GREEN}✓${NC} $HUD_DIR"
else
    echo -e "${YELLOW}○${NC} Will be created on first run"
fi

# Check terminal
echo -n "Checking terminal... "
if [ -n "$TMUX" ]; then
    echo -e "${GREEN}✓${NC} tmux (native split support)"
elif [ "$TERM_PROGRAM" = "iTerm.app" ]; then
    echo -e "${GREEN}✓${NC} iTerm2 (native split support)"
elif [ -n "$KITTY_PID" ]; then
    echo -e "${GREEN}✓${NC} Kitty (remote control split)"
elif [ "$TERM_PROGRAM" = "WezTerm" ]; then
    echo -e "${GREEN}✓${NC} WezTerm (CLI split pane)"
elif [ -n "$ZELLIJ" ]; then
    echo -e "${GREEN}✓${NC} Zellij (native split)"
elif [ -n "$WT_SESSION" ]; then
    echo -e "${GREEN}✓${NC} Windows Terminal (WSL split)"
else
    echo -e "${YELLOW}○${NC} ${TERM_PROGRAM:-Unknown} (separate window mode)"
fi

echo ""
echo "========================================"
if [ $ERRORS -eq 0 ]; then
    echo -e "${GREEN}✓ All checks passed!${NC}"
    echo ""
    echo "Start a new Claude Code session to see the HUD."
    exit 0
else
    echo -e "${RED}✗ $ERRORS issue(s) found${NC}"
    echo ""
    echo "Please fix the issues above and run this script again."
    echo "See TROUBLESHOOTING.md for more help."
    exit 1
fi
