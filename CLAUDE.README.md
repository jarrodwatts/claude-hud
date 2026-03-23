# Claude HUD

Real-time statusline showing context usage, active tools, running agents, and todo progress.

---

## For Humans

**Step 1: Add the marketplace**
```
/plugin marketplace add jarrodwatts/claude-hud
```

**Step 2: Install the plugin**
```
/plugin install claude-hud
```

**Step 3: Configure the statusline**
```
/claude-hud:setup
```

Done. Restart Claude Code to load the new statusLine config, then the HUD will appear.

---

## For LLM Agents

If you're an LLM agent helping a user install or work with Claude HUD, follow these steps.

<agent_workflow>

### Step 1: Check Prerequisites

Verify Claude Code version is 1.0.80 or later:
```bash
claude --version
```

If not installed or outdated, direct user to https://claude.ai/code

### Step 2: Add the Marketplace

Run this command in Claude Code:
```
/plugin marketplace add jarrodwatts/claude-hud
```

### Step 3: Install the Plugin

Run this command in Claude Code:
```
/plugin install claude-hud
```

### Step 4: Configure the Statusline

Run this command in Claude Code:
```
/claude-hud:setup
```

This adds the statusLine configuration to the user's settings.json.

### Step 5: Inform User

Tell the user:
- Installation complete
- Restart Claude Code to load the statusline config, then the HUD will appear
- It shows: context usage, active tools, running agents, and todo progress

### Step 6: Ask About Starring (Optional)

Ask the user: "Would you like to star the repository to support the project?"

Only if they explicitly agree, run:
```bash
gh repo star jarrodwatts/claude-hud
```

Never run this automatically without user consent.

</agent_workflow>

---

## Reference

Technical documentation for agents who need to understand, modify, or debug Claude HUD.

<plugin>
  <name>Claude HUD</name>
  <description>Real-time statusline showing context usage, active tools, running agents, and todo progress. Always visible below your input, zero config required.</description>
  <repository>github.com/jarrodwatts/claude-hud</repository>
  <license>MIT</license>
</plugin>

<requirements>
  <runtime>Node.js 18+ or Bun</runtime>
  <claude_code>v1.0.80 or later</claude_code>
  <build>TypeScript 5, ES2022 target, NodeNext modules</build>
</requirements>

<architecture>
  <overview>
    Claude HUD is a statusline plugin invoked by Claude Code every ~300ms.
    It reads official statusline data from stdin plus local transcript/config data, renders up to 4 lines, and outputs to stdout.
  </overview>

  <data_flow>
    Claude Code invokes the plugin →
    Plugin reads JSON from stdin (model, context, tokens) →
    Plugin parses transcript JSONL file (tools, agents, todos) →
    Plugin reads config files (MCPs, hooks, rules) →
    Plugin renders lines to stdout →
    Claude Code displays the statusline
  </data_flow>

  <data_sources>
    <stdin_json description="Native accurate data from Claude Code">
      <field path="model.display_name">Current model name (Opus, Sonnet, Haiku)</field>
      <field path="context_window.current_usage.input_tokens">Current token count</field>
      <field path="context_window.context_window_size">Maximum context size</field>
      <field path="rate_limits.five_hour.used_percentage">Subscriber 5-hour rate limit usage when provided</field>
      <field path="rate_limits.five_hour.resets_at">5-hour rate limit reset timestamp when provided</field>
      <field path="rate_limits.seven_day.used_percentage">Subscriber 7-day rate limit usage when provided</field>
      <field path="rate_limits.seven_day.resets_at">7-day rate limit reset timestamp when provided</field>
      <field path="transcript_path">Path to session transcript JSONL file</field>
      <field path="cwd">Current working directory</field>
    </stdin_json>

    <transcript_jsonl description="Parsed from transcript file">
      <item>tool_use blocks → tool name, target file, start time</item>
      <item>tool_result blocks → completion status, duration</item>
      <item>Running tools = tool_use without matching tool_result</item>
      <item>TodoWrite calls → current todo list</item>
      <item>Task calls → agent type, model, description</item>
    </transcript_jsonl>

    <config_files description="Read from Claude configuration">
      <item>~/.claude/settings.json → mcpServers count, hooks count</item>
      <item>CLAUDE.md files in cwd and ancestors → rules count</item>
      <item>.mcp.json files → additional MCP count</item>
    </config_files>
  </data_sources>
</architecture>

<file_structure>
  <directory name="src">
    <file name="index.ts" purpose="Entry point, orchestrates data flow">
      Reads stdin, parses transcript, counts configs, calls render.
      Exports main() for testing with dependency injection.
    </file>
    <file name="stdin.ts" purpose="Parse JSON from stdin">
      Reads and validates Claude Code's JSON input.
      Returns StdinData with model, context, transcript_path.
    </file>
    <file name="transcript.ts" purpose="Parse transcript JSONL">
      Parses the session transcript file line by line.
      Extracts tools, agents, todos, and session start time.
      Matches tool_use to tool_result by ID to calculate status.
    </file>
    <file name="config-reader.ts" purpose="Count configuration items">
      Counts CLAUDE.md files, rules, MCP servers, and hooks.
      Searches cwd, ~/.claude/, and project .claude/ directories.
    </file>
    <file name="config.ts" purpose="Load and validate user configuration">
      Reads config.json from ~/.claude/plugins/claude-hud/.
      Validates and merges user settings with defaults.
      Exports HudConfig interface and loadConfig function.
    </file>
    <file name="git.ts" purpose="Git repository status">
      Gets branch name, dirty state, and ahead/behind counts.
      Uses execFile with array args for safe command execution.
    </file>
    <file name="types.ts" purpose="TypeScript interfaces">
      StdinData, ToolEntry, AgentEntry, TodoItem, TranscriptData, RenderContext.
    </file>
  </directory>

  <directory name="src/render">
    <file name="index.ts" purpose="Main render coordinator">
      Calls each line renderer and outputs to stdout.
      Conditionally shows lines based on data presence.
    </file>
    <file name="session-line.ts" purpose="Line 1: Session info">
      Renders: [Model] █████░░░░░ 45% | project git:(branch) | 2 CLAUDE.md | 5h: 25% | ⏱️ 5m
      Context bar colors: green (&lt;70%), yellow (70-85%), red (&gt;85%).
    </file>
    <file name="tools-line.ts" purpose="Line 2: Tool activity">
      Renders: ◐ Edit: auth.ts | ✓ Read ×3 | ✓ Grep ×2
      Shows running tools with spinner, completed tools aggregated.
    </file>
    <file name="agents-line.ts" purpose="Line 3: Agent status">
      Renders: ◐ explore [haiku]: Finding auth code (2m 15s)
      Shows agent type, model, description, elapsed time.
    </file>
    <file name="todos-line.ts" purpose="Line 4: Todo progress">
      Renders: ▸ Fix authentication bug (2/5)
      Shows current in_progress task and completion count.
    </file>
    <file name="colors.ts" purpose="ANSI color helpers">
      Functions: green(), yellow(), red(), dim(), bold(), reset().
      Used for colorizing output based on status/thresholds.
    </file>
  </directory>
</file_structure>

<output_format>
  <line number="1" name="session" always_shown="true">
    [Model] █████░░░░░ 45% | project git:(branch) | 2 CLAUDE.md | 5h: 25% | ⏱️ 5m
  </line>
  <line number="2" name="tools" shown_if="any tools used">
    ◐ Edit: auth.ts | ✓ Read ×3 | ✓ Grep ×2
  </line>
  <line number="3" name="agents" shown_if="agents active">
    ◐ explore [haiku]: Finding auth code (2m 15s)
  </line>
  <line number="4" name="todos" shown_if="todos exist">
    ▸ Fix authentication bug (2/5)
  </line>
</output_format>

<context_thresholds>
  <threshold range="0-70%" color="green" meaning="Healthy" />
  <threshold range="70-85%" color="yellow" meaning="Warning" />
  <threshold range="85%+" color="red" meaning="Critical, shows token breakdown" />
</context_thresholds>

<plugin_configuration>
  <manifest>.claude-plugin/plugin.json</manifest>
  <manifest_content>
    {
      "name": "claude-hud",
      "description": "Real-time statusline HUD for Claude Code",
      "version": "0.0.1",
      "author": { "name": "Jarrod Watts", "url": "https://github.com/jarrodwatts" }
    }
  </manifest_content>
  <note>The plugin.json contains metadata only. statusLine is NOT a valid plugin.json field.</note>

  <statusline_config>
    The /claude-hud:setup command adds statusLine to ~/.claude/settings.json with an auto-updating command that finds the latest installed version.
    Updates are automatic - no need to re-run setup after updating the plugin.
  </statusline_config>
</plugin_configuration>

<development>
  <setup>
    git clone https://github.com/jarrodwatts/claude-hud
    cd claude-hud
    npm ci
    npm run build
  </setup>

  <test_commands>
    npm test                    # Run all tests
    npm run build               # Compile TypeScript to dist/
  </test_commands>

  <manual_testing>
    # Test with sample stdin data:
    echo '{"model":{"display_name":"Opus"},"context_window":{"current_usage":{"input_tokens":45000},"context_window_size":200000}}' | node dist/index.js

    # Test with transcript path:
    echo '{"model":{"display_name":"Sonnet"},"transcript_path":"/path/to/transcript.jsonl","context_window":{"current_usage":{"input_tokens":90000},"context_window_size":200000}}' | node dist/index.js
  </manual_testing>
</development>

<customization>
  <extending description="How to add new features">
    <step>Add new data extraction in transcript.ts or stdin.ts</step>
    <step>Add new interface fields in types.ts</step>
    <step>Create new render file in src/render/ or modify existing</step>
    <step>Update src/render/index.ts to include new line</step>
    <step>Run npm run build and test</step>
  </extending>

  <modifying_thresholds>
    Edit src/render/session-line.ts to change context threshold values.
    Look for the percentage checks that determine color coding.
  </modifying_thresholds>

  <adding_new_line>
    1. Create src/render/new-line.ts with a render function
    2. Import and call it from src/render/index.ts
    3. Add any needed types to src/types.ts
    4. Add data extraction logic to transcript.ts if needed
  </adding_new_line>
</customization>

<troubleshooting>
  <issue name="Statusline not appearing">
    <cause>Plugin not installed or statusLine not configured</cause>
    <solution>Run: /plugin marketplace add jarrodwatts/claude-hud</solution>
    <solution>Run: /plugin install claude-hud</solution>
    <solution>Run: /claude-hud:setup</solution>
    <solution>Ensure Claude Code is v1.0.80 or later</solution>
  </issue>

  <issue name="Shows [claude-hud] Initializing...">
    <cause>No stdin data received (normal on first invocation)</cause>
    <solution>This is expected briefly on startup, should resolve automatically</solution>
  </issue>

  <issue name="Context percentage seems wrong">
    <cause>Data comes directly from Claude Code - it's accurate</cause>
    <solution>Claude HUD uses Claude Code's native context_window.used_percentage when available, then falls back to token-based calculation for older versions.</solution>
  </issue>

  <issue name="Tools/agents not showing">
    <cause>No tools used yet or transcript not being parsed</cause>
    <solution>Lines only appear when there's data to show</solution>
  </issue>

  <issue name="Build errors">
    <solution>Ensure Node.js 18+ installed</solution>
    <solution>Run npm ci to reinstall dependencies</solution>
    <solution>Delete dist/ and node_modules/, then npm ci && npm run build</solution>
  </issue>
</troubleshooting>

<key_interfaces>
  <interface name="StdinData">
    transcript_path?: string
    cwd?: string
    model?: { id?: string, display_name?: string }
    context_window?: { used_percentage?: number, context_window_size?: number, current_usage?: { input_tokens?: number } }
  </interface>

  <interface name="ToolEntry">
    id: string
    name: string
    target?: string
    status: 'running' | 'completed' | 'error'
    startTime: Date
    endTime?: Date
  </interface>

  <interface name="AgentEntry">
    id: string
    type: string
    model?: string
    description?: string
    status: 'running' | 'completed'
    startTime: Date
    endTime?: Date
  </interface>

  <interface name="TodoItem">
    content: string
    status: 'pending' | 'in_progress' | 'completed'
  </interface>

  <interface name="RenderContext">
    stdin: StdinData
    transcript: TranscriptData
    claudeMdCount: number
    rulesCount: number
    mcpCount: number
    hooksCount: number
    sessionDuration: string
  </interface>
</key_interfaces>

<task_instructions>
  <install>
    Follow the agent_workflow steps above.
  </install>

  <modify>
    If the user wants to modify Claude HUD:
    1. Clone the repo or navigate to the plugin directory
    2. Make changes following the file_structure section
    3. Run npm run build to compile
    4. Restart Claude Code to see changes
  </modify>

  <debug>
    If the user reports issues:
    1. Check troubleshooting section first
    2. Verify Claude Code version (needs v1.0.80+)
    3. Check if plugin is listed: claude /plugin list
    4. Test manually with echo command from development section
  </debug>

  <understand>
    If the user asks how something works:
    1. Reference the architecture and data_flow sections
    2. Point to specific files in file_structure
    3. Explain the data sources and how they're combined
  </understand>
</task_instructions>
