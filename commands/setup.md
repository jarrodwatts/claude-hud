---
description: Configure claude-hud as your statusline
allowed-tools: Bash, Read, Edit, AskUserQuestion
---

**Note**: Placeholders like `{RUNTIME_PATH}`, `{SOURCE}`, and `{GENERATED_COMMAND}` should be substituted with actual detected values.

## Step 1: Detect Platform & Runtime

**macOS/Linux** (if `uname -s` returns "Darwin", "Linux", or a MINGW*/MSYS*/CYGWIN* variant):

> **Git Bash/MSYS2/Cygwin users on Windows**: Follow these macOS/Linux instructions, not the Windows section below. Your environment provides bash and Unix-like tools.

1. Get plugin path:
   ```bash
   ls -td ~/.claude/plugins/cache/claude-hud/claude-hud/*/ 2>/dev/null | head -1
   ```
   If empty, the plugin is not installed. Tell user to install via marketplace first.

2. Get runtime absolute path (prefer bun for performance, fallback to node):
   ```bash
   command -v bun 2>/dev/null || command -v node 2>/dev/null
   ```

   If empty, stop and tell user to install Node.js or Bun.

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
   ```
   bash -c '"{RUNTIME_PATH}" "$(ls -td ~/.claude/plugins/cache/claude-hud/claude-hud/*/ 2>/dev/null | head -1){SOURCE}"'
   ```

**Windows** (native PowerShell/cmd.exe - if `uname` command is not available):

1. Get plugin path:
   ```powershell
   (Get-ChildItem "$env:USERPROFILE\.claude\plugins\cache\claude-hud\claude-hud" | Sort-Object LastWriteTime -Descending | Select-Object -First 1).FullName
   ```
   If empty or errors, the plugin is not installed. Tell user to install via marketplace first.

2. Get runtime absolute path (prefer bun, fallback to node):
   ```powershell
   if (Get-Command bun -ErrorAction SilentlyContinue) { (Get-Command bun).Source } elseif (Get-Command node -ErrorAction SilentlyContinue) { (Get-Command node).Source } else { Write-Error "Neither bun nor node found" }
   ```

   If neither found, stop and tell user to install Node.js or Bun.

3. Check if runtime is bun (by filename). If bun, use `src\index.ts`. Otherwise use `dist\index.js`.

4. Generate command (note: quotes around runtime path handle spaces in paths):
   ```
   powershell -Command "& {$p=(Get-ChildItem $env:USERPROFILE\.claude\plugins\cache\claude-hud\claude-hud | Sort-Object LastWriteTime -Descending | Select-Object -First 1).FullName; & '{RUNTIME_PATH}' (Join-Path $p '{SOURCE}')}"
   ```

**WSL (Windows Subsystem for Linux)**: If running in WSL, use the macOS/Linux instructions. Ensure the plugin is installed in the Linux environment (`~/.claude/plugins/...`), not the Windows side.

## Step 2: Test Command

Run the generated command. It should produce output (the HUD lines) within a few seconds.

- If it errors, do not proceed to Step 3.
- If it hangs for more than a few seconds, cancel and debug.
- This test catches issues like broken runtime binaries, missing plugins, or path problems.

## Step 3: Apply Configuration

Read the settings file and merge in the statusLine config, preserving all existing settings:
- **macOS/Linux/Git Bash**: `~/.claude/settings.json`
- **Windows (native PowerShell)**: `$env:USERPROFILE\.claude\settings.json`

If the file doesn't exist, create it. If it contains invalid JSON, report the error and do not overwrite.

```json
{
  "statusLine": {
    "type": "command",
    "command": "{GENERATED_COMMAND}"
  }
}
```

**Note**: The generated command dynamically finds and runs the latest installed plugin version. Updates are automatic - no need to re-run setup after plugin updates. If the HUD suddenly stops working, re-run `/claude-hud:setup` to verify the plugin is still installed.

## Step 4: Verify With User

Use AskUserQuestion:
- Question: "The HUD should now appear below your input field. Is it working?"
- Options: "Yes, I see it" / "No, something's wrong"

**If yes**: Ask the user if they'd like to ⭐ star the claude-hud repository on GitHub to support the project. If they agree and `gh` CLI is available, run: `gh api -X PUT /user/starred/jarrodwatts/claude-hud`. Only run the star command if they explicitly say yes.

**If no**: Debug systematically:

1. **Verify config was applied**:
   - Read settings file (`~/.claude/settings.json` or `$env:USERPROFILE\.claude\settings.json` on Windows)
   - Check statusLine.command exists and looks correct
   - If command contains a hardcoded version path (not using dynamic `ls -td` lookup), it may be a stale config from a previous setup

2. **Test the command manually** and capture error output:
   ```bash
   {GENERATED_COMMAND} 2>&1
   ```

3. **Common issues to check**:

   **"command not found" or empty output**:
   - Runtime path might be wrong: `ls -la {RUNTIME_PATH}`
   - On macOS with mise/nvm/asdf: the absolute path may have changed after a runtime update
   - Symlinks may be stale: `command -v node` often returns a symlink that can break after version updates
   - Solution: re-detect with `command -v bun` or `command -v node`, and verify with `realpath {RUNTIME_PATH}` (or `readlink -f {RUNTIME_PATH}`) to get the true absolute path

   **"No such file or directory" for plugin**:
   - Plugin might not be installed: `ls ~/.claude/plugins/cache/claude-hud/`
   - Solution: reinstall plugin via marketplace

   **Windows: "bash not recognized"**:
   - Wrong command type for Windows
   - Solution: use the PowerShell command variant

   **Windows: PowerShell execution policy error**:
   - Run: `Set-ExecutionPolicy -Scope CurrentUser -ExecutionPolicy RemoteSigned`

   **Permission denied**:
   - Runtime not executable: `chmod +x {RUNTIME_PATH}`

   **WSL confusion**:
   - If using WSL, ensure plugin is installed in Linux environment, not Windows
   - Check: `ls ~/.claude/plugins/cache/claude-hud/`

4. **If still stuck**: Show the user the exact command that was generated and the error, so they can report it or debug further
