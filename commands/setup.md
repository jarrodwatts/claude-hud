---
description: Configure claude-hud as your statusline
allowed-tools: Bash, Read, Edit, AskUserQuestion
---

**Note**: Placeholders like `{RUNTIME_PATH}`, `{SOURCE}`, and `{GENERATED_COMMAND}` should be substituted with actual detected values.

## Step 0: Detect Ghost Installation (Run First)

Check for inconsistent plugin state that can occur after failed installations:

**macOS/Linux**:
```bash
# Check 1: Cache exists?
CLAUDE_DIR="${CLAUDE_CONFIG_DIR:-$HOME/.claude}"
CACHE_EXISTS=$(ls -d "$CLAUDE_DIR/plugins/cache"/*/claude-hud 2>/dev/null && echo "YES" || echo "NO")

# Check 2: Registry entry exists?
REGISTRY_EXISTS=$(grep -q "claude-hud" "$CLAUDE_DIR/plugins/installed_plugins.json" 2>/dev/null && echo "YES" || echo "NO")

# Check 3: Temp files left behind?
TEMP_FILES=$(ls -d "$CLAUDE_DIR/plugins/cache/temp_local_"* 2>/dev/null | head -1)

echo "Cache: $CACHE_EXISTS | Registry: $REGISTRY_EXISTS | Temp: ${TEMP_FILES:-none}"
```

**Windows (PowerShell)**:
```powershell
$claudeDir = if ($env:CLAUDE_CONFIG_DIR) { $env:CLAUDE_CONFIG_DIR } else { Join-Path $HOME ".claude" }
$cache = (Get-ChildItem (Join-Path $claudeDir "plugins\cache") -Directory | ForEach-Object { Test-Path (Join-Path $_.FullName "claude-hud") }) -contains $true
$registry = (Get-Content (Join-Path $claudeDir "plugins\installed_plugins.json") -ErrorAction SilentlyContinue) -match "claude-hud"
$temp = Get-ChildItem (Join-Path $claudeDir "plugins\cache\temp_local_*") -ErrorAction SilentlyContinue
Write-Host "Cache: $cache | Registry: $registry | Temp: $($temp.Count) files"
```

### Interpreting Results

| Cache | Registry | Meaning | Action |
|-------|----------|---------|--------|
| YES | YES | Normal install (may still be broken) | Continue to Step 1 |
| YES | NO | Ghost install - cache orphaned | Clean up cache |
| NO | YES | Ghost install - registry stale | Clean up registry |
| NO | NO | Not installed | Continue to Step 1 |

If **temp files exist**, a previous install was interrupted. Clean them up.

### Cleanup Commands

If ghost installation detected, ask user if they want to reset. If yes:

**macOS/Linux**:
```bash
CLAUDE_DIR="${CLAUDE_CONFIG_DIR:-$HOME/.claude}"

# Remove orphaned cache (handles both direct and marketplace installs)
rm -rf "$CLAUDE_DIR/plugins/cache"/*/claude-hud

# Remove temp files from failed installs
rm -rf "$CLAUDE_DIR/plugins/cache/temp_local_"*

# Reset registry (removes ALL plugins - warn user first!)
# Only run if user confirms they have no other plugins they want to keep:
echo '{"version": 2, "plugins": {}}' > "$CLAUDE_DIR/plugins/installed_plugins.json"
```

**Windows (PowerShell)**:
```powershell
$claudeDir = if ($env:CLAUDE_CONFIG_DIR) { $env:CLAUDE_CONFIG_DIR } else { Join-Path $HOME ".claude" }

# Remove orphaned cache (handles both direct and marketplace installs)
Get-ChildItem (Join-Path $claudeDir "plugins\cache") -Directory | ForEach-Object { Remove-Item -Recurse -Force (Join-Path $_.FullName "claude-hud") -ErrorAction SilentlyContinue }

# Remove temp files
Remove-Item -Recurse -Force (Join-Path $claudeDir "plugins\cache\temp_local_*") -ErrorAction SilentlyContinue

# Reset registry (removes ALL plugins - warn user first!)
'{"version": 2, "plugins": {}}' | Set-Content (Join-Path $claudeDir "plugins\installed_plugins.json")
```

After cleanup, tell user to **restart Claude Code** and run `/plugin install claude-hud` again.

### Linux: Cross-Device Filesystem Check

**On Linux only**, if install keeps failing, check for EXDEV issue:
```bash
[ "$(df --output=source ~ /tmp 2>/dev/null | tail -2 | uniq | wc -l)" = "2" ] && echo "CROSS_DEVICE"
```

If this outputs `CROSS_DEVICE`, `/tmp` and home are on different filesystems. This causes `EXDEV: cross-device link not permitted` during installation. Workaround:
```bash
mkdir -p ~/.cache/tmp && TMPDIR=~/.cache/tmp claude /plugin install claude-hud
```

This is a [Claude Code platform limitation](https://github.com/anthropics/claude-code/issues/14799).

---

## Step 1: Detect Platform, Shell, and Runtime

**IMPORTANT**: Use the environment context values (`Platform:` and `Shell:`), not `uname -s` or ad-hoc checks. The Bash tool may report MINGW/MSYS on Windows, so branch only by the context values.

| Platform | Shell | Command Format |
|----------|-------|----------------|
| `darwin` | any | bash (macOS instructions) |
| `linux` | any | bash (Linux instructions) |
| `win32` | `bash` (Git Bash, MSYS2) | bash - use macOS/Linux instructions. Never use PowerShell commands with bash. |
| `win32` | `powershell`, `pwsh`, or `cmd` | PowerShell (use Windows + PowerShell instructions) |

---

**macOS/Linux** (Platform: `darwin` or `linux`):

1. Get plugin path (sorted by dotted numeric version, not modification time):
   ```bash
   ls -d "${CLAUDE_CONFIG_DIR:-$HOME/.claude}"/plugins/cache/*/claude-hud/*/ 2>/dev/null | awk -F/ '{ print $(NF-1) "\t" $(0) }' | sort -t. -k1,1n -k2,2n -k3,3n -k4,4n | tail -1 | cut -f2-
   ```
   If empty, the plugin is not installed. Go back to Step 0 to check for ghost installation or EXDEV issues. If Step 0 was clean, ask the user to install via `/plugin install claude-hud` first.

2. Get runtime absolute path:
   - On `darwin` or `linux`, prefer bun for performance and fall back to node:
     ```bash
     command -v bun 2>/dev/null || command -v node 2>/dev/null
     ```
   - On `win32` + `bash`, prefer node first and only fall back to bun because Bun is currently unstable for frequent statusLine invocations on Windows:
     ```bash
     command -v node 2>/dev/null || command -v bun 2>/dev/null
     ```

   If empty, stop setup and explain that the current shell cannot find `bun` or `node`.
   - On **Windows + Git Bash/MSYS2**, explicitly explain that the current Git Bash session could not find `bun` or `node`, even if Claude Code itself is installed.
   - If `winget` is available, recommend:
     ```bash
     winget install OpenJS.NodeJS.LTS
     ```
   - Otherwise ask the user to install one of these:
     - Node.js LTS from https://nodejs.org/ (recommended on Windows)
     - Bun from https://bun.sh/
   - After installation, ask the user to restart their shell and re-run `/claude-hud:setup`.

3. Verify the runtime exists:
   ```bash
   ls -la {RUNTIME_PATH}
   ```
   If it doesn't exist, re-detect or ask user to verify their installation.

4. Determine source file based on runtime:
   ```bash
   basename {RUNTIME_PATH}
   ```
   If result is "bun", use `src/index.ts` (bun has native TypeScript support). Otherwise use `dist/index.js` (pre-compiled).

5. Generate command (quotes around runtime path handle spaces):

   The command exports `COLUMNS` so the HUD knows the real terminal width.
   Claude Code pipes the subprocess stdout, so `process.stdout.columns` is
   unavailable at runtime. `stty size </dev/tty` reads from the controlling
   terminal. The `- 4` accounts for Claude Code's input area padding
   (2 columns on each side).

   **When runtime is bun** - add `--env-file /dev/null` to prevent Bun from auto-loading project `.env` files:
   ```
   bash -c 'cols=$(stty size </dev/tty 2>/dev/null | awk '"'"'{print $2}'"'"'); export COLUMNS=$(( ${cols:-120} > 4 ? ${cols:-120} - 4 : 1 )); plugin_dir=$(ls -d "${CLAUDE_CONFIG_DIR:-$HOME/.claude}"/plugins/cache/*/claude-hud/*/ 2>/dev/null | awk -F/ '"'"'{ print $(NF-1) "\t" $(0) }'"'"' | sort -t. -k1,1n -k2,2n -k3,3n -k4,4n | tail -1 | cut -f2-); exec "{RUNTIME_PATH}" --env-file /dev/null "${plugin_dir}{SOURCE}"'
   ```

   **When runtime is node**:
   ```
   bash -c 'cols=$(stty size </dev/tty 2>/dev/null | awk '"'"'{print $2}'"'"'); export COLUMNS=$(( ${cols:-120} > 4 ? ${cols:-120} - 4 : 1 )); plugin_dir=$(ls -d "${CLAUDE_CONFIG_DIR:-$HOME/.claude}"/plugins/cache/*/claude-hud/*/ 2>/dev/null | awk -F/ '"'"'{ print $(NF-1) "\t" $(0) }'"'"' | sort -t. -k1,1n -k2,2n -k3,3n -k4,4n | tail -1 | cut -f2-); exec "{RUNTIME_PATH}" "${plugin_dir}{SOURCE}"'
   ```

**Windows + Git Bash** (Platform: `win32`, Shell: `bash`):

Do not use PowerShell commands when the shell is bash. Claude Code invokes statusLine commands through bash, which will interpret PowerShell variables like `$env` and `$p` before PowerShell ever sees them.

On Windows prefer `node` first and only fall back to `bun`.

**Important**: Do **not** reuse the macOS/Linux awk-based command on Windows + Git Bash. The `awk` fragment requires `'"'"'` quoting to nest single quotes inside `bash -c '...'`. After JSON encoding and decoding, this quoting breaks on Windows Git Bash, causing a silent syntax error that prevents the HUD process from starting (see [#326](https://github.com/jarrodwatts/claude-hud/issues/326)).

Instead, use `sort -V` (GNU version sort, included with Git for Windows) which avoids nested single quotes entirely. The command still exports `COLUMNS` so the HUD receives the real terminal width, and it uses the marketplace-aware cache glob:

   **When runtime is bun** - add `--env-file /dev/null` to prevent Bun from auto-loading project `.env` files:
   ```
   bash -c 'cols=$(stty size </dev/tty 2>/dev/null | awk '"'"'{print $2}'"'"'); export COLUMNS=$(( ${cols:-120} > 4 ? ${cols:-120} - 4 : 1 )); plugin_dir=$(ls -1d "${CLAUDE_CONFIG_DIR:-$HOME/.claude}"/plugins/cache/*/claude-hud/*/ 2>/dev/null | sort -V | tail -1); exec "{RUNTIME_PATH}" --env-file /dev/null "${plugin_dir}{SOURCE}"'
   ```

   **When runtime is node**:
   ```
   bash -c 'cols=$(stty size </dev/tty 2>/dev/null | awk '"'"'{print $2}'"'"'); export COLUMNS=$(( ${cols:-120} > 4 ? ${cols:-120} - 4 : 1 )); plugin_dir=$(ls -1d "${CLAUDE_CONFIG_DIR:-$HOME/.claude}"/plugins/cache/*/claude-hud/*/ 2>/dev/null | sort -V | tail -1); exec "{RUNTIME_PATH}" "${plugin_dir}{SOURCE}"'
   ```

**Windows + PowerShell** (Platform: `win32`, Shell: `powershell`, `pwsh`, or `cmd`):

1. Get plugin path:
   ```powershell
   $claudeDir = if ($env:CLAUDE_CONFIG_DIR) { $env:CLAUDE_CONFIG_DIR } else { Join-Path $HOME ".claude" }
   (Get-ChildItem (Join-Path $claudeDir "plugins\cache\*\claude-hud") -Directory | Where-Object { $_.Name -match '^\d+(\.\d+)+$' } | Sort-Object { [version]$_.Name } -Descending | Select-Object -First 1).FullName
   ```
   If empty or errors, the plugin is not installed. Ask the user to install via marketplace first.

2. Get runtime absolute path (prefer node, fallback to bun on Windows):
   ```powershell
   if (Get-Command node -ErrorAction SilentlyContinue) { (Get-Command node).Source } elseif (Get-Command bun -ErrorAction SilentlyContinue) { (Get-Command bun).Source } else { Write-Error "Neither node nor bun found" }
   ```

   If neither found, stop setup and explain that the current PowerShell session cannot find `bun` or `node`.
   - If `winget` is available, recommend:
     ```powershell
     winget install OpenJS.NodeJS.LTS
     ```
   - Otherwise ask the user to install either Node.js LTS or Bun, then restart PowerShell and re-run `/claude-hud:setup`.
   - On Windows, prefer Node.js when both are available because Bun is currently unstable for repeated statusLine execution.

3. Check if runtime is bun (by filename). If bun, use `src\index.ts`. Otherwise use `dist\index.js`.

4. Generate command (note: quotes around runtime path handle spaces in paths):

   The command exports `COLUMNS` so the HUD knows the real terminal width.
   `[Console]::WindowWidth` reads the console buffer width. The `- 4`
   accounts for Claude Code's input area padding (2 columns on each side).

   **When runtime is bun** - add `--env-file NUL` to prevent Bun from auto-loading project `.env` files:
   ```
   powershell -Command "& {$env:COLUMNS=[Math]::Max(1,[Console]::WindowWidth-4); $claudeDir=if ($env:CLAUDE_CONFIG_DIR) { $env:CLAUDE_CONFIG_DIR } else { Join-Path $HOME '.claude' }; $p=(Get-ChildItem (Join-Path $claudeDir 'plugins\cache\*\claude-hud') -Directory | Where-Object { $_.Name -match '^\d+(\.\d+)+$' } | Sort-Object { [version]$_.Name } -Descending | Select-Object -First 1).FullName; & '{RUNTIME_PATH}' '--env-file' 'NUL' (Join-Path $p '{SOURCE}')}"
   ```

   **When runtime is node**:
   ```
   powershell -Command "& {$env:COLUMNS=[Math]::Max(1,[Console]::WindowWidth-4); $claudeDir=if ($env:CLAUDE_CONFIG_DIR) { $env:CLAUDE_CONFIG_DIR } else { Join-Path $HOME '.claude' }; $p=(Get-ChildItem (Join-Path $claudeDir 'plugins\cache\*\claude-hud') -Directory | Where-Object { $_.Name -match '^\d+(\.\d+)+$' } | Sort-Object { [version]$_.Name } -Descending | Select-Object -First 1).FullName; & '{RUNTIME_PATH}' (Join-Path $p '{SOURCE}')}"
   ```

**WSL (Windows Subsystem for Linux)**: If running in WSL, use the macOS/Linux instructions. Ensure the plugin is installed in the Linux environment (`${CLAUDE_CONFIG_DIR:-$HOME/.claude}/plugins/...`), not the Windows side.

## Step 2: Test Command

Run the generated command. It should produce output (the HUD lines) within a few seconds.

- If it errors, do not proceed to Step 3.
- If it hangs for more than a few seconds, cancel and debug.
- This test catches issues like broken runtime binaries, missing plugins, or path problems.

## Step 3: Apply Configuration

Read the settings file and merge in the statusLine config, preserving all existing settings:
- **Platform `darwin` or `linux`, or Platform `win32` + Shell `bash`**: `${CLAUDE_CONFIG_DIR:-$HOME/.claude}/settings.json`
- **Platform `win32` + Shell `powershell`, `pwsh`, or `cmd`**: `settings.json` inside `$env:CLAUDE_CONFIG_DIR` when set, otherwise `Join-Path $HOME ".claude"`

If the file doesn't exist, create it. If it contains invalid JSON, report the error and do not overwrite.
If a write fails with `File has been unexpectedly modified`, re-read the file and retry the merge once.

```json
{
  "statusLine": {
    "type": "command",
    "command": "{GENERATED_COMMAND}"
  }
}
```

**JSON safety**: Write `settings.json` with a real JSON serializer or editor API, not manual string concatenation.
If you must inspect the saved JSON manually, the embedded bash command must preserve escaped backslashes inside the awk fragment.
For example, the saved JSON should contain `\\$(NF-1)` and `\\$0`, not `\$(NF-1)` and `\$0`.


After successfully writing the config, tell the user:

> ✅ Config written. **Please restart Claude Code now** — quit and run `claude` again in your terminal.
> Once restarted, run `/claude-hud:setup` again to complete Step 4 and verify the HUD is working.

**Windows note**: Keep the restart guidance separate from runtime installation guidance.
- If the user just installed Node.js or Bun, they should restart their shell first so `bun` or `node` is available in `PATH`.
- After `statusLine` is written successfully, they should fully quit Claude Code and launch a fresh session before judging whether the HUD setup worked.

**Note**: The generated command dynamically finds and runs the latest installed plugin version. Updates are automatic - no need to re-run setup after plugin updates. If the HUD suddenly stops working, re-run `/claude-hud:setup` to verify the plugin is still installed.

## Step 4: Optional Features

After the statusLine is applied, ask the user if they'd like to enable additional HUD features beyond the default 2-line display.

Use AskUserQuestion:
- header: "Extras"
- question: "Enable any optional HUD features? (all hidden by default)"
- multiSelect: true
- options:
  - "Tools activity" — Shows running/completed tools (◐ Edit: file.ts | ✓ Read ×3)
  - "Agents & Todos" — Shows subagent status and todo progress
  - "Session info" — Shows session duration and config counts (CLAUDE.md, rules, MCPs)
  - "Session name" — Shows session slug or custom title from /rename
  - "Custom line" — Display a custom phrase in the HUD

**If user selects any options**, write `plugins/claude-hud/config.json` inside the Claude config directory (`${CLAUDE_CONFIG_DIR:-$HOME/.claude}` on bash, `$env:CLAUDE_CONFIG_DIR` or `Join-Path $HOME ".claude"` on PowerShell). Create directories if needed:

| Selection | Config keys |
|-----------|------------|
| Tools activity | `display.showTools: true` |
| Agents & Todos | `display.showAgents: true, display.showTodos: true` |
| Session info | `display.showDuration: true, display.showConfigCounts: true` |
| Session name | `display.showSessionName: true` |
| Custom line | `display.customLine: "<user's text>"` — ask user for the text (max 80 chars) |

Merge with existing config if the file already exists. Only write keys the user selected — don't write `false` for unselected items (defaults handle that).

**If user selects nothing** (or picks "Other" and says skip/none), do not create a config file. The defaults are fine.

---

## Step 5: Verify & Finish

**First, confirm the user has restarted Claude Code** since Step 3 wrote the config. If they haven't, ask them to restart before proceeding — the HUD cannot appear in the same session where setup was run.
 
Use AskUserQuestion:
- Question: "Setup complete! The HUD should appear below your input field. Is it working?"
- Options: "Yes, it's working" / "No, something's wrong"

**If yes**: Ask the user if they'd like to ⭐ star the claude-hud repository on GitHub to support the project. If they agree and `gh` CLI is available, first check whether their `gh` version supports `gh repo star`. If it does, run `gh repo star jarrodwatts/claude-hud`. Otherwise fall back to `gh api -X PUT /user/starred/jarrodwatts/claude-hud`. Only run the star command if they explicitly say yes.

**If no**: Debug systematically:

1. **Restart Claude Code** (most common cause on macOS):
    - The statusLine config requires a restart to take effect
    - Quit Claude Code completely and run `claude` again, then re-run `/claude-hud:setup` to verify
    - If you've already restarted, continue below

2. **Verify config was applied**:
   - Read settings file (`${CLAUDE_CONFIG_DIR:-$HOME/.claude}/settings.json` on bash, or `settings.json` inside `$env:CLAUDE_CONFIG_DIR` when set, otherwise `Join-Path $HOME ".claude"` on PowerShell)
   - Check statusLine.command exists and looks correct
   - If command contains a hardcoded version path (not using the dynamic version-lookup command), it may be a stale config from a previous setup

3. **Test the command manually** and capture error output:
   ```bash
   {GENERATED_COMMAND} 2>&1
   ```

4. **Common issues to check**:

   **"command not found" or empty output**:
   - Runtime path might be wrong: `ls -la {RUNTIME_PATH}`
   - On macOS with mise/nvm/asdf: the absolute path may have changed after a runtime update
   - Symlinks may be stale: `command -v node` often returns a symlink that can break after version updates
   - Solution: re-detect with `command -v bun` or `command -v node`, and verify with `realpath {RUNTIME_PATH}` (or `readlink -f {RUNTIME_PATH}`) to get the true absolute path

   **"No such file or directory" for plugin**:
   - Plugin might not be installed: `ls "${CLAUDE_CONFIG_DIR:-$HOME/.claude}"/plugins/cache/*/claude-hud/`
   - Solution: reinstall plugin via marketplace

   **Windows shell mismatch (for example, "bash not recognized")**:
   - Command format does not match `Platform:` + `Shell:`
   - Solution: re-run Step 1 branch logic and use the matching variant

   **Windows: PowerShell execution policy error**:
   - Run: `Set-ExecutionPolicy -Scope CurrentUser -ExecutionPolicy RemoteSigned`

   **Permission denied**:
   - Runtime not executable: `chmod +x {RUNTIME_PATH}`

   **WSL confusion**:
   - If using WSL, ensure plugin is installed in Linux environment, not Windows
   - Check: `ls "${CLAUDE_CONFIG_DIR:-$HOME/.claude}"/plugins/cache/*/claude-hud/`

5. **If still stuck**: Show the user the exact command that was generated and the error, so they can report it or debug further
