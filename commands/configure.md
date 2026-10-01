---
description: Configure HUD display options (layout, language, presets, display elements) while preserving advanced manual overrides
allowed-tools: Read, Write, AskUserQuestion
---

# Configure Claude HUD

## Read the current config

The config directory is `$CLAUDE_CONFIG_DIR` when set, otherwise `~/.claude`. Read these files if they exist:

1. `plugins/claude-hud/config.json`: the base config. This command writes only this file.
2. `claude-hud.json` in the config directory: a manual per-directory override. It uses the same shape and its values win. Never write or delete it.

The effective config is the base with the override layered on top: nested objects merge key by key, and arrays and scalars are replaced. Missing keys use the defaults in the README's configuration table. Use the effective values when describing the current state.

## Ask

Ask these with AskUserQuestion, in two batches of up to four. Put the current value in each question. In multi-select questions, every listed item becomes `true` if selected and `false` if not.

**Layout** (single select)
- "Expanded": `lineLayout: "expanded"`, `showSeparators: false`
- "Compact": `lineLayout: "compact"`, `showSeparators: false`
- "Compact + separators": `lineLayout: "compact"`, `showSeparators: true`

**Activity lines** (multi-select)
- "Tools": `display.showTools`
- "Agents": `display.showAgents`
- "Todos": `display.showTodos`
- "Skills & MCP": `display.showSkills`, `display.showMcp`

**Session info** (multi-select)
- "Cost": `display.showCost`
- "Duration": `display.showDuration`
- "Session name": `display.showSessionName`
- "Reasoning effort": `display.showEffortLevel`

**Usage limits** (single select)
- "Bar (default)": `display.showUsage: true`, `display.usageBarEnabled: true`, `display.usageCompact: false`
- "Text": `display.showUsage: true`, `display.usageBarEnabled: false`, `display.usageCompact: false`
- "Compact": `display.showUsage: true`, `display.usageCompact: true`
- "Hidden": `display.showUsage: false`

**Git** (single select)
- "Branch + dirty (default)": `gitStatus.enabled: true`, `showDirty: true`, `showAheadBehind: false`, `showFileStats: false`
- "Branch only": `gitStatus.enabled: true`, `showDirty: false`, `showAheadBehind: false`, `showFileStats: false`
- "Ahead/behind": `gitStatus.enabled: true`, `showDirty: true`, `showAheadBehind: true`, `showFileStats: false`
- "File stats": `gitStatus.enabled: true`, `showDirty: true`, `showAheadBehind: false`, `showFileStats: true`

**Language** (single select)
- "Keep current"
- "English": `language: "en"`
- "简体中文": `language: "zh-Hans"`
- "繁體中文": `language: "zh-Hant"`

**Custom line** (single select)
- "Keep current"
- "Enter text": ask for the text (max 80 characters) and save it as `display.customLine`
- "Remove": shown only when one is set; saves `display.customLine: ""`

If the user cancels any question, say "Configuration cancelled." and stop.

## Preview and confirm

Compute the changed keys by comparing against the effective config.

- If nothing changed, say "No changes needed - config unchanged." and stop.
- Otherwise show each changed key as `key: old → new`.
- If a changed key is also set in `claude-hud.json`, warn that the override still wins and show the effective value.

Then ask "Save these changes?"

## Write

Write `plugins/claude-hud/config.json`, creating directories as needed. Start from the existing base file and change only the selected keys. Keep every other key exactly as it was, including settings this command doesn't ask about, such as `colors`, thresholds, `elementOrder`, `mergeGroups`, and `display.externalUsage*`. Write valid JSON with 2-space indentation.

Then say: "Configuration saved! The HUD picks it up on its next refresh." Mention that the README documents every other option.
