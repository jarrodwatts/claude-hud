---
description: Configure HUD display options (layout, language, presets, display elements) while preserving advanced manual overrides
allowed-tools: Read, Write, AskUserQuestion
---

# Configure Claude HUD

**FIRST**: Use the Read tool to load `~/.claude/plugins/claude-hud/config.json` if it exists.

Store current values and note whether config exists (determines which flow to use).

## Always On (Core Features)

These are always enabled and NOT configurable:
- Model name `[Opus]`
- Context bar `████░░░░░░ 45%`

Advanced settings such as `colors.*`, `pathLevels`, `display.timeFormat`,
`display.usageThreshold`, `display.environmentThreshold`, `display.contextWarningThreshold`,
and `display.contextCriticalThreshold` are preserved when saving but are not
edited by this guided flow.

---

## Two Flows Based on Config State

### Flow A: New User (no config)
Questions: **Layout → Preset → Language → Turn Off → Turn On → Custom Line**

### Flow B: Update Config (config exists)
Questions: **Turn Off → Turn On → Git Style → Layout/Reset → Language → Custom Line** (6 questions max)

---

## Flow A: New User (6 Questions)

### Q1: Layout
- header: "Layout"
- question: "Choose your HUD layout:"
- multiSelect: false
- options:
  - "Expanded (Recommended)" - Split into semantic lines (identity, project, environment, usage)
  - "Compact" - Everything on one line
  - "Compact + Separators" - One line with separator before activity

### Q2: Preset
- header: "Preset"
- question: "Choose a starting configuration:"
- multiSelect: false
- options:
  - "Full" - Everything enabled (Recommended)
  - "Essential" - Activity + git, minimal info
  - "Minimal" - Core only (model, context bar)

### Q3: Language
- header: "Language"
- question: "Choose your HUD label language:"
- multiSelect: false
- options:
  - "English (Recommended)" - Default, simplest onboarding path
  - "中文" - Show HUD labels and status text in Chinese

Save as `language: "en"` or `language: "zh"`.

### Q4: Turn Off (based on chosen preset)
- header: "Turn Off"
- question: "Disable any of these? (enabled by your preset)"
- multiSelect: true
- options: **ONLY items that are ON in the chosen preset** (max 4)
  - "Tools activity" - ◐ Edit: file.ts | ✓ Read ×3
  - "Agents status" - ◐ explore [haiku]: Finding code
  - "Todo progress" - ▸ Fix bug (2/5 tasks)
  - "Project name" - my-project path display
  - "Git status" - git:(main*) branch indicator
  - "Config counts" - 2 CLAUDE.md | 4 rules
  - "Token breakdown" - (in: 45k, cache: 12k)
  - "Output speed" - out: 42.1 tok/s
  - "Usage limits" - 5h: 25% | 7d: 10%
  - "Compact usage" - 5h: 25% (1h 30m) shorter format
  - "Session duration" - ⏱️ 5m
  - "Session name" - fix-auth-bug (session slug or custom title)
  - "Session tokens" - Tokens 12.8M (in: 7k, out: 28k, cache: 12.8M)

### Q5: Turn On (based on chosen preset)
- header: "Turn On"
- question: "Enable any of these? (disabled by your preset)"
- multiSelect: true
- options: **ONLY items that are OFF in the chosen preset** (max 4)
  - (same list as above, filtered to OFF items)

**Note:** If preset has all items ON (Full), Q5 shows "Nothing to enable - Full preset has everything!"
If preset has all items OFF (Minimal), Q4 shows "Nothing to disable - Minimal preset is already minimal!"

### Q6: Custom Line (optional)
- header: "Custom Line"
- question: "Add a custom phrase to display in the HUD? (e.g. a motto, max 80 chars)"
- multiSelect: false
- options:
  - "Skip" - No custom line
  - "Enter custom text" - Ask user for their phrase via AskUserQuestion (free text input)

If user chooses "Enter custom text", use AskUserQuestion to get their text. Save as `display.customLine` in config.

---

## Flow B: Update Config (6 Questions)

### Q1: Turn Off
- header: "Turn Off"
- question: "What do you want to DISABLE? (currently enabled)"
- multiSelect: true
- options: **ONLY items currently ON** (max 4, prioritize Activity first)
  - "Tools activity" - ◐ Edit: file.ts | ✓ Read ×3
  - "Agents status" - ◐ explore [haiku]: Finding code
  - "Todo progress" - ▸ Fix bug (2/5 tasks)
  - "Project name" - my-project path display
  - "Git status" - git:(main*) branch indicator
  - "Session name" - fix-auth-bug (session slug or custom title)
  - "Session tokens" - Tokens 12.8M (in: 7k, out: 28k, cache: 12.8M)
  - "Usage bar style" - ██░░ 25% visual bar (only if usageBarEnabled is true)
  - "Compact usage" - 5h: 25% (1h 30m) shorter format (only if usageCompact is false)

If more than 4 items ON, show Activity items (Tools, Agents, Todos, Project, Git) first.
Info items (Counts, Tokens, Usage, Speed, Duration) can be turned off via "Reset to Minimal" in Q4.

### Q2: Turn On
- header: "Turn On"
- question: "What do you want to ENABLE? (currently disabled)"
- multiSelect: true
- options: **ONLY items currently OFF** (max 4)
  - "Config counts" - 2 CLAUDE.md | 4 rules
  - "Token breakdown" - (in: 45k, cache: 12k)
  - "Output speed" - out: 42.1 tok/s
  - "Usage limits" - 5h: 25% | 7d: 10%
  - "Usage bar style" - ██░░ 25% visual bar (only if usageBarEnabled is false)
  - "Compact usage" - 5h: 25% (1h 30m) shorter format (only if usageCompact is false)
  - "Session name" - fix-auth-bug (session slug or custom title)
  - "Session tokens" - Tokens 12.8M (in: 7k, out: 28k, cache: 12.8M)
  - "Session duration" - ⏱️ 5m

### Q3: Git Style (only if Git is currently enabled)
- header: "Git Style"
- question: "How much git info to show?"
- multiSelect: false
- options:
  - "Branch only" - git:(main)
  - "Branch + dirty" - git:(main*) shows uncommitted changes
  - "Full details" - git:(main* ↑2 ↓1) includes ahead/behind
  - "File stats" - git:(main* !2 +1 ?3) Starship-compatible format

**Skip Q3 if Git is OFF** - proceed to Q4.

### Q4: Layout/Reset
- header: "Layout/Reset"
- question: "Change layout or reset to preset?"
- multiSelect: false
- options:
  - "Keep current" - No layout/preset changes (current: Expanded/Compact/Compact + Separators)
  - "Switch to Expanded" - Split into semantic lines (if not current)
  - "Switch to Compact" - Everything on one line (if not current)
  - "Reset to Full" - Enable everything
  - "Reset to Essential" - Activity + git only

### Q5: Language
- header: "Language"
- question: "Update HUD label language? (current: '{English or 中文}')"
- multiSelect: false
- options:
  - "Keep current" - No change
  - "English (Recommended)" - Use English HUD labels
  - "中文" - Use Chinese HUD labels

If user chooses "Keep current", leave `language` unchanged.
If user chooses "English (Recommended)", save `language: "en"`.
If user chooses "中文", save `language: "zh"`.

### Q6: Custom Line (optional)
- header: "Custom Line"
- question: "Update your custom phrase? (currently: '{current customLine or none}')"
- multiSelect: false
- options:
  - "Keep current" - No change (skip if no customLine set)
  - "Enter custom text" - Set or update custom phrase (max 80 chars)
  - "Remove" - Clear the custom line (only show if customLine is currently set)

If user chooses "Enter custom text", use AskUserQuestion to get their text. Save as `display.customLine` in config.
If user chooses "Remove", set `display.customLine` to `""` in config.

---

## Preset Definitions

**Full** (everything ON):
- Activity: Tools ON, Agents ON, Todos ON
- Info: Counts ON, Tokens ON, Usage ON, Duration ON, Session Name ON, Session Tokens ON
- Git: ON (with dirty indicator, no ahead/behind)

**Essential** (activity + git):
- Activity: Tools ON, Agents ON, Todos ON
- Info: Counts OFF, Tokens OFF, Usage OFF, Duration ON, Session Name OFF, Session Tokens OFF
- Git: ON (with dirty indicator)

**Minimal** (core only — this is the default):
- Activity: Tools OFF, Agents OFF, Todos OFF
- Info: Counts OFF, Tokens OFF, Usage OFF, Duration OFF, Session Name OFF, Session Tokens OFF
- Git: ON (with dirty indicator)

---

## Layout Mapping

| Option | Config |
|--------|--------|
| Expanded | `lineLayout: "expanded", showSeparators: false` |
| Compact | `lineLayout: "compact", showSeparators: false` |
| Compact + Separators | `lineLayout: "compact", showSeparators: true` |

---

## Language Mapping

| Option | Config |
|--------|--------|
| English (Recommended) | `language: "en"` |
| 中文 | `language: "zh"` |

---

## Git Style Mapping

| Option | Config |
|--------|--------|
| Branch only | `gitStatus: { enabled: true, showDirty: false, showAheadBehind: false, showFileStats: false }` |
| Branch + dirty | `gitStatus: { enabled: true, showDirty: true, showAheadBehind: false, showFileStats: false }` |
| Full details | `gitStatus: { enabled: true, showDirty: true, showAheadBehind: true, showFileStats: false }` |
| File stats | `gitStatus: { enabled: true, showDirty: true, showAheadBehind: false, showFileStats: true }` |

---

## Element Mapping

| Element | Config Key |
|---------|------------|
| Tools activity | `display.showTools` |
| Agents status | `display.showAgents` |
| Todo progress | `display.showTodos` |
| Project name | `display.showProject` |
| Git status | `gitStatus.enabled` |
| Config counts | `display.showConfigCounts` |
| Token breakdown | `display.showTokenBreakdown` |
| Output speed | `display.showSpeed` |
| Usage limits | `display.showUsage` |
| Usage bar style | `display.usageBarEnabled` |
| Compact usage | `display.usageCompact` |
| Session name | `display.showSessionName` |
| Session duration | `display.showDuration` |
| Session tokens | `display.showSessionTokens` |
| Custom line | `display.customLine` |

**Always true (not configurable):**
- `display.showModel: true`
- `display.showContextBar: true`

---

## Usage Style Mapping

| Option | Config | Example |
|--------|--------|---------|
| Bar style | `usageBarEnabled: true` | `Usage ██░░ 25% (resets in 1h 30m)` |
| Text style | `usageBarEnabled: false` | `Usage 5h 25% (resets in 1h 30m)` |
| Compact | `usageCompact: true` | `5h: 25% (1h 30m)` — no "Usage" label, shorter reset format |

`usageCompact` takes precedence over `usageBarEnabled` when both are set. Compact mode always uses the text format (no bar).

**Note**: Usage style only applies when `display.showUsage: true`. When 7d usage >= 80%, it also shows with the same style.

---

## Processing Logic

### For New Users (Flow A):
1. Apply chosen preset as base
2. Apply chosen language
3. Apply Turn Off selections (set those items to OFF)
4. Apply Turn On selections (set those items to ON)
5. Apply chosen layout

### For Returning Users (Flow B):
1. Start from current config
2. Apply Turn Off selections (set to OFF, including usageBarEnabled if selected)
3. Apply Turn On selections (set to ON, including usageBarEnabled if selected)
4. Apply Git Style selection (if shown)
5. If "Reset to [preset]" selected, override with preset values
6. If layout change selected, apply it
7. If language change selected, apply it

---

## Before Writing - Validate & Preview

**GUARDS - Do NOT write config if:**
- User cancels (Esc) → say "Configuration cancelled."
- No changes from current config → say "No changes needed - config unchanged."

**Show preview before saving:**

1. **Summary of changes:**
```
Layout: Compact → Expanded
Language: English → 中文
Git style: Branch + dirty
Changes:
  - Usage limits: OFF → ON
  - Config counts: ON → OFF
```

2. **Preview of HUD (Expanded layout):**
```
[Opus | Pro] │ my-project git:(main*)
Context ████░░░░░ 45% │ Usage ██░░░░░░░░ 25% (1h 30m / 5h)
◐ Edit: file.ts | ✓ Read ×3
▸ Fix auth bug (2/5)
```

**Preview of HUD (Compact layout):**
```
[Opus | Pro] ████░░░░░ 45% | my-project git:(main*) | 5h: 25% | ⏱️ 5m
◐ Edit: file.ts | ✓ Read ×3
▸ Fix auth bug (2/5)
```

3. **Confirm**: "Save these changes?"

---

## Write Configuration

Write to `~/.claude/plugins/claude-hud/config.json`.

Merge with existing config, preserving:
- `pathLevels` (not in configure flow)
- `display.usageThreshold` (advanced config)
- `display.environmentThreshold` (advanced config)
- `colors` (advanced manual palette overrides)

**Migration note**: Old configs with `layout: "default"` or `layout: "separators"` are automatically migrated to the new `lineLayout` + `showSeparators` format on load.

---

## After Writing

Say: "Configuration saved! The HUD will reflect your changes immediately."
