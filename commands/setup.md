---
description: Configure claude-hud as your statusline
allowed-tools: Bash, Read, AskUserQuestion
---

Set up claude-hud as the Claude Code status line. `${CLAUDE_PLUGIN_ROOT}` is this plugin's install directory. Placeholders in `{BRACES}` are values you fill in from earlier steps.

## Step 1: Pick the shell

Claude Code runs the statusLine command through bash on macOS, Linux, and WSL. On Windows it uses Git Bash when installed, otherwise PowerShell. Choose `{SHELL}` from the environment's `Platform:` and `Shell:`. On `win32`, also run `echo $OSTYPE` with the Bash tool.

| Platform | Shell / OSTYPE | `{SHELL}` |
|---|---|---|
| `darwin`, `linux` (including WSL) | any | `posix` |
| `win32` | Shell `bash`, or OSTYPE `msys` / `cygwin` | `gitbash` |
| `win32` | anything else | `powershell` |

With `gitbash`, use bash syntax in every step: bash expands PowerShell's `$env:...` before PowerShell runs. In WSL, the plugin must be installed inside Linux, not on the Windows side.

## Step 2: Find the runtime

| `{SHELL}` | Command |
|---|---|
| `posix` | `command -v bun 2>/dev/null \|\| command -v node 2>/dev/null` |
| `gitbash` | `command -v node 2>/dev/null` (Windows needs Node.js; don't use Bun) |
| `powershell` | `(Get-Command node -ErrorAction SilentlyContinue).Source` |

The result is `{RUNTIME}`. The status line will run on the same runtime as the helper in the next steps.

If nothing is found, stop. Tell the user the current shell can't find Node.js (or Bun), even if Claude Code itself is installed. Point them to Node.js LTS from https://nodejs.org (`winget install OpenJS.NodeJS.LTS` on Windows) or Bun from https://bun.sh (macOS and Linux only). Then ask them to restart their shell and run `/claude-hud:setup` again.

## Step 3: Inspect the current settings

```bash
"{RUNTIME}" "${CLAUDE_PLUGIN_ROOT}/scripts/setup.mjs" inspect --shell {SHELL}
```

In PowerShell, prefix the command with `&`. The helper prints JSON with:

- `settingsPath`
- `command`: the statusLine command it will install
- `existing`: `none`, `claude-hud`, or `other`, for the current statusLine
- `existingPreview`: a redacted preview of the current command

If it fails (for example, settings.json is not valid JSON), show the error and stop. Don't edit settings.json by hand.

If `existing` is `other`, ask with AskUserQuestion:

- header: "Existing statusline"
- question: "You already have a status line: `{existingPreview}`. Replace it with claude-hud? settings.json is backed up first."
- options: "Replace it" / "Keep my current status line"

On "Keep", stop without changing anything. Only ever show `existingPreview`, never the raw command, because it may contain secrets.

## Step 4: Install

```bash
"{RUNTIME}" "${CLAUDE_PLUGIN_ROOT}/scripts/setup.mjs" install --shell {SHELL}
```

This does the following:

- Copies a launcher to `<config dir>/plugins/claude-hud/statusline.mjs`. The launcher always runs the newest installed claude-hud, so plugin updates never need setup again.
- On `gitbash`, writes a `statusline.cmd` shim next to it. Launching through cmd.exe stops Git Bash from stranding suspended `node.exe` processes.
- Backs up settings.json to the reported `backupPath`.
- Saves a replaced command to `previousCommandPath`.
- Writes `statusLine` and keeps every other setting.

Test the result with sample input:

```bash
echo '{"model":{"display_name":"Opus"},"context_window":{"used_percentage":12,"context_window_size":200000}}' | {COMMAND}
```

`{COMMAND}` is the `command` from the report. On `powershell`, test the launcher directly instead: `'<json>' | & "{RUNTIME}" "<config dir>\plugins\claude-hud\statusline.mjs"`.

It should print two HUD lines within a few seconds. If it errors or prints nothing:

1. Show the output.
2. Restore the backup by copying `backupPath` over `settingsPath`.
3. Stop.

## Step 5: Finish

Claude Code runs the new command as soon as settings.json changes, so the HUD should already be showing below the input field. Ask with AskUserQuestion:

- header: "claude-hud"
- question: "Setup complete! The HUD should be showing below your input field. Is it working?"
- options:
  - "Yes, and star the repo ⭐": run `gh repo star jarrodwatts/claude-hud`. If `gh` is missing or lacks that subcommand, run `gh api -X PUT /user/starred/jarrodwatts/claude-hud`, or give them https://github.com/jarrodwatts/claude-hud.
  - "Yes, it's working"
  - "No, something's wrong"

**If yes**, tell the user in one line that they can change anything by asking, for example "show tool activity in the HUD" or "use the compact layout", or with `/claude-hud:configure`.

**If no**, check these in order:

1. Run the Step 4 test again and show its output.
2. If there's no output, check that the plugin is installed: `ls "<config dir>/plugins/cache/"*/claude-hud/`, or under `$CLAUDE_CODE_PLUGIN_CACHE_DIR/cache/` if that is set. The launcher prints nothing when it finds no install. If the directory is missing, reinstall with `/plugin install claude-hud`.
3. If the runtime moved (nvm, mise, and asdf upgrades change the path), run setup again.
4. On Windows, dozens of idle `node.exe` processes come from a setup that predates the cmd.exe shim. Kill them and run setup again.
5. To go back to the previous status line, copy `backupPath` over `settingsPath`.
