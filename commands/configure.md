---
description: Configure HUD display options (layout, presets, display elements)
allowed-tools: Read, Write, AskUserQuestion
---

# Configure Claude HUD

**FIRST**: Use the Read tool to load `~/.claude/plugins/claude-hud/config.json` if it exists.

Store current values and note whether config exists (determines which flow to use).

## Always On (Core Features)

These are always enabled and NOT configurable:
- Model name `[Opus]`
- Context bar `████░░░░░░ 45%`

---

## Two Flows Based on Config State

### Flow A: New User (NO config exists)
Questions: **Layout → Preset → Turn Off → Turn On**

### Flow B: Returning User (config EXISTS)
Questions: **Turn Off → Turn On → Git Style → Layout/Reset**

---

## Flow A: New User (4 Questions)

### Q1: Layout
- header: "Layout"
- question: "Choose your HUD layout:"
- multiSelect: false
- options:
  - "Default" - Single line, all info together
  - "Separators" - Line below header separates activity

### Q2: Preset
- header: "Preset"
- question: "Choose a starting configuration:"
- multiSelect: false
- options:
  - "Full" - Everything enabled (Recommended)
  - "Essential" - Activity + git, minimal info
  - "Minimal" - Core only (model, context bar)

### Q3: Turn Off (based on chosen preset)
- header: "Turn Off"
- question: "Disable any of these? (enabled by your preset)"
- multiSelect: true
- options: **ONLY items that are ON in the chosen preset** (max 4)
  - "Tools activity" - ◐ Edit: file.ts | ✓ Read ×3
  - "Agents status" - ◐ explore [haiku]: Finding code
  - "Todo progress" - ▸ Fix bug (2/5 tasks)
  - "Git status" - git:(main*) branch indicator
  - "Config counts" - 2 CLAUDE.md | 4 rules
  - "Token breakdown" - (in: 45k, cache: 12k)
  - "Usage limits" - 5h: 25% | 7d: 10%
  - "Session duration" - ⏱️ 5m

### Q4: Turn On (based on chosen preset)
- header: "Turn On"
- question: "Enable any of these? (disabled by your preset)"
- multiSelect: true
- options: **ONLY items that are OFF in the chosen preset** (max 4)
  - (same list as above, filtered to OFF items)

**Note:** If preset has all items ON (Full), Q4 shows "Nothing to enable - Full preset has everything!"
If preset has all items OFF (Minimal), Q3 shows "Nothing to disable - Minimal preset is already minimal!"

---

## Flow B: Returning User (4 Questions)

### Q1: Turn Off
- header: "Turn Off"
- question: "What do you want to DISABLE? (currently enabled)"
- multiSelect: true
- options: **ONLY items currently ON** (max 4, prioritize Activity first)
  - "Tools activity" - ◐ Edit: file.ts | ✓ Read ×3
  - "Agents status" - ◐ explore [haiku]: Finding code
  - "Todo progress" - ▸ Fix bug (2/5 tasks)
  - "Git status" - git:(main*) branch indicator

If more than 4 items ON, show Activity items (Tools, Agents, Todos, Git) first.
Info items (Counts, Tokens, Usage, Duration) can be turned off via "Reset to Minimal" in Q4.

### Q2: Turn On
- header: "Turn On"
- question: "What do you want to ENABLE? (currently disabled)"
- multiSelect: true
- options: **ONLY items currently OFF** (max 4)
  - "Config counts" - 2 CLAUDE.md | 4 rules
  - "Token breakdown" - (in: 45k, cache: 12k)
  - "Usage limits" - 5h: 25% | 7d: 10%
  - "Session duration" - ⏱️ 5m

### Q3: Git Style (only if Git is currently enabled)
- header: "Git Style"
- question: "How much git info to show?"
- multiSelect: false
- options:
  - "Branch only" - git:(main)
  - "Branch + dirty" - git:(main*) shows uncommitted changes
  - "Full details" - git:(main* ↑2 ↓1) includes ahead/behind

**Skip Q3 if Git is OFF** - show only 3 questions total, or replace with placeholder.

### Q4: Layout/Reset
- header: "Layout/Reset"
- question: "Change layout or reset to preset?"
- multiSelect: false
- options:
  - "Keep current" - No layout/preset changes (current: Default/Separators)
  - "Switch to Default" or "Switch to Separators" (whichever isn't current)
  - "Reset to Full" - Enable everything
  - "Reset to Essential" - Activity + git only

---

## Preset Definitions

**Full** (everything ON):
- Activity: Tools ON, Agents ON, Todos ON
- Info: Counts ON, Tokens ON, Usage ON, Duration ON
- Git: ON (with dirty indicator, no ahead/behind)

**Essential** (activity + git):
- Activity: Tools ON, Agents ON, Todos ON
- Info: Counts OFF, Tokens OFF, Usage OFF, Duration ON
- Git: ON (with dirty indicator)

**Minimal** (core only):
- Activity: Tools OFF, Agents OFF, Todos OFF
- Info: Counts OFF, Tokens OFF, Usage OFF, Duration OFF
- Git: OFF

---

## Git Style Mapping

| Option | Config |
|--------|--------|
| Branch only | `gitStatus: { enabled: true, showDirty: false, showAheadBehind: false }` |
| Branch + dirty | `gitStatus: { enabled: true, showDirty: true, showAheadBehind: false }` |
| Full details | `gitStatus: { enabled: true, showDirty: true, showAheadBehind: true }` |

---

## Element Mapping

| Element | Config Key |
|---------|------------|
| Tools activity | `display.showTools` |
| Agents status | `display.showAgents` |
| Todo progress | `display.showTodos` |
| Git status | `gitStatus.enabled` |
| Config counts | `display.showConfigCounts` |
| Token breakdown | `display.showTokenBreakdown` |
| Usage limits | `display.showUsage` |
| Session duration | `display.showDuration` |

**Always true (not configurable):**
- `display.showModel: true`
- `display.showContextBar: true`

---

## Processing Logic

### For New Users (Flow A):
1. Apply chosen preset as base
2. Apply Turn Off selections (set those items to OFF)
3. Apply Turn On selections (set those items to ON)
4. Apply chosen layout

### For Returning Users (Flow B):
1. Start from current config
2. Apply Turn Off selections (set to OFF)
3. Apply Turn On selections (set to ON)
4. Apply Git Style selection (if shown)
5. If "Reset to [preset]" selected, override with preset values
6. If layout change selected, apply it

---

## Before Writing - Validate & Preview

**GUARDS - Do NOT write config if:**
- User cancels (Esc) → say "Configuration cancelled."
- No changes from current config → say "No changes needed - config unchanged."

**Show preview before saving:**

1. **Summary of changes:**
```
Layout: Default → Separators
Git style: Branch + dirty
Changes:
  - Usage limits: OFF → ON
  - Config counts: ON → OFF
```

2. **Preview of HUD:**
```
[Opus] ████░░░░░ 45% | my-project git:(main*) | 5h: 25% | ⏱️ 5m
──────────────────────────────────────────────────────────────
◐ Edit: file.ts | ✓ Read ×3
▸ Fix auth bug (2/5)
```

3. **Confirm**: "Save these changes?"

---

## Write Configuration

Write to `~/.claude/plugins/claude-hud/config.json`.

Merge with existing config, preserving:
- `pathLevels` (not in configure flow)

---

## After Writing

Say: "Configuration saved! The HUD will reflect your changes immediately."
