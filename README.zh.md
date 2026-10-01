# Claude HUD

一个 Claude Code 插件，常驻在输入框下方，实时显示上下文用量、使用率限制、正在运行的工具、子代理以及待办进度。

[![License](https://img.shields.io/github/license/jarrodwatts/claude-hud?v=2)](LICENSE)
[![Stars](https://img.shields.io/github/stars/jarrodwatts/claude-hud)](https://github.com/jarrodwatts/claude-hud/stargazers)

![Claude HUD 运行效果](claude-hud-preview-5-2.png)

> 🌐 [English](README.md) | 中文文档

## 安装

在 Claude Code 中运行：

```
/plugin marketplace add jarrodwatts/claude-hud
/plugin install claude-hud
/reload-plugins
/claude-hud:setup
```

`/claude-hud:setup` 会把状态栏指向 HUD。Claude Code 会自动重新加载设置，HUD 在你发送下一条消息后出现。

<details>
<summary><strong>更喜欢用终端？</strong></summary>

```bash
claude plugin marketplace add jarrodwatts/claude-hud
claude plugin install claude-hud@claude-hud
```

然后在会话中运行 `/reload-plugins` 和 `/claude-hud:setup`。

</details>

<details>
<summary><strong>Windows：setup 提示找不到 JavaScript 运行时</strong></summary>

安装 Node.js LTS（`winget install OpenJS.NodeJS.LTS`），重启 shell，然后再次运行 `/claude-hud:setup`。

</details>

## 显示效果

默认显示两行：

```
[Opus] │ my-project git:(main*)
Context █████░░░░░ 45% │ Usage ██░░░░░░░░ 25% (resets in 1h 30m)
```

- **第 1 行**：模型、检测到时的提供商标签（`Bedrock`、`Vertex`、`MiniMax`）、项目路径和 git 分支。
- **第 2 行**：上下文用量（随占用依次变为绿、黄、红）以及订阅用户的使用率限制。

可选行，通过 `/claude-hud:configure` 开启：

```
◐ Edit: auth.ts | ✓ Read ×3 | ✓ Grep ×2        ← 工具
◐ explore [haiku]: Finding auth code (2m 15s)    ← 子代理
▸ Fix authentication bug (2/5)                   ← 待办
```

## 工作原理

Claude HUD 是一个[状态栏](https://code.claude.com/docs/en/statusline)命令。Claude Code 通过 stdin 传入会话数据（模型、上下文窗口、费用、使用率限制、prompt cache）并显示它的输出。部分可选元素（例如工具、子代理和待办行）还会读取会话 transcript。不需要单独的窗口或 tmux，任何终端都能用。

## 配置

```
/claude-hud:configure
```

引导流程涵盖布局、活动行、会话信息、使用率、git、语言和自定义行。保存前会预览改动，并保留它没有询问的所有设置。

其他设置位于 `~/.claude/plugins/claude-hud/config.json`（或 `$CLAUDE_CONFIG_DIR` 下）。无效值会回退为默认值。

如果多个 `CLAUDE_CONFIG_DIR` 共用同一个 `plugins/` 目录，可以把各目录专属的设置放进 `$CLAUDE_CONFIG_DIR/claude-hud.json`。它的结构相同，只需写要改的键，加载时叠加在共享配置之上：

```json
{ "display": { "customLine": "Work Team" } }
```

标签语言支持英文（默认）、简体中文（`zh-Hans`，别名 `zh`）和繁体中文（`zh-Hant`，别名 `zh-TW`）。

### 选项

| 选项 | 类型 | 默认值 | 说明 |
|------|------|--------|------|
| `language` | `en` \| `zh` \| `zh-Hans` \| `zh-Hant` \| `zh-TW` | `en` | HUD 标签语言。设为 `zh` 或 `zh-Hans` 启用简体中文，设为 `zh-Hant` 或 `zh-TW` 启用繁体中文 |
| `lineLayout` | string | `expanded` | 布局：`expanded`（多行）或 `compact`（单行） |
| `showSeparators` | boolean | false | 在 `compact` 布局中，在会话行与活动行之间画一条分隔线 |
| `pathLevels` | 1-3 \| `full` | 1 | 项目路径显示的目录层级数，或设为 `full` 显示完整绝对路径 |
| `maxWidth` | number \| `null` | `null` | 可选的回退宽度，仅在终端宽度检测完全失败时使用 |
| `forceMaxWidth` | boolean | false | 当设置了 `maxWidth` 时始终使用它，即使终端宽度检测返回更小的值 |
| `elementOrder` | string[] | `["project","context","usage","promptCache","memory","environment","tools","agents","todos","sessionTime"]` | 展开模式下元素的顺序。省略的条目在展开模式下隐藏。现有配置会保留其显式顺序直到更新 |
| `projectLineOrder` | string[] | `[]` | 可选的首行片段前置顺序，适用于两种布局。可见性仍由 `display.show*` 控制；省略的片段保持渲染器原有顺序。例如 `["project","model"]` 会将项目和 Git 放到模型徽标之前 |
| `display.mergeGroups` | string[][] | `[["context","usage"]]` | 展开模式下相邻时应共享一行的元素分组。设为 `[]` 可禁用合并行 |
| `display.rightAlign` | string[] | `[]` | 以合并行中第一个列出的元素作为右对齐后缀的起点，保持 `elementOrder` 并用空格填充间隔。锚点必须位于实际合并渲染的 `display.mergeGroups` 分组中。终端宽度未知、锚点位于首位或空间不足时回退到普通的 ` │ ` 连接。示例：分组为 `["project","context","usage"]` 时设为 `["context"]`，项目/git 保持在左侧，context 与 usage 靠右对齐。 |
| `gitStatus.enabled` | boolean | true | 在 HUD 中显示 git 分支 |
| `gitStatus.showDirty` | boolean | true | 显示 `*` 表示未提交的更改 |
| `gitStatus.showAheadBehind` | boolean | false | 显示 `↑N ↓N` 表示领先/落后远程的提交数 |
| `gitStatus.pushWarningThreshold` | number | 0 | 当未推送提交数达到此值时，用警告色显示 ahead 计数（`0` 表示禁用） |
| `gitStatus.pushCriticalThreshold` | number | 0 | 当未推送提交数达到此值时，用严重色显示 ahead 计数（`0` 表示禁用） |
| `gitStatus.showFileStats` | boolean | false | 显示文件变更数量 `!M +A ✘D ?U` |
| `gitStatus.showWorktree` | boolean | false | 在关联的 git worktree 中，于分支后显示其名称，例如 `git:(feat/x) ⎇ feat-x` |
| `gitStatus.branchOverflow` | `truncate` \| `wrap` | `truncate` | 保持当前截断行为，或在可能时让 git 块以自己的换行边界单独换到下一行 |
| `jjStatus.enabled` | boolean | false | 显式启用 jj（Jujutsu）状态。启用后若找到真实的 `.jj` 目录，该仓库将显示 jj 而不是 git，二者不会同时运行 |
| `jjStatus.showDirty` | boolean | true | 当 jj 工作副本提交与其父提交不同时显示 `*` |
| `jjStatus.showConflicts` | boolean | true | 当 jj 工作副本提交包含未解决冲突时显示 `!conflict` |
| `display.showModel` | boolean | true | 显示模型名称 `[Opus]` |
| `display.showProject` | boolean | true | 显示项目路径 |
| `display.modelSource` | `stdin` \| `auto` \| `transcript` | `stdin` | 控制模型名称来源。`stdin` 保持默认行为；`auto` 仅在 transcript 返回非 Claude 模型时切换，用于检测代理路由；`transcript` 始终使用 API 响应中的模型。Transcript 模型值会清理终端转义字符并截断为 80 个字符 |
| `display.modelFormat` | `full` \| `compact` \| `short` | `full` | `compact` 去掉 `(1M context)` 这类上下文窗口后缀；`short` 还会去掉开头的 `Claude ` |
| `display.modelOverride` | string | `""` | 用这段文字代替模型名称（最多 80 个字符） |
| `display.showProvider` | boolean | false | 在模型名称*之前*显示提供商标签，例如 `[Bedrock \| Opus 4.6]`。自定义代理提供同名模型时有用。关闭时，自动检测的提供商仍跟在模型后面 |
| `display.providerName` | string | `""` | 与 `display.showProvider` 一起使用的显式提供商标签，例如无法自动检测的自定义代理。为空时回退到自动检测（Bedrock/Vertex/MiniMax/Enterprise）；上限 40 字符 |
| `display.showAddedDirs` | boolean | true | 显示来自 `/add-dir` 的额外工作区目录（如 `+sparkle +lib-foo`）；空数组不显示任何内容。在两种布局中最多渲染 5 个目录（溢出显示为 `+N more`），基名截断为 24 个字符并加 `…` |
| `display.addedDirsLayout` | `inline` \| `line` | `inline` | `inline` 将目录放在项目名称旁边，每个目录带 `+name` 前缀；`line` 在单独的 `Added dirs: name1, name2` 行渲染（无 `+` 前缀，逗号分隔） |
| `display.showContextBar` | boolean | true | 显示可视化上下文进度条 `████░░░░░░` |
| `display.contextValue` | `percent` \| `tokens` \| `remaining` \| `both` | `percent` | 上下文显示格式（`45%`、`45k/200k`、剩余 `55%` 或 `45% (45k/200k)`） |
| `display.autoCompactWindow` | number \| `null` | `null` | 设为正数（如 `200000`）时，按此自动压缩窗口而不是完整模型上下文窗口计算上下文百分比，以匹配 `/context`。留空或 `null` 保持默认全窗口行为 |
| `display.showConfigCounts` | boolean | false | 显示 CLAUDE.md、rules、MCPs、hooks 数量 |
| `display.environmentThreshold` | number | 0 | 配置计数总和达到此值前隐藏（0 = 始终显示） |
| `display.showCost` | boolean | false | 显示 Claude Code 上报的会话费用（`cost.total_cost_usd`） |
| `display.showRoutedCost` | boolean | false | 同时为 Bedrock 和 Vertex 会话显示费用。它们通过云服务商计费，因此 `showCost` 默认隐藏其费用。需同时开启 `showCost` |
| `display.showDailyCost` | boolean | false | 显示当天跨会话累计花费，格式为 `Today $12.34`，从原生 `cost.total_cost_usd` 写入插件数据目录中的按日账本。本地午夜重置。与 `showCost` 独立 |
| `display.showWeeklyCost` | boolean | false | 显示自每周额度窗口开始以来的累计花费，格式为 `Week $123.45`，与 `showDailyCost` 使用同一账本。仅订阅用户可用：需要 7 天用量窗口 |
| `display.showOutputStyle` | boolean | false | 显示当前输出风格，格式为 `style: <名称>` |
| `display.showDuration` | boolean | false | 显示会话已运行的时长，例如 `⏱️ 5m` |
| `display.showSpeed` | boolean | false | 显示最近一次响应的输出 Token 速度 `out: 42.1 tok/s` |
| `display.showUsage` | boolean | true | 显示 Claude 订阅用户的使用率限制（可用时） |
| `display.usageValue` | `percent` \| `remaining` | `percent` | 使用率显示格式（已使用 `25%`，或剩余 `75%`） |
| `display.usageBarEnabled` | boolean | true | 将使用率显示为可视化进度条而非文本 |
| `display.usageCompact` | boolean | false | 以较短的文本形式显示使用率，如 `5h: 25% (1h 30m)`；优先于 `display.usageBarEnabled` |
| `display.showResetLabel` | boolean | true | 在使用率倒计时前显示 `resets in` 前缀 |
| `display.showModelScopedUsage` | boolean | true | 显示按模型每周窗口（`model_scoped`，例如 Fable），无论其来自 stdin 还是外部用量快照。设为 `false` 后，使用率行的渲染效果等同于负载中本就没有这些窗口 |
| `display.usagePace` | boolean | false | 当使用率窗口按当前速度会在重置前用尽时，以琥珀色或红色显示并标记 `▲` |
| `display.timeFormat` | `relative` \| `absolute` \| `both` \| `elapsed` \| `elapsedAndAbsolute` | `relative` | 控制使用率窗口时间的显示方式：仅倒计时（`resets in 2h 30m`）、墙钟重置时间（`resets at 14:30`）、两者同时显示、窗口已过百分比（`53% elapsed`），或已过百分比加墙钟重置时间 |
| `display.hourCycle` | `auto` \| `h11` \| `h12` \| `h23` \| `h24` | `auto` | 墙钟重置时间（`absolute`/`both`/`elapsedAndAbsolute` 模式）的时制。`auto` 跟随系统区域设置；`h23` 强制使用 24 小时制（`14:30`），不受区域设置影响 |
| `display.showClockSeconds` | boolean | false | 在墙钟重置时间中显示秒数，如 `at 14:30:07` |
| `display.usageThreshold` | 0-100 | 0 | 任一窗口达到此百分比前隐藏使用率（0 = 始终显示） |
| `display.sevenDayThreshold` | 0-100 | 80 | 当 7 天使用率 ≥ 阈值时显示（0 = 始终显示） |
| `display.externalUsagePath` | string | `""` | 可选的本地使用率快照文件**绝对路径**。支持开头的 `~` 和 `${VAR}`。相对路径会被忽略。stdin `rate_limits` 存在时会附加 `balance_label`，并在 stdin 缺少 `model_scoped` 窗口时用快照补齐；stdin 窗口缺失时可整体作为回退 |
| `display.externalUsageWritePath` | string | `""` | 可选的绝对 `.json` 路径，父目录必须已存在。支持开头的 `~` 和 `${VAR}`。当 stdin `rate_limits` 存在时，ClaudeHUD 会写入私有权限快照供其他本地工具读取。相对路径、非 json 文件和缺失父目录会被忽略 |
| `display.externalUsageFreshnessMs` | number | `300000` | 外部使用率快照允许的最长存活时间，超时后会被忽略 |
| `display.showTokenBreakdown` | boolean | true | 在高上下文时（85%+）显示 Token 详情 |
| `display.contextWarningThreshold` | 0-100 | 70 | 上下文进度条变为警告色的百分比 |
| `display.contextCriticalThreshold` | 0-100 | 85 | 上下文进度条变为严重色并显示 token 明细的百分比 |
| `display.showTools` | boolean | false | 显示工具活动行 |
| `display.showSkills` | boolean | false | 显示从 `Skill` 工具调用检测到的活动 Skills |
| `display.showMcp` | boolean | false | 显示从 `mcp__server__tool` 调用检测到的活动 MCP 服务器 |
| `display.toolNameMaxLength` | number | `0` | 工具名称最大显示长度。`0` 保留完整名称；截断 MCP 名称时可能缩短为最后一段 |
| `display.toolsMaxVisible` | number | `4` | 工具行最多显示的已完成工具数。`0` 表示不限制 |
| `display.skillsMaxVisible` | number | `4` | Skills 行在 `+N more` 之前最多显示的 Skill 名称数。`0` 表示不限制 |
| `display.showAgents` | boolean | false | 显示 Agent 活动行 |
| `display.showTodos` | boolean | false | 显示待办进度行 |
| `display.showSessionName` | boolean | false | 显示会话名称：`/rename` 设置的名称，或 Claude Code 生成的标题 |
| `display.showSessionTokens` | boolean | false | 显示本会话累计的 token 总量，例如 `Tokens 262k (in: 6k, out: 2k, cache: 254k)` |
| `display.showAuth` | boolean | false | 在第一行末尾显示当前登录的认证方式（订阅计划），例如 `Claude Max 20x`。来自 `~/.claude.json`（或覆盖配置目录时的 `$CLAUDE_CONFIG_DIR/.claude.json`）的 `oauthAccount`；无 OAuth 但设置了 `ANTHROPIC_API_KEY` 时显示 `API Key` |
| `display.showAuthUser` | boolean | false | 在认证方式旁显示已登录账号（邮箱本地部分，回退到资料显示名） |
| `display.authUserLength` | number | `8` | 账号名截断前的最大字符数，超出以 `…` 截断。`0` 显示全名 |
| `display.showAdvisor` | boolean | false | 在 project 行内联显示 Claude Code `/advisor` 配置的顾问模型，例如 `Advisor: Opus 4.7`。来自 Claude Code 写入每条 assistant transcript 记录的 `advisorModel` 字段；渲染前会做控制字符/双向标记/ANSI 过滤并截断到 64 字符 |
| `display.advisorOverride` | string | `""` | 手动覆盖顾问显示文本。非空时优先于 transcript 检测，同样会做过滤和截断 |
| `display.showSessionStartDate` | boolean | false | 显示 transcript 会话开始时间戳 |
| `display.showLastResponseAt` | boolean | false | 显示最后一次 assistant 响应写入的时间距现在多久 |
| `display.showCompactions` | boolean | false | 显示本会话已发生的上下文压缩次数（手动 `/compact` 或自动压缩），从 transcript 的 `compact_boundary` 记录计数，例如 `压缩次数: 2`。第一次压缩前不显示 |
| `display.showEffortLevel` | boolean | false | 在模型徽章中显示当前推理力度。Ultracode 渲染为 `ultracode(xhigh)`，从会话 transcript 检测，因此能跟踪运行时的 `/effort` 变更 |
| `display.effortFormat` | `full` \| `symbol` \| `text` | `full` | `showEffortLevel` 开启时的渲染方式：符号加级别文本（`◑ high`）、仅符号（`◑`）、或仅级别文本（`high`）。`symbol` 下 Ultracode 仍保持完整的 `◕ ultracode(xhigh)`，以免丢失标记；没有已知符号的级别回退到级别文本 |
| `display.showClaudeCodeVersion` | boolean | false | 显示当前运行的 Claude Code 版本，如 `CC v2.1.81` |
| `display.showMemoryUsage` | boolean | false | 在展开布局中显示近似系统 RAM 使用行 |
| `display.showPromptCache` | boolean | false | 显示主会话 prompt cache 的过期时刻 |
| `display.showCacheHitRate` | boolean | false | 以 `Cache hit X%` 形式显示本会话的 prompt cache 命中率 |
| `display.customLine` | string | `""` | 显示在第一行的自定义文字（最多 80 个字符） |
| `display.customLinePosition` | `first` \| `last` | `last` | 自定义文字放在第一行的开头还是结尾 |
| `colors.context` | 颜色值 | `green` | 上下文进度条和百分比的基础颜色 |
| `colors.usage` | 颜色值 | `brightBlue` | 使用率进度条和低于警告阈值时百分比的颜色 |
| `colors.warning` | 颜色值 | `yellow` | 上下文阈值和使用率警告文本的警告颜色 |
| `colors.usageWarning` | 颜色值 | `brightMagenta` | 使用率进度条和接近阈值时百分比的警告颜色 |
| `colors.critical` | 颜色值 | `red` | 达到限制状态和严重阈值的颜色 |
| `colors.model` | 颜色值 | `cyan` | 模型徽章颜色，如 `[Opus]` |
| `colors.project` | 颜色值 | `yellow` | 项目路径的颜色 |
| `colors.git` | 颜色值 | `magenta` | Git 包装文本的颜色，如 `git:(` 和 `)` |
| `colors.gitBranch` | 颜色值 | `cyan` | Git 分支和分支状态文本的颜色 |
| `colors.label` | 颜色值 | `dim` | 标签和次要元数据的颜色，如 `Context`、`Usage`、计数和进度文本 |
| `colors.custom` | 颜色值 | `208` | 可选自定义行的颜色 |
| `colors.barFilled` | string | `█` | 进度条填充部分使用的字符 |
| `colors.barEmpty` | string | `░` | 进度条空白部分使用的字符 |

颜色可以是名称（`dim`、`red`、`green`、`yellow`、`magenta`、`cyan`、`brightBlue`、`brightMagenta`）、256 色编号（`0-255`）或十六进制（`#rrggbb`）。`colors.barFilled` 和 `colors.barEmpty` 只接受单个可见字符；emoji 等宽字符在部分终端中可能影响进度条对齐。

### 使用率限制

只要 Claude Code 发送了订阅用户的 `rate_limits`（会话中首个响应之后），就会显示使用率。API key、Bedrock 和 Vertex 会话没有订阅用户限额，因此不显示。7 天窗口在超过 `display.sevenDayThreshold` 后出现：

```
Context █████░░░░░ 45% │ Usage ██░░░░░░░░ 25% (resets in 1h 30m) | Weekly █████████░ 85% (resets in 1d)
```

开启 `display.usagePace` 后，消耗快于恢复的窗口会变为琥珀色（预计用到 90% 及以上）或红色（预计在重置前用尽），并加上 `▲`。已用低于 10% 的窗口保持中性。

**外部快照。** `display.externalUsagePath` 读取一个本地 JSON 文件。stdin 没有窗口数据时由它补上，它的 `balance_label` 或 `model_scoped` 窗口（例如按模型的每周额度）会附加到 stdin 的数据上。路径必须是绝对路径，且文件要比 `display.externalUsageFreshnessMs` 新：

```json
{
  "updated_at": "2026-04-20T12:00:00.000Z",
  "five_hour": { "used_percentage": 42, "resets_at": "2026-04-20T15:00:00.000Z" },
  "seven_day": { "used_percentage": 84, "resets_at": "2026-04-27T12:00:00.000Z" },
  "balance_label": "¥6.35",
  "model_scoped": [{ "display_name": "Fable", "utilization": 89, "resets_at": "2026-04-27T11:00:00Z" }]
}
```

`display.externalUsageWritePath` 则反过来：把 stdin 的使用率限制写入一个已存在目录中的私有 `.json` 文件，供其他工具读取。

### 费用

`display.showCost` 显示 Claude Code 自己计算的会话费用（按标价，或使用你的 `modelPricing` 表）。Bedrock 和 Vertex 通过云服务商计费，因此除非同时设置 `display.showRoutedCost`，否则不显示它们的费用。

`display.showDailyCost` 会加上今天所有会话的花费（`Today $12.34`）。它记录在插件数据目录中的一个小账本里，在本地午夜重置，并从首次看到该会话的渲染开始计数。`display.showWeeklyCost` 使用同一个账本，从 7 天额度窗口的开始计数，因此需要订阅用户会话。

### Prompt Cache

`display.showPromptCache` 显示主会话 prompt cache 何时失效，例如 `Cache ⏱ until 14:30`，或 `expired`。它显示时刻而不是倒计时：状态栏在两个回合之间不会重绘，而那正是缓存流失的时候；时刻无论渲染多旧都仍然正确。`display.showCacheHitRate` 显示从缓存读取的输入 token 占比。

### Jujutsu（jj）

把 `jjStatus.enabled` 设为 `true`，在含有 `.jj` 仓库的目录中会显示 jj 状态（例如 `jj:(mybookmark*)` 或 `jj:(wrulwzyw !conflict)`）而不是 git。HUD 以只读方式运行 jj，不会对工作副本做快照，因此脏标记反映的是 jj 最近一次快照。领先/落后计数和文件统计仅适用于 git。

### 示例

```json
{
  "lineLayout": "expanded",
  "pathLevels": 2,
  "gitStatus": { "showAheadBehind": true, "showFileStats": true },
  "display": {
    "showTools": true,
    "showAgents": true,
    "showTodos": true,
    "showDuration": true,
    "showCost": true
  },
  "colors": { "context": "cyan", "custom": "#FF6600" }
}
```

### 自动刷新

Claude Code 会在每条消息、`/compact`、权限或 vim 模式变化、使用率窗口重置以及 prompt cache 失效之后重新运行状态栏。若想在会话空闲时让倒计时和时长继续走动，在 `~/.claude/settings.json` 的 `statusLine` 中加上 `refreshInterval`（秒）。`/claude-hud:setup` 会提供这一选项。

### 临时关闭

```bash
CLAUDE_HUD_DISABLE=1 claude
```

除 `0`、`false`、`off`、`no` 之外的任何值都会在该会话中清空 HUD，无需修改 `settings.json`。

## 安全

Claude HUD 只在本地运行。它不发起网络请求，从不读取凭据，也不调用未公开的 API。它读取 Claude Code 的 stdin、会话 transcript、Claude 配置文件以及当前目录的 git 或 jj 元数据。它唯一写入的是 `~/.claude/plugins/claude-hud` 下的少量状态文件（输出速度和费用账本），并使用私有权限。

`--extra-cmd` 会在每次刷新时运行一条 shell 命令，并把输出显示在第一行。除非 HUD 的环境中设置了 `CLAUDE_HUD_ALLOW_EXTRA_CMD=1`，否则它会被忽略。请把它视为任意代码执行，切勿使用来源不可信的命令。

## 故障排查

**HUD 没有出现。** 发送一条消息，状态栏会在交互之后渲染。确认 shell 中没有设置 `CLAUDE_HUD_DISABLE`。如果 Node 或 Bun 的路径变了（例如 nvm 或 mise 升级之后），重新运行 `/claude-hud:setup`。

**配置没有生效。** 检查 JSON 是否有语法错误：无效文件会回退为默认值。确认取值在范围内，选项表中列出了各项范围。

**没有显示使用率。** 使用率需要以 Claude 订阅用户身份登录，并在首个响应之后出现。检查 `display.showUsage`。

**没有 git 或 jj 状态。** 确认当前位于仓库中，并且开启了 `gitStatus.enabled`（或 `jjStatus.enabled`，且 `jj` 在 `PATH` 中）。

**缺少某个活动行。** 工具、子代理、待办、技能和 MCP 行默认关闭，并且只在有活动时显示。

## 运行环境要求

- Claude Code v2.1.260 或更高版本
- macOS 或 Linux：Node.js 18+ 或 Bun
- Windows：Node.js 18+

## 开发

```bash
git clone https://github.com/jarrodwatts/claude-hud
cd claude-hud
npm ci && npm test
```

参见 [CONTRIBUTING.md](CONTRIBUTING.md)。

## 许可证

MIT，参见 [LICENSE](LICENSE)。

## Star 历史

[![Star History Chart](https://api.star-history.com/svg?repos=jarrodwatts/claude-hud&type=Date)](https://star-history.com/#jarrodwatts/claude-hud&Date)
