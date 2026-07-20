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

After cleanup, tell user to run `/plugin install claude-hud` again followed by `/reload-plugins` — no restart needed. (Restart Claude Code only if the reinstall still misbehaves; the fresh session re-reads the plugin registry from scratch.)

### Linux: Cross-Device Filesystem Check

**On Linux only**, if install fails with `EXDEV: cross-device link not permitted`, check whether `/tmp` and home are on different filesystems:
```bash
[ "$(df --output=source ~ /tmp 2>/dev/null | tail -2 | uniq | wc -l)" = "2" ] && echo "CROSS_DEVICE"
```

The underlying Claude Code bug ([#14799](https://github.com/anthropics/claude-code/issues/14799)) has been fixed, so this mostly affects older Claude Code versions — suggest updating Claude Code first. If updating isn't an option and the check outputs `CROSS_DEVICE`, the workaround is:
```bash
mkdir -p ~/.cache/tmp && TMPDIR=~/.cache/tmp claude /plugin install claude-hud
```

---

## Step 1: Detect Platform, Shell, and Runtime

**IMPORTANT**: Use the environment context values (`Platform:` and `Shell:`) as your starting point. On `win32`, also check `$OSTYPE` via the Bash tool. Some Windows sessions report `Shell: powershell` while the command path exposed to Claude Code is Git Bash/MSYS2. When `$OSTYPE` is `msys` or `cygwin`, the PowerShell command format can fail before PowerShell runs because bash expands `$env:VAR`, `$p`, and `$(...)` expressions first (see [#531](https://github.com/jarrodwatts/claude-hud/issues/531)).

**On `win32`, run this check first:**
```bash
echo $OSTYPE
```

| Platform | Shell | OSTYPE | Command Format |
|----------|-------|--------|----------------|
| `darwin` | any | any | bash (macOS instructions) |
| `linux` | any | any | bash (Linux instructions) |
| `win32` | `bash` | any | bash — Windows + Git Bash instructions |
| `win32` | `powershell`, `pwsh`, or `cmd` | `msys` or `cygwin` | bash — Windows + Git Bash instructions (the active command environment is MSYS/Cygwin; PowerShell syntax is unsafe here) |
| `win32` | `powershell`, `pwsh`, or `cmd` | other / empty | PowerShell — Windows + PowerShell instructions |

---

**macOS/Linux** (Platform: `darwin` or `linux`):

1. Get plugin path (sorted by dotted numeric version, not modification time):
   ```bash
   ls -d "${CLAUDE_CONFIG_DIR:-$HOME/.claude}"/plugins/cache/*/claude-hud/*/ 2>/dev/null | awk -F/ '{ print $(NF-1) "\t" $(0) }' | grep -E '^[0-9]+\.[0-9]+\.[0-9]+[[:space:]]' | sort -t. -k1,1n -k2,2n -k3,3n -k4,4n | tail -1 | cut -f2-
   ```
   If empty, the plugin is not installed. Go back to Step 0 to check for ghost installation or EXDEV issues. If Step 0 was clean, ask the user to install via `/plugin install claude-hud` first.

2. Get runtime absolute path:
   - On `darwin` or `linux`, prefer bun for performance and fall back to node:
     ```bash
     command -v bun 2>/dev/null || command -v node 2>/dev/null
     ```
   - On `win32` + `bash`, require node. Do not fall back to bun on Windows:
     ```bash
     command -v node 2>/dev/null
     ```

   If empty, stop setup and explain that the current shell cannot find the required runtime.
   - On **Windows + Git Bash/MSYS2**, explicitly explain that the current Git Bash session could not find Node.js, even if Claude Code itself is installed.
   - If `winget` is available, recommend:
     ```bash
     winget install OpenJS.NodeJS.LTS
     ```
   - On Windows, ask the user to install Node.js LTS from https://nodejs.org/
   - On macOS/Linux, ask the user to install one of these:
     - Node.js LTS from https://nodejs.org/
     - Bun from https://bun.sh/
   - After installation, ask the user to restart their shell and re-run `/claude-hud:setup`.

3. Verify the runtime exists:
   ```bash
   ls -la {RUNTIME_PATH}
   ```
   If it doesn't exist, re-detect or ask user to verify their installation.

4. Determine source file based on runtime:
   - On `darwin` or `linux`, use `src/index.ts` when the runtime is bun. Otherwise use `dist/index.js`.
   - On Windows, always use `dist/index.js`.

5. Generate command (quotes around runtime path handle spaces):

   The command exports `COLUMNS` so the HUD knows the real terminal width.
   Claude Code pipes the subprocess stdout, so `process.stdout.columns` is
   unavailable at runtime. Since Claude Code v2.1.153, `COLUMNS` and `LINES`
   are set natively to the current terminal dimensions before the statusLine
   command runs, so the inherited `COLUMNS` value is the primary source. The
   `stty size </dev/tty` probe and the 120 fallback remain for older Claude
   Code versions where `COLUMNS` may be absent. The `- 4` accounts for Claude
   Code's input area padding (2 columns on each side).

   The grep pattern uses `[[:space:]]` rather than `\t` to match the tab
   separator emitted by awk. GNU grep (BRE/ERE) does **not** interpret
   `\t` as a tab character — it emits `warning: stray \ before t` and
   treats the pattern as literal `t`, so the regex never matches the awk
   output and `plugin_dir` resolves to an empty string. The runtime then
   exits with `Module not found "src/index.ts"` and no HUD appears.
   Setup verification can hide this because some shells alias `grep` to
   alternatives (e.g. `ugrep`) that *do* expand `\t`, while the actual
   `statusLine` subprocess invokes `/usr/bin/grep`. `[[:space:]]` is a
   POSIX character class supported by both BSD grep (macOS default) and
   GNU grep (Linux default).

   **When runtime is bun** - add `--env-file /dev/null` to prevent Bun from auto-loading project `.env` files:
   ```
   bash -c 'cols=${COLUMNS:-}; case "$cols" in ""|*[!0-9]*) cols=$(stty size </dev/tty 2>/dev/null | awk '"'"'{print $2}'"'"');; esac; case "$cols" in ""|*[!0-9]*) cols=120;; esac; export COLUMNS=$(( cols > 4 ? cols - 4 : 1 )); plugin_dir=$(ls -d "${CLAUDE_CONFIG_DIR:-$HOME/.claude}"/plugins/cache/*/claude-hud/*/ 2>/dev/null | awk -F/ '"'"'{ print $(NF-1) "\t" $(0) }'"'"' | grep -E '"'"'^[0-9]+\.[0-9]+\.[0-9]+[[:space:]]'"'"' | sort -t. -k1,1n -k2,2n -k3,3n -k4,4n | tail -1 | cut -f2-); exec "{RUNTIME_PATH}" --env-file /dev/null "${plugin_dir}{SOURCE}"'
   ```

   **When runtime is node**:
   ```
   bash -c 'cols=${COLUMNS:-}; case "$cols" in ""|*[!0-9]*) cols=$(stty size </dev/tty 2>/dev/null | awk '"'"'{print $2}'"'"');; esac; case "$cols" in ""|*[!0-9]*) cols=120;; esac; export COLUMNS=$(( cols > 4 ? cols - 4 : 1 )); plugin_dir=$(ls -d "${CLAUDE_CONFIG_DIR:-$HOME/.claude}"/plugins/cache/*/claude-hud/*/ 2>/dev/null | awk -F/ '"'"'{ print $(NF-1) "\t" $(0) }'"'"' | grep -E '"'"'^[0-9]+\.[0-9]+\.[0-9]+[[:space:]]'"'"' | sort -t. -k1,1n -k2,2n -k3,3n -k4,4n | tail -1 | cut -f2-); exec "{RUNTIME_PATH}" "${plugin_dir}{SOURCE}"'
   ```

**Windows + Git Bash** (Platform: `win32`, Shell: `bash`):

Do not use PowerShell commands when the shell is bash. Claude Code invokes statusLine commands through bash, which will interpret PowerShell variables like `$env` and `$p` before PowerShell ever sees them.

On Windows require `node` and always use `dist/index.js`.

**Important**: Do **not** reuse the macOS/Linux awk-based command on Windows + Git Bash. The `awk` fragment requires `'"'"'` quoting to nest single quotes inside `bash -c '...'`. After JSON encoding and decoding, this quoting breaks on Windows Git Bash, causing a silent syntax error that prevents the HUD process from starting (see [#326](https://github.com/jarrodwatts/claude-hud/issues/326)).

Instead, use `sort -V` (GNU version sort, included with Git for Windows) which avoids nested single quotes entirely. Also avoid wrapping the generated command in a second `bash -c ...` layer. Claude Code is already invoking the statusline through bash, so the direct shell command lets `exec` replace that shell instead of spawning an extra bash wrapper first. The command still exports `COLUMNS` so the HUD receives the real terminal width, and it uses the marketplace-aware cache glob:

   ```
   cols=${COLUMNS:-}; case "$cols" in ""|*[!0-9]*) cols=$(stty size </dev/tty 2>/dev/null | awk '{print $2}');; esac; case "$cols" in ""|*[!0-9]*) cols=120;; esac; export COLUMNS=$(( cols > 4 ? cols - 4 : 1 )); plugin_dir=$(ls -1d "${CLAUDE_CONFIG_DIR:-$HOME/.claude}"/plugins/cache/*/claude-hud/*/ 2>/dev/null | sort -V | tail -1); exec "{RUNTIME_PATH}" "${plugin_dir}{SOURCE}"
   ```

**Windows + PowerShell** (Platform: `win32`, Shell: `powershell`, `pwsh`, or `cmd`, OSTYPE: other/empty):

> **Before proceeding**: if `echo $OSTYPE` returned `msys` or `cygwin`, use the **Windows + Git Bash** instructions above. In that environment, bash can expand PowerShell variables before PowerShell runs.

1. Get plugin path:
   ```powershell
   $claudeDir = if ($env:CLAUDE_CONFIG_DIR) { $env:CLAUDE_CONFIG_DIR } else { Join-Path $HOME ".claude" }
   (Get-ChildItem (Join-Path $claudeDir "plugins\cache\*\claude-hud\*") -Directory -ErrorAction SilentlyContinue | Where-Object { $_.Name -match '^\d+(\.\d+)+$' } | Sort-Object { [version]$_.Name } -Descending | Select-Object -First 1).FullName
   ```
   The trailing `\*` on the cache glob is required. Without it, `Get-ChildItem` returns the `claude-hud` directory itself, whose name does not match the `^\d+(\.\d+)+$` version pattern, so the lookup resolves to `$null` and any subsequent `Join-Path` throws (see [#521](https://github.com/jarrodwatts/claude-hud/issues/521)).

   If empty or errors, the plugin is not installed. Ask the user to install via marketplace first.

2. Get runtime absolute path (require node on Windows):
   ```powershell
   if (Get-Command node -ErrorAction SilentlyContinue) { (Get-Command node).Source } else { Write-Error "Node.js not found" }
   ```

   If node is not found, stop setup and explain that the current PowerShell session cannot find Node.js.
   - If `winget` is available, recommend:
     ```powershell
     winget install OpenJS.NodeJS.LTS
     ```
   - Otherwise ask the user to install Node.js LTS, then restart PowerShell and re-run `/claude-hud:setup`.
   - On Windows, do not offer Bun for statusLine setup. Use Node.js only.

3. Use `dist\index.js`.

4. Write the Windows statusline launcher.

   Windows PowerShell startup plus `Get-ChildItem | Sort-Object [version]` can exceed Claude Code's render cadence on every statusLine refresh. Write a small Node launcher once during setup, then invoke it through `cmd.exe` on each refresh. The launcher uses the setup-time validated `node.exe`, preserves update discovery by finding the latest installed `claude-hud` version, and prefers inherited `COLUMNS` before falling back to 120.

   The launcher file at `$claudeDir/plugins/claude-hud/statusline.mjs` should contain:

   ```js
   import fs from 'node:fs';
   import os from 'node:os';
   import path from 'node:path';
   import { pathToFileURL } from 'node:url';

   const envColumns = Number.parseInt(process.env.COLUMNS ?? '', 10);
   const width = Number.isFinite(envColumns) && envColumns > 0 ? envColumns : 120;
   process.env.COLUMNS = String(Math.max(1, width - 4));

   const claudeDir = process.env.CLAUDE_CONFIG_DIR || path.join(os.homedir(), '.claude');
   const cacheDir = path.join(claudeDir, 'plugins', 'cache');

   function versionParts(value) {
     const match = /^(\d+)\.(\d+)\.(\d+)(?:[-+].*)?$/.exec(value);
     return match ? match.slice(1, 4).map(Number) : null;
   }

   function compareVersions(a, b) {
     for (let i = 0; i < 3; i += 1) {
       if (a[i] !== b[i]) return a[i] - b[i];
     }
     return 0;
   }

   const candidates = [];
   try {
     for (const marketplace of fs.readdirSync(cacheDir, { withFileTypes: true })) {
       if (!marketplace.isDirectory()) continue;
       const pluginRoot = path.join(cacheDir, marketplace.name, 'claude-hud');
       let versions = [];
       try {
         versions = fs.readdirSync(pluginRoot, { withFileTypes: true });
       } catch {
         continue;
       }
       for (const version of versions) {
         if (!version.isDirectory()) continue;
         const parts = versionParts(version.name);
         if (!parts) continue;
         const dir = path.join(pluginRoot, version.name);
         if (fs.existsSync(path.join(dir, 'dist', 'index.js'))) {
           candidates.push({ dir, parts });
         }
       }
     }
   } catch {
     process.exit(0);
   }

   candidates.sort((a, b) => compareVersions(a.parts, b.parts));
   const latest = candidates.at(-1);
   if (!latest) process.exit(0);

   const hud = await import(pathToFileURL(path.join(latest.dir, 'dist', 'index.js')).href);
   if (typeof hud.main === 'function') {
     await hud.main();
   }
   ```

   Write it using `[System.IO.File]::WriteAllText` with `New-Object System.Text.UTF8Encoding $false` so the file is UTF-8 without a BOM:

   ```powershell
   $wrapperDir = Join-Path $claudeDir "plugins\claude-hud"
   New-Item -ItemType Directory -Force -Path $wrapperDir | Out-Null
   $wrapperPath = Join-Path $wrapperDir "statusline.mjs"
   $wrapperBody = @'
   import fs from 'node:fs';
   import os from 'node:os';
   import path from 'node:path';
   import { pathToFileURL } from 'node:url';

   const envColumns = Number.parseInt(process.env.COLUMNS ?? '', 10);
   const width = Number.isFinite(envColumns) && envColumns > 0 ? envColumns : 120;
   process.env.COLUMNS = String(Math.max(1, width - 4));

   const claudeDir = process.env.CLAUDE_CONFIG_DIR || path.join(os.homedir(), '.claude');
   const cacheDir = path.join(claudeDir, 'plugins', 'cache');

   function versionParts(value) {
     const match = /^(\d+)\.(\d+)\.(\d+)(?:[-+].*)?$/.exec(value);
     return match ? match.slice(1, 4).map(Number) : null;
   }

   function compareVersions(a, b) {
     for (let i = 0; i < 3; i += 1) {
       if (a[i] !== b[i]) return a[i] - b[i];
     }
     return 0;
   }

   const candidates = [];
   try {
     for (const marketplace of fs.readdirSync(cacheDir, { withFileTypes: true })) {
       if (!marketplace.isDirectory()) continue;
       const pluginRoot = path.join(cacheDir, marketplace.name, 'claude-hud');
       let versions = [];
       try {
         versions = fs.readdirSync(pluginRoot, { withFileTypes: true });
       } catch {
         continue;
       }
       for (const version of versions) {
         if (!version.isDirectory()) continue;
         const parts = versionParts(version.name);
         if (!parts) continue;
         const dir = path.join(pluginRoot, version.name);
         if (fs.existsSync(path.join(dir, 'dist', 'index.js'))) {
           candidates.push({ dir, parts });
         }
       }
     }
   } catch {
     process.exit(0);
   }

   candidates.sort((a, b) => compareVersions(a.parts, b.parts));
   const latest = candidates.at(-1);
   if (!latest) process.exit(0);

   const hud = await import(pathToFileURL(path.join(latest.dir, 'dist', 'index.js')).href);
   if (typeof hud.main === 'function') {
     await hud.main();
   }
   '@
   [System.IO.File]::WriteAllText($wrapperPath, $wrapperBody, (New-Object System.Text.UTF8Encoding $false))
   ```

   `$runtimePath` is the value detected in step 2 (the absolute path returned by `(Get-Command node).Source`, typically `C:\Program Files\nodejs\node.exe`). `Set-Content -Encoding UTF8` and `Out-File -Encoding UTF8` on Windows PowerShell 5.1 both emit a UTF-8 BOM. `WriteAllText` + `UTF8Encoding $false` writes without a BOM in both PowerShell 5.1 and PowerShell 7+.

5. Generate command:

   ```
   {CMD_PATH} /d /s /c ""{RUNTIME_PATH}" "{WRAPPER_PATH}""
   ```

   `{CMD_PATH}` is the absolute `cmd.exe` path, preferably `$env:SystemRoot\System32\cmd.exe`. `{WRAPPER_PATH}` is the value of `$wrapperPath` from step 4 (typically `C:\Users\<user>\.claude\plugins\claude-hud\statusline.mjs`). If you build the string in PowerShell, use:

   ```powershell
   $cmdPath = Join-Path $env:SystemRoot "System32\cmd.exe"
   if (-not (Test-Path $cmdPath)) { $cmdPath = "cmd.exe" }
   $generatedCommand = $cmdPath + ' /d /s /c ""' + $runtimePath + '" "' + $wrapperPath + '""'
   ```

**WSL (Windows Subsystem for Linux)**: If running in WSL, use the macOS/Linux instructions. Ensure the plugin is installed in the Linux environment (`${CLAUDE_CONFIG_DIR:-$HOME/.claude}/plugins/...`), not the Windows side.

## Step 2: Test Command

Run the generated command. It should produce output (the HUD lines) within a few seconds.

- If it errors, do not proceed to Step 3.
- If it hangs for more than a few seconds, cancel and debug.
- This test catches issues like broken runtime binaries, missing plugins, or path problems.

## Step 2.5: Detect Existing Statusline and Create Backup

Before writing to `settings.json`, check whether a `statusLine` key already exists and protect the user's current configuration. This covers the existing-statusLine overwrite issue tracked in [#547](https://github.com/jarrodwatts/claude-hud/issues/547).

### 2.5.1: Read the existing statusLine

**macOS/Linux**:
```bash
SETTINGS="${CLAUDE_CONFIG_DIR:-$HOME/.claude}/settings.json"
EXISTING_COMMAND=""
EXISTING_COMMAND_PREVIEW=""

if [ -f "$SETTINGS" ]; then
  EXISTING_COMMAND=$("{RUNTIME_PATH}" -e '
const fs = require("fs");
const settingsPath = process.argv[1];

try {
  const text = fs.readFileSync(settingsPath, "utf8");
  if (text.trim() === "") process.exit(0);

  const json = JSON.parse(text);
  const command = json && json.statusLine && typeof json.statusLine.command === "string"
    ? json.statusLine.command
    : "";
  process.stdout.write(command);
} catch (error) {
  console.error("Unable to read statusLine.command from settings.json: " + error.message);
  process.exit(1);
}
' "$SETTINGS") || exit 1

  EXISTING_COMMAND_PREVIEW=$(printf '%s' "$EXISTING_COMMAND" | "{RUNTIME_PATH}" -e '
let value = "";
process.stdin.setEncoding("utf8");
process.stdin.on("data", chunk => { value += chunk; });
process.stdin.on("end", () => {
  const redacted = value
    .replace(/\b(Bearer)\s+["\x27]?[^"\x27\s]+/gi, "$1 [REDACTED]")
    .replace(/\b(Authorization\s*:\s*)["\x27]?[^"\x27\s]+/gi, "$1[REDACTED]")
    .replace(/\b(token|api[_-]?key|secret|password|pass|auth)(=|:)\s*["\x27]?[^"\x27\s]+/gi, "$1$2[REDACTED]")
    .replace(/\bsk-[A-Za-z0-9_-]{8,}\b/g, "sk-[REDACTED]")
    .replace(/\bgh[pousr]_[A-Za-z0-9_]{8,}\b/g, "[GITHUB_TOKEN_REDACTED]")
    .replace(/\s+/g, " ")
    .trim();

  process.stdout.write(redacted.length > 160 ? redacted.slice(0, 157) + "..." : redacted);
});
')
fi
```

**Windows (PowerShell)**:
```powershell
$settingsPath = if ($env:CLAUDE_CONFIG_DIR) { Join-Path $env:CLAUDE_CONFIG_DIR "settings.json" } else { Join-Path $HOME ".claude\settings.json" }
$existingCommand = ""
$existingCommandPreview = ""
if (Test-Path $settingsPath) {
  try {
    $json = Get-Content $settingsPath -Raw | ConvertFrom-Json
    if ($json.statusLine -and $json.statusLine.command) {
      $existingCommand = $json.statusLine.command
    }
  } catch {
    Write-Error "Unable to read statusLine.command from settings.json: $($_.Exception.Message)"
    throw
  }

  if ($existingCommand -ne "") {
    $existingCommandPreview = $existingCommand `
      -replace "(?i)\b(Bearer)\s+[`"']?[^`"'\s]+", '$1 [REDACTED]' `
      -replace "(?i)\b(Authorization\s*:\s*)[`"']?[^`"'\s]+", '$1[REDACTED]' `
      -replace "(?i)\b(token|api[_-]?key|secret|password|pass|auth)(=|:)\s*[`"']?[^`"'\s]+", '$1$2[REDACTED]' `
      -replace "\bsk-[A-Za-z0-9_-]{8,}\b", 'sk-[REDACTED]' `
      -replace "\bgh[pousr]_[A-Za-z0-9_]{8,}\b", '[GITHUB_TOKEN_REDACTED]' `
      -replace "\s+", " "
    $existingCommandPreview = $existingCommandPreview.Trim()
    if ($existingCommandPreview.Length -gt 160) {
      $existingCommandPreview = $existingCommandPreview.Substring(0, 157) + "..."
    }
  }
}
```

### 2.5.2: Classify the existing statusline

If `EXISTING_COMMAND` / `$existingCommand` is non-empty, classify it:

| Pattern in command | Classification | Source label |
|---|---|---|
| Contains `claude-hud` | **Reinstall** (own config) | `claude-hud` |
| Contains `claude-pace` | **Known project** | `claude-pace` |
| Contains `cc-statusline` or `ccstatusline` | **Known project** | `cc-statusline` |
| Contains `statusline.sh` or `statusline.js` or `statusline.py` | **Likely another statusline** | `statusline script` |
| Any other non-empty value | **Custom script** | `custom` |
| Empty / missing key | **Clean install** | (none) |

### 2.5.3: Create a timestamped backup

**Always** create a backup of `settings.json` before modifying it, regardless of whether a statusline exists. This protects against corruption (see [#315]) and gives users a recovery path.

**macOS/Linux**:
```bash
SETTINGS="${CLAUDE_CONFIG_DIR:-$HOME/.claude}/settings.json"
BACKUP_TIMESTAMP=$(date +%Y%m%d-%H%M%S)
BACKUP_PATH=""
if [ -f "$SETTINGS" ]; then
  BACKUP_PATH="${SETTINGS}.bak.${BACKUP_TIMESTAMP}"
  if cp "$SETTINGS" "$BACKUP_PATH"; then
    echo "Backup created: $BACKUP_PATH"
  else
    echo "Failed to create backup at: $BACKUP_PATH" >&2
    exit 1
  fi
fi
```

**Windows (PowerShell)**:
```powershell
$backupPath = ""
if (Test-Path $settingsPath) {
  $timestamp = Get-Date -Format 'yyyyMMdd-HHmmss'
  $backupPath = "${settingsPath}.bak.${timestamp}"
  Copy-Item $settingsPath $backupPath -ErrorAction Stop
  Write-Host "Backup created: $backupPath"
}
```

### 2.5.4: Prompt the user if a statusline exists

**If the statusline is empty (clean install)**: Skip this step. Proceed directly to Step 3.

**If the statusline is claude-hud (reinstall)**: Skip this step. The new command replaces the old one — this is an idempotent update. Proceed to Step 3.

**If the statusline belongs to a known project or is a custom script**: Use AskUserQuestion to ask the user what to do.

Use AskUserQuestion:
- header: "Existing statusline detected"
- question: "Found an existing statusLine in settings.json:\n\n  command preview: {REDACTED_COMMAND_PREVIEW}\n  source: {SOURCE_LABEL}\n\nWhat would you like to do?"
- options:
  - "Replace it with claude-hud (your current setup will be backed up)"
  - "Keep my current statusline and exit setup (settings stay unchanged)"
  - "Cancel setup without changing settings"

Set `{REDACTED_COMMAND_PREVIEW}` to `EXISTING_COMMAND_PREVIEW` on macOS/Linux or `$existingCommandPreview` on Windows. Use only the redacted/truncated preview in the prompt and normal output. Do not print the full previous command because it may contain tokens or secrets.

**If the user chooses "Keep" or "Cancel"**: Stop setup. The backup from 2.5.3 is still available if one was created. Tell the user:

> No changes were made to your settings. Your existing statusline is preserved. Setup created no settings mutation apart from the backup file at `{BACKUP_PATH or $backupPath}` if that value is set.

**If the user chooses "Replace"**: Proceed to Step 3. The backup from 2.5.3 ensures the previous configuration can be restored.

### 2.5.5: Save the previous command for potential restoration

Store the previous `statusLine.command` value in a file alongside the settings backup. This makes it easy to restore if the user later wants to switch back.

**macOS/Linux**:
```bash
CLAUDE_DIR="${CLAUDE_CONFIG_DIR:-$HOME/.claude}"
if [ -n "$EXISTING_COMMAND" ]; then
  PREVIOUS_COMMAND_DIR="$CLAUDE_DIR/plugins/claude-hud"
  PREVIOUS_COMMAND_PATH="$PREVIOUS_COMMAND_DIR/previous-statusline.txt"
  mkdir -p "$PREVIOUS_COMMAND_DIR"
  chmod 700 "$PREVIOUS_COMMAND_DIR" 2>/dev/null || true
  if (
    umask 077
    printf '%s' "$EXISTING_COMMAND" > "$PREVIOUS_COMMAND_PATH"
  ); then
    chmod 600 "$PREVIOUS_COMMAND_PATH" 2>/dev/null || true
    echo "Previous statusline command saved to: $PREVIOUS_COMMAND_PATH"
  else
    echo "Failed to save previous statusline command to: $PREVIOUS_COMMAND_PATH" >&2
    exit 1
  fi
fi
```

**Windows (PowerShell)**:
```powershell
$claudeDir = if ($env:CLAUDE_CONFIG_DIR) { $env:CLAUDE_CONFIG_DIR } else { Join-Path $HOME ".claude" }
$pluginDir = Join-Path $claudeDir "plugins\claude-hud"
if (-not (Test-Path $pluginDir)) { New-Item -ItemType Directory -Force -Path $pluginDir | Out-Null }
if ($existingCommand -ne "") {
  $previousCommandPath = Join-Path $pluginDir "previous-statusline.txt"
  [System.IO.File]::WriteAllText($previousCommandPath, $existingCommand, (New-Object System.Text.UTF8Encoding $false))
  try {
    $acl = Get-Acl $previousCommandPath
    $acl.SetAccessRuleProtection($true, $false)
    $rule = New-Object System.Security.AccessControl.FileSystemAccessRule(
      [System.Security.Principal.WindowsIdentity]::GetCurrent().Name,
      "FullControl",
      "Allow"
    )
    $acl.SetAccessRule($rule)
    Set-Acl -Path $previousCommandPath -AclObject $acl
  } catch {
    Write-Warning "Saved previous statusline command, but could not tighten file ACLs: $($_.Exception.Message)"
  }
}
```

---

## Step 3: Apply Configuration

Read the settings file and merge in the statusLine config, preserving all existing settings:
- **Platform `darwin` or `linux`, or Platform `win32` + Shell `bash`**: `${CLAUDE_CONFIG_DIR:-$HOME/.claude}/settings.json`
- **Platform `win32` + Shell `powershell`, `pwsh`, or `cmd`**: `settings.json` inside `$env:CLAUDE_CONFIG_DIR` when set, otherwise `Join-Path $HOME ".claude"`

If the file doesn't exist, create it. If it contains invalid JSON, report the error and do not overwrite.
If a write fails with `File has been unexpectedly modified`, re-read the file and retry the merge once.

**A timestamped backup was already created in Step 2.5.3.** If Step 2.5.4 prompted the user and they chose "Keep" or "Cancel", do not reach this step — setup has already exited.

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

**Windows PowerShell 5.1 BOM**: on Windows PowerShell 5.1 (the default shell on Windows 10/11), `Set-Content -Encoding UTF8` and `Out-File -Encoding UTF8` emit a UTF-8 BOM (`EF BB BF`). RFC 8259 §8.1 forbids BOM in JSON. PowerShell 7+ added `-Encoding utf8NoBOM`, but PS 5.1 did not. Use `[System.IO.File]::WriteAllText` with `New-Object System.Text.UTF8Encoding $false` to write UTF-8 without a BOM from both PS versions:

```powershell
[System.IO.File]::WriteAllText($path, $json, (New-Object System.Text.UTF8Encoding $false))
```

Verify the first bytes are `7B 0D 0A` (`{` + CRLF) or `7B 0A` (`{` + LF), not `EF BB BF`:

```powershell
[System.IO.File]::ReadAllBytes($path)[0..2]
```


After successfully writing the config, tell the user:

> ✅ Config written. Claude Code reloads settings automatically — the HUD should appear below your input field after your next message in this session (no restart needed).
> If it doesn't show up after your next interaction, restart Claude Code (quit and run `claude` again) — older Claude Code versions require a restart to pick up statusLine changes.

Then continue directly to Step 4 in the same session.

**Windows note**: Keep the settings-reload guidance separate from runtime installation guidance.
- If the user just installed Node.js, they should restart their shell first so `node` is available in `PATH` — that shell restart is unrelated to Claude Code picking up the statusLine config.
- The statusLine config itself reloads automatically on Windows too; a full Claude Code restart is only the fallback if the HUD doesn't appear after the next interaction.

**Note**: The generated command dynamically finds and runs the latest installed plugin version. Updates are automatic - no need to re-run setup after plugin updates. If the HUD suddenly stops working, re-run `/claude-hud:setup` to verify the plugin is still installed.

**Restoring a previous statusline**: If the user previously had a different statusline and wants to restore it, use the backup path printed in Step 2.5.3. The previous command is stored in `~/.claude/plugins/claude-hud/previous-statusline.txt`. To restore:
1. Find the most recent backup: `ls -t ~/.claude/settings.json.bak.* | head -1`
2. Copy it back: `cp ~/.claude/settings.json.bak.{timestamp} ~/.claude/settings.json`
3. The restored config applies automatically on the next interaction (restart Claude Code only if it doesn't).

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

Settings reload automatically, so the HUD can appear in the same session where setup was run — it renders after the user's next interaction (their answer to the question below counts as one). No restart is needed on current Claude Code versions.

Use AskUserQuestion:
- Question: "Setup complete! The HUD should appear below your input field. Is it working?"
- Options: "Yes, it's working" / "No, something's wrong"

**If yes**: Ask the user if they'd like to ⭐ star the claude-hud repository on GitHub to support the project. If they agree and `gh` CLI is available, first check whether their `gh` version supports `gh repo star`. If it does, run `gh repo star jarrodwatts/claude-hud`. Otherwise fall back to `gh api -X PUT /user/starred/jarrodwatts/claude-hud`. Only run the star command if they explicitly say yes.

**If no**: Debug systematically:

1. **Trigger an interaction, then restart if needed**:
    - Settings reload automatically, but the HUD only renders after the next interaction (a new message, `/compact` finishing, a permission-mode change) — sending any message should make it appear
    - If it still doesn't appear, restart Claude Code (quit and run `claude` again) — older Claude Code versions require a restart to pick up statusLine changes — then re-run `/claude-hud:setup` to verify
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
   - Solution: re-detect the runtime path (`command -v node` on Windows, `command -v bun` or `command -v node` on macOS/Linux), and verify with `realpath {RUNTIME_PATH}` (or `readlink -f {RUNTIME_PATH}`) to get the true absolute path

   **"No such file or directory" for plugin**:
   - Plugin might not be installed: `ls "${CLAUDE_CONFIG_DIR:-$HOME/.claude}"/plugins/cache/*/claude-hud/`
   - Solution: reinstall plugin via marketplace

   **Windows shell mismatch (for example, "bash not recognized")**:
   - Command format does not match `Platform:` + `Shell:`
   - Solution: re-run Step 1 branch logic and use the matching variant

   **Windows: HUD shows only "initializing..." with no error (PowerShell shell, MSYS/Cygwin command environment)**:
   - Root cause: `Shell: powershell` with `$OSTYPE=msys` or `$OSTYPE=cygwin`, causing bash to process the command before PowerShell
   - Check: run `echo $OSTYPE` in the Bash tool — if it returns `msys` or `cygwin`, this is the issue
   - Solution: re-run setup; when OSTYPE is `msys`/`cygwin`, follow the Windows + Git Bash path in Step 1

   **Windows + PowerShell: HUD silent or "initializing..." with no error in any log (OSTYPE is not msys/cygwin)**:
   - Symptoms: HUD stays at "initializing..." or shows nothing. Running the generated command interactively in a PowerShell prompt produces the expected HUD output, but the version invoked through Claude Code does not.
   - Root cause: older setup commands used a PowerShell wrapper on every refresh. That path could fail when `[Console]::WindowWidth` threw `System.IO.IOException: The handle is invalid.`, when the cache glob resolved the `claude-hud` directory instead of a version directory, or when PowerShell startup exceeded the render cadence.
   - Check: pipe stdin through `cmd.exe` to mirror Claude Code's invocation:
     ```powershell
     '{}' | & cmd.exe /c '{GENERATED_COMMAND}'
     ```
     If you see either error, the existing setup predates the Node launcher format. Re-run `/claude-hud:setup` to regenerate `statusline.mjs` and a `cmd.exe`-launched command. See [#521](https://github.com/jarrodwatts/claude-hud/issues/521).

   **Windows: PowerShell execution policy error**:
   - Run: `Set-ExecutionPolicy -Scope CurrentUser -ExecutionPolicy RemoteSigned`

   **Permission denied**:
   - Runtime not executable: `chmod +x {RUNTIME_PATH}`

   **WSL confusion**:
   - If using WSL, ensure plugin is installed in Linux environment, not Windows
   - Check: `ls "${CLAUDE_CONFIG_DIR:-$HOME/.claude}"/plugins/cache/*/claude-hud/`

5. **If still stuck**: Show the user the exact command that was generated and the error, so they can report it or debug further
