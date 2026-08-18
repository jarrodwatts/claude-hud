---
description: Configure HUD display options (layout, language, presets, display elements) while preserving advanced manual overrides
allowed-tools: Read, Write, AskUserQuestion
---

# Configure Claude HUD

**FIRST**: Resolve the active config directory (`$CLAUDE_CONFIG_DIR` when set, otherwise
`~/.claude`). Use the Read tool to load both of these files when they exist:

1. `plugins/claude-hud/config.json` inside the active config directory (the writable base).
2. `claude-hud.json` directly inside the active config directory (the manual override).

Store the base and override separately. The base file alone determines which flow to use.
For current values and previews, compute the effective config by layering the override over
the base with nested objects merged key by key and arrays/scalars replaced. Track every key
defined by the override so the guided flow can identify settings that it cannot change.

## Core Features (on by default)

These default to ON and are what most users keep. They ARE configurable
(`display.showModel`, `display.showContextBar`), but the guided flow keeps them
enabled — toggle them by editing `config.json` directly if needed:
- Model name `[Opus]`
- Context bar `████░░░░░░ 45%`

Advanced settings such as `colors.*`, `pathLevels`, `maxWidth`, `forceMaxWidth`,
`elementOrder`, `projectLineOrder`, `display.mergeGroups`, `display.timeFormat`, `display.contextValue`,
`display.modelFormat`, `display.modelOverride`, `display.modelSource`, `display.effortFormat`, `display.showProvider`,
`display.providerName`, `display.autocompactBuffer`,
`display.autoCompactWindow`,
`display.usageThreshold`, `display.sevenDayThreshold`,
`display.environmentThreshold`, `display.contextWarningThreshold`,
`display.contextCriticalThreshold`, `display.advisorOverride`,
`display.showAuth`, `display.showAuthUser`, `display.authUserLength`, and the
`display.externalUsage*` keys, plus `jjStatus.showDirty` and
`jjStatus.showConflicts`, are preserved when saving but are not edited by this
guided flow.

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
  - "简体中文" - Show HUD labels and status text in Simplified Chinese
  - "繁體中文" - Show HUD labels and status text in Traditional Chinese

Save as `language: "en"`, `language: "zh-Hans"`, or `language: "zh-Hant"`.

### Q4: Turn Off (based on chosen preset)
- header: "Turn Off"
- question: "Disable any of these? (enabled by your preset)"
- multiSelect: true
- options: **ONLY items that are ON in the chosen preset** (max 4)
  - "Tools activity" - ◐ Edit: file.ts | ✓ Read ×3
  - "Agents status" - ◐ explore [haiku]: Finding code
  - "Todo progress" - ▸ Fix bug (2/5 tasks)
  - "Project name" - my-project path display
  - "Added directories" - +repo +shared workspace directories from /add-dir
  - "Git status" - git:(main*) branch indicator
  - "Jujutsu status" - jj:(bookmark*) opt-in indicator
  - "Config counts" - 2 CLAUDE.md | 4 rules
  - "Token breakdown" - (in: 45k, cache: 12k)
  - "Output speed" - out: 42.1 tok/s
  - "Usage limits" - 5h: 25% | 7d: 10%
  - "Usage reset label" - show or hide the `resets in` prefix
  - "Compact usage" - 5h: 25% (1h 30m) shorter format
  - "Model-scoped usage" - Fable ██░░ 38% per-model weekly windows
  - "Session duration" - ⏱️ 5m
  - "Session name" - fix-auth-bug (session slug or custom title)
  - "Session tokens" - Tokens 12.8M (in: 7k, out: 28k, cache: 12.8M)
  - "Reasoning level" - ◑ high (low/medium/high/xhigh/max, or ultracode(xhigh))
  - "Output style" - style: explanatory (current output style name)
  - "Session cost" - 💰 $0.42
  - "Routed provider cost" - 💰 $0.42 for Bedrock/Vertex (only if Session cost is on)
  - "Skills activity" - active skills count
  - "MCP status" - MCP server status
  - "Memory usage" - process memory footprint
  - "Prompt cache" - cache TTL countdown
  - "Claude Code version" - the running CC version
  - "Compaction count" - Compactions: 2 after /compact or auto-compaction
  - "Advisor model" - Advisor: Opus 4.7 (when /advisor is configured)

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
  - "Added directories" - +repo +shared workspace directories from /add-dir
  - "Git status" - git:(main*) branch indicator
  - "Jujutsu status" - jj:(bookmark*) opt-in indicator
  - "Session name" - fix-auth-bug (session slug or custom title)
  - "Session tokens" - Tokens 12.8M (in: 7k, out: 28k, cache: 12.8M)
  - "Reasoning level" - ◑ high (low/medium/high/xhigh/max, or ultracode(xhigh))
  - "Output style" - style: explanatory (current output style name)
  - "Session cost" - 💰 $0.42
  - "Routed provider cost" - 💰 $0.42 for Bedrock/Vertex (only if Session cost is on)
  - "Skills activity" - active skills count
  - "MCP status" - MCP server status
  - "Memory usage" - process memory footprint
  - "Prompt cache" - cache TTL countdown
  - "Claude Code version" - the running CC version
  - "Compaction count" - Compactions: 2 after /compact or auto-compaction
  - "Advisor model" - Advisor: Opus 4.7 (when /advisor is configured)
  - "Usage bar style" - ██░░ 25% visual bar (only if usageBarEnabled is true)
  - "Usage reset label" - show or hide the `resets in` prefix
  - "Compact usage" - 5h: 25% (1h 30m) shorter format (only if usageCompact is false)
  - "Model-scoped usage" - Fable ██░░ 38% per-model weekly windows (only if showModelScopedUsage is true)

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
  - "Usage reset label" - show or hide the `resets in` prefix
  - "Compact usage" - 5h: 25% (1h 30m) shorter format (only if usageCompact is false)
  - "Model-scoped usage" - Fable ██░░ 38% per-model weekly windows (only if showModelScopedUsage is false)
  - "Added directories" - +repo +shared workspace directories from /add-dir
  - "Jujutsu status" - jj:(bookmark*) opt-in indicator
  - "Session name" - fix-auth-bug (session slug or custom title)
  - "Session tokens" - Tokens 12.8M (in: 7k, out: 28k, cache: 12.8M)
  - "Session duration" - ⏱️ 5m
  - "Reasoning level" - ◑ high (low/medium/high/xhigh/max, or ultracode(xhigh))
  - "Output style" - style: explanatory (current output style name)
  - "Session cost" - 💰 $0.42
  - "Routed provider cost" - 💰 $0.42 for Bedrock/Vertex (only if Session cost is on)
  - "Skills activity" - active skills count
  - "MCP status" - MCP server status
  - "Memory usage" - process memory footprint
  - "Prompt cache" - cache TTL countdown
  - "Claude Code version" - the running CC version
  - "Compaction count" - Compactions: 2 after /compact or auto-compaction
  - "Advisor model" - Advisor: Opus 4.7 (when /advisor is configured)

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
- question: "Update HUD label language? (current: '{English, 简体中文, or 繁體中文}')"
- multiSelect: false
- options:
  - "Keep current" - No change
  - "English (Recommended)" - Use English HUD labels
  - "简体中文" - Use Simplified Chinese HUD labels
  - "繁體中文" - Use Traditional Chinese HUD labels

If user chooses "Keep current", leave `language` unchanged.
If user chooses "English (Recommended)", save `language: "en"`.
If user chooses "简体中文", save `language: "zh-Hans"`.
If user chooses "繁體中文", save `language: "zh-Hant"`.

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
- Activity: Tools ON, Skills ON, MCP ON, Agents ON, Todos ON
- Info: Added Dirs ON, Counts ON, Tokens ON, Usage ON, Reset Label ON, Cost ON, Duration ON, Session Name ON, Session Tokens ON, Reasoning Level ON, Output Style ON, Memory ON, Prompt Cache ON, CC Version ON, Compactions ON, Advisor ON
- Git: ON (with dirty indicator, no ahead/behind)
- Jujutsu: ON (opted in, with dirty and conflict indicators)

**Essential** (activity + git):
- Activity: Tools ON, Agents ON, Todos ON
- Info: Counts OFF, Tokens OFF, Usage OFF, Duration ON, Session Name OFF, Session Tokens OFF
- Git: ON (with dirty indicator)
- Jujutsu: OFF

**Minimal** (core only — this is the default):
- Activity: Tools OFF, Agents OFF, Todos OFF
- Info: Counts OFF, Tokens OFF, Usage OFF, Duration OFF, Session Name OFF, Session Tokens OFF
- Git: ON (with dirty indicator)
- Jujutsu: OFF

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
| 简体中文 | `language: "zh-Hans"` |
| 繁體中文 | `language: "zh-Hant"` |

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
| Model name | `display.showModel` |
| Context bar | `display.showContextBar` |
| Tools activity | `display.showTools` |
| Skills activity | `display.showSkills` |
| MCP status | `display.showMcp` |
| Agents status | `display.showAgents` |
| Todo progress | `display.showTodos` |
| Project name | `display.showProject` |
| Added directories | `display.showAddedDirs` (layout via `display.addedDirsLayout`) |
| Git status | `gitStatus.enabled` |
| Jujutsu status | `jjStatus.enabled` |
| Config counts | `display.showConfigCounts` |
| Token breakdown | `display.showTokenBreakdown` |
| Output speed | `display.showSpeed` |
| Session cost | `display.showCost` |
| Routed provider cost | `display.showRoutedCost` |
| Daily cost | `display.showDailyCost` |
| Usage limits | `display.showUsage` |
| Usage bar style | `display.usageBarEnabled` |
| Compact usage | `display.usageCompact` |
| Usage value | `display.usageValue` |
| Usage reset label | `display.showResetLabel` |
| Model-scoped usage | `display.showModelScopedUsage` (per-model weekly windows, e.g. Fable) |
| Session name | `display.showSessionName` |
| Auth method | `display.showAuth` (plan label, e.g. "Claude Max 20x", own segment at end of first line) |
| Auth user | `display.showAuthUser` (login account, truncated to `display.authUserLength` chars, 0 = full) |
| Session duration | `display.showDuration` |
| Session tokens | `display.showSessionTokens` |
| Session start date | `display.showSessionStartDate` |
| Last response time | `display.showLastResponseAt` |
| Compaction count | `display.showCompactions` |
| Reasoning level | `display.showEffortLevel` |
| Output style | `display.showOutputStyle` |
| Memory usage | `display.showMemoryUsage` |
| Prompt cache | `display.showPromptCache` (transcript tier wins; `display.promptCacheTtlSeconds` is the fallback) |
| Claude Code version | `display.showClaudeCodeVersion` |
| Advisor model | `display.showAdvisor` (override via `display.advisorOverride`) |
| Custom line | `display.customLine` |
| Custom line position | `display.customLinePosition` |

**Defaults to ON (configurable booleans, kept enabled by the guided flow):**
- `display.showModel` (default `true`)
- `display.showContextBar` (default `true`)

---

## Usage Style Mapping

| Option | Config | Example |
|--------|--------|---------|
| Bar style | `usageBarEnabled: true` | `Usage ██░░ 25% (resets in 1h 30m)` |
| Text style | `usageBarEnabled: false` | `Usage 5h 25% (resets in 1h 30m)` |
| Compact | `usageCompact: true` | `5h: 25% (1h 30m)` — no "Usage" label, shorter reset format |

`usageCompact` takes precedence over `usageBarEnabled` when both are set. Compact mode always uses the text format (no bar).

**Note**: Usage style only applies when `display.showUsage: true`. When 7d usage >= 80%, it also shows with the same style.
Set `display.usageValue: "remaining"` manually to show remaining quota percentages while keeping warning thresholds based on used quota.

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

If the user edits a key also defined by the manual override, warn before confirmation that the
saved base value will remain shadowed. Show both the value being written to the base and the
effective value that will still come from the override. Never edit or delete the override.

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

Write to `plugins/claude-hud/config.json` inside the active config directory.

Merge with existing config, preserving:
- `pathLevels` (not in configure flow)
- `display.usageThreshold` (advanced config)
- `display.environmentThreshold` (advanced config)
- `display.contextWarningThreshold` (advanced config)
- `display.contextCriticalThreshold` (advanced config)
- `colors` (advanced manual palette overrides)

**Migration note**: Old configs with `layout: "default"` or `layout: "separators"` are automatically migrated to the new `lineLayout` + `showSeparators` format on load.

### Per-config-directory overrides

`~/.claude/claude-hud.json` (more precisely `$CLAUDE_CONFIG_DIR/claude-hud.json`) is an
optional overlay applied on top of `config.json` at load time. It uses the same shape,
only needs the keys it changes, and nested sections merge key by key:

For example, `~/.config/claude/work/claude-hud.json` can contain:

```json
{ "display": { "customLine": "Work Team" } }
```

This exists for users who run several `CLAUDE_CONFIG_DIR`s and symlink `plugins/` to one
shared location - `plugins/claude-hud/config.json` is then the same physical file for every
directory, while this overlay stays per-directory.

Never write this file from the guided flow, and leave it untouched when it exists; it is a
manual escape hatch. Values in it win over anything written to `config.json`, so if a saved
setting appears not to take effect, check whether the overlay redefines it.

---

## After Writing

Say: "Configuration saved! The HUD will reflect your changes immediately."
