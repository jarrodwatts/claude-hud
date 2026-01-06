# Claude HUD Configuration Skill

Configure the Claude HUD statusline display options interactively.

## Instructions

Use the AskUserQuestion tool to gather the user's preferences, then write the configuration file.

### Step 1: Menu Selection

First, ask what the user wants to configure:

**Question 1 - Menu:**
- header: "Configure"
- question: "What would you like to configure?"
- multiSelect: false
- options:
  - "Full Setup (Recommended)" - Configure all HUD options in one flow
  - "Layout only" - Change between Default, Condensed, or Separators
  - "Path display only" - Adjust directory levels shown
  - "Git status only" - Toggle branch, dirty, ahead/behind indicators
  - "Display elements only" - Choose which elements to show/hide

### Step 2: Based on Selection

**If "Full Setup"** → Ask all questions below (2-5)
**If individual section** → Ask only that section's question, preserve other settings

---

### Full Setup Questions (or individual section questions)

**Question 2 - Layout:**
- header: "Layout"
- question: "Which HUD layout style do you prefer?"
- multiSelect: false
- options:
  - "Default" - All info on first line
  - "Condensed" - Model/context top, project bottom
  - "Separators" - Condensed with visual separator lines

**Question 3 - Path Levels:**
- header: "Path"
- question: "How many directory levels to show?"
- multiSelect: false
- options:
  - "1 level" - Just project name (my-project)
  - "2 levels" - Parent/project (apps/my-project)
  - "3 levels" - Grandparent/parent/project (dev/apps/my-project)

**Question 4 - Git Status:**
- header: "Git"
- question: "Which git status indicators do you want?"
- multiSelect: false
- options:
  - "All indicators (Recommended)" - Branch, dirty (*), and ahead/behind (↑ ↓)
  - "Branch only" - Just show current branch name
  - "Branch + dirty" - Branch and uncommitted changes indicator
  - "Disable git status" - Don't show any git information

**Question 5 - Display Elements:**
- header: "Display"
- question: "Which display preset do you prefer?"
- multiSelect: false
- options:
  - "All elements (Recommended)" - Show everything
  - "Essential only" - Model, context bar, tools (hide counts, duration, tokens, usage)
  - "Hide config counts" - Don't show CLAUDE.md, rules, MCPs, hooks
  - "Hide duration" - Don't show session timer
  - "Hide usage limits" - Don't show 5h/7d usage (requires CLAUDE_HUD_SHOW_USAGE=1 to be enabled first)

---

## Step 3: Write Configuration

1. Read existing config from `~/.claude/plugins/claude-hud/config.json` (if exists)
2. Merge new selections with existing config (for partial updates)
3. Write the updated config using the Write tool

### Config Mapping

**Layout:**
- "Default" → `"layout": "default"`
- "Condensed" → `"layout": "condensed"`
- "Separators" → `"layout": "separators"`

**Path:**
- "1 level" → `"pathLevels": 1`
- "2 levels" → `"pathLevels": 2`
- "3 levels" → `"pathLevels": 3`

**Git Status:**
- "All indicators" → `gitStatus: { enabled: true, showDirty: true, showAheadBehind: true }`
- "Branch only" → `gitStatus: { enabled: true, showDirty: false, showAheadBehind: false }`
- "Branch + dirty" → `gitStatus: { enabled: true, showDirty: true, showAheadBehind: false }`
- "Disable git status" → `gitStatus: { enabled: false, showDirty: false, showAheadBehind: false }`

**Display Elements:**
- "All elements" → all display options true
- "Essential only" → `showModel: true, showContextBar: true, showTools: true`, others false
- "Hide config counts" → `showConfigCounts: false`
- "Hide duration" → `showDuration: false`
- "Hide usage limits" → `showUsage: false`

**Note:** Usage display requires BOTH:
1. Environment variable `CLAUDE_HUD_SHOW_USAGE=1` (enables the capability)
2. Config `showUsage: true` (controls display - default is true)

---

## Step 4: Confirm

After writing the config, confirm to the user what was changed. The HUD will automatically pick up the new configuration on next render.
