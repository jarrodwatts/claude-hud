---
description: Tag the current session for categorization
allowed-tools: Read, Write, AskUserQuestion
---

# Tag Session

## Step 1: Choose Tags

Use AskUserQuestion:
- header: "Session Tags"
- question: "Add tags to this session (for weekly report grouping):"
- multiSelect: true
- options:
  - "bug" — Bug fix session
  - "feature" — New feature development
  - "refactor" — Code refactoring
  - "review" — Code review
  - "debug" — Debugging session
  - "docs" — Documentation
  - "other" — Custom tag

If "other" selected, use AskUserQuestion for custom tag text.

## Step 2: Apply Tags

Read `~/.claude/plugins/claude-hud/session-history.json`, add tags to the last entry, write back.

Confirm: "Tags added: {tags}. These will appear in your weekly report."
