# Claude HUD

一个 Claude Code 插件，实时显示正在发生的事情——上下文使用率、活跃工具、运行中的 Agent 和待办进度。始终在你的输入下方可见。

[![License](https://img.shields.io/github/license/jarrodwatts/claude-hud?v=2)](LICENSE)
[![Stars](https://img.shields.io/github/stars/jarrodwatts/claude-hud)](https://github.com/jarrodwatts/claude-hud/stargazers)

![Claude HUD in action](claude-hud-preview-5-2.png)

> 🌐 [English README](README.md) | 中文文档

## 安装

在 Claude Code 实例中，运行以下命令：

**步骤 1：添加市场**
```
/plugin marketplace add jarrodwatts/claude-hud
```

**步骤 2：安装插件**

<details>
<summary><strong>⚠️ Linux 用户：如果安装报 EXDEV 错误，请点击此处</strong></summary>

在较旧的 Claude Code 版本上，`/tmp` 作为独立文件系统（tmpfs）会导致插件安装失败并报错：
```
EXDEV: cross-device link not permitted
```

这个 [Claude Code 缺陷](https://github.com/anthropics/claude-code/issues/14799)已经修复——如果遇到此错误，请先升级 Claude Code。如果无法升级，可在安装前设置 TMPDIR：
```bash
mkdir -p ~/.cache/tmp && TMPDIR=~/.cache/tmp claude
```

然后在该会话中运行下面的安装命令。

</details>

```
/plugin install claude-hud
```

安装完成后，重新加载插件（无需重启）：

```
/reload-plugins
```

<details>
<summary><strong>更喜欢在终端操作？</strong></summary>

步骤 1–2 也可以在会话之外用 Claude Code CLI 完成：
```bash
claude plugin marketplace add jarrodwatts/claude-hud
claude plugin install claude-hud@claude-hud
```
然后在会话内运行 `/reload-plugins`（或开启新会话）。

</details>

**步骤 3：配置状态栏**
```
/claude-hud:setup
```

<details>
<summary><strong>⚠️ Windows 用户：如果 setup 提示未找到 JavaScript 运行时，请点击此处</strong></summary>

在 Windows 上，Claude HUD setup 支持的运行时是 Node.js LTS。如果 setup 提示未找到 JavaScript 运行时，请先为你的 shell 安装 Node.js：
```powershell
winget install OpenJS.NodeJS.LTS
```
然后重启 shell 并再次运行 `/claude-hud:setup`。

</details>

完成！Claude Code 会自动重新加载设置——发送下一条消息后 HUD 就会出现，无需重启。如果没有显示，请重启 Claude Code（旧版 Claude Code 需要重启才能加载 statusLine 变更）。

---

## 什么是 Claude HUD？

Claude HUD 让你在 Claude Code 会话中获得更清晰的洞察。

| 你看到的内容 | 为什么重要 |
|--------------|------------|
| **项目路径** | 知道你当前在哪个项目中（可配置 1-3 级目录深度） |
| **上下文健康度** | 在上下文窗口满之前准确了解还剩多少 |
| **工具活动** | 实时观察 Claude 读取、编辑和搜索文件 |
| **Agent 追踪** | 查看哪些子 Agent 正在运行以及它们在做什么 |
| **待办进度** | 实时跟踪任务完成情况 |

## 显示效果

### 默认（2 行）
```
[Opus] │ my-project git:(main*)
上下文 █████░░░░░ 45% │ 使用率 ██░░░░░░░░ 25%（1小时30分 / 5小时）
```
- **第 1 行** — 模型、提供商标签（如能正面识别，例如 `Bedrock`、`Vertex`、`MiniMax`）、项目路径、git 分支
- **第 2 行** — 上下文进度条（绿 → 黄 → 红）和使用率限制

### 可选行（通过 `/claude-hud:configure` 启用）
```
◐ Edit: auth.ts | ✓ Read ×3 | ✓ Grep ×2        ← 工具活动
◐ explore [haiku]: 查找认证代码（2分15秒）       ← Agent 状态
▸ 修复认证漏洞（2/5）                             ← 待办进度
```

---

## 工作原理

Claude HUD 使用 Claude Code 原生的 **statusline API**——无需独立窗口，不需要 tmux，在任何终端都能工作。

```
Claude Code → stdin JSON → claude-hud → stdout → 在终端中显示
           ↘ transcript JSONL（工具、Agent、待办）
```

**核心特性：**
- 来自 Claude Code 的原生 Token 数据（非估算）
- 适配 Claude Code 报告的上下文窗口大小，包括最新的 1M 上下文会话
- 解析转录文件以获取工具/Agent 活动
- 在每次交互后重新渲染（新的助手消息、`/compact`、权限变更、vim 模式切换），带 300ms 防抖

---

## 配置

随时自定义你的 HUD：

```
/claude-hud:configure
```

引导式配置涵盖布局、语言和常用显示开关。高级选项如自定义颜色和阈值仍然保留，但你需要直接编辑配置文件来设置它们：

- **首次设置**：选择预设（完整/核心/极简），选择标签语言，然后微调各个元素
- **随时自定义**：开关各项、调整 Git 显示样式、切换布局或更改标签语言
- **保存前预览**：在提交更改前精确预览 HUD 的效果

### 预设

| 预设 | 显示内容 |
|------|----------|
| **完整（Full）** | 全部启用——工具、Agent、待办、Git、使用率、时长 |
| **核心（Essential）** | 活动行 + Git 状态，减少信息冗余 |
| **极简（Minimal）** | 仅核心——只有模型名称和上下文进度条 |

选择预设后，你可以单独开启或关闭各个元素。

### 手动配置

直接编辑 `~/.claude/plugins/claude-hud/config.json` 来配置高级选项，如 `colors.*`、`pathLevels`、`maxWidth`、阈值覆盖、`display.timeFormat`、`display.hourCycle` 以及 `display.promptCacheTtlSeconds`。运行 `/claude-hud:configure` 时会保留这些手动设置，同时你仍可更改 `language`、布局和常用引导式开关。

简体与繁体中文 HUD 标签均为显式 opt-in 选项。除非你在 `/claude-hud:configure` 中选择中文语言或在配置中设置 `language`，否则默认使用英文。`zh` 别名对应简体中文，`zh-TW` 对应繁体中文；引导式配置会写入规范值 `zh-Hans` 或 `zh-Hant`。

### 选项

| 选项 | 类型 | 默认值 | 说明 |
|------|------|--------|------|
| `language` | `en` \| `zh` \| `zh-Hans` \| `zh-Hant` \| `zh-TW` | `en` | HUD 标签语言。设为 `zh` 或 `zh-Hans` 启用简体中文，设为 `zh-Hant` 或 `zh-TW` 启用繁体中文 |
| `lineLayout` | string | `expanded` | 布局：`expanded`（多行）或 `compact`（单行） |
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
| `gitStatus.branchOverflow` | `truncate` \| `wrap` | `truncate` | 保持当前截断行为，或在可能时让 git 块以自己的换行边界单独换到下一行 |
| `jjStatus.enabled` | boolean | false | 显式启用 jj（Jujutsu）状态。启用后若找到真实的 `.jj` 目录，该仓库将显示 jj 而不是 git，二者不会同时运行 |
| `jjStatus.showDirty` | boolean | true | 当 jj 工作副本提交与其父提交不同时显示 `*` |
| `jjStatus.showConflicts` | boolean | true | 当 jj 工作副本提交包含未解决冲突时显示 `!conflict` |
| `display.showModel` | boolean | true | 显示模型名称 `[Opus]` |
| `display.modelSource` | `stdin` \| `auto` \| `transcript` | `stdin` | 控制模型名称来源。`stdin` 保持默认行为；`auto` 仅在 transcript 返回非 Claude 模型时切换，用于检测代理路由；`transcript` 始终使用 API 响应中的模型。Transcript 模型值会清理终端转义字符并截断为 80 个字符 |
| `display.showProvider` | boolean | false | 在模型名称*之前*显示提供商标签，例如 `[Bedrock \| Opus 4.6]`。自定义代理提供同名模型时有用。关闭时，自动检测的提供商仍跟在模型后面 |
| `display.providerName` | string | `""` | 与 `display.showProvider` 一起使用的显式提供商标签，例如无法自动检测的自定义代理。为空时回退到自动检测（Bedrock/Vertex/MiniMax/Enterprise）；上限 40 字符 |
| `display.showAddedDirs` | boolean | true | 显示来自 `/add-dir` 的额外工作区目录（如 `+sparkle +lib-foo`）；空数组不显示任何内容。在两种布局中最多渲染 5 个目录（溢出显示为 `+N more`），基名截断为 24 个字符并加 `…` |
| `display.addedDirsLayout` | `inline` \| `line` | `inline` | `inline` 将目录放在项目名称旁边，每个目录带 `+name` 前缀；`line` 在单独的 `Added dirs: name1, name2` 行渲染（无 `+` 前缀，逗号分隔） |
| `display.showContextBar` | boolean | true | 显示可视化上下文进度条 `████░░░░░░` |
| `display.contextValue` | `percent` \| `tokens` \| `remaining` \| `both` | `percent` | 上下文显示格式（`45%`、`45k/200k`、剩余 `55%` 或 `45% (45k/200k)`） |
| `display.autoCompactWindow` | number \| `null` | `null` | 设为正数（如 `200000`）时，按此自动压缩窗口而不是完整模型上下文窗口计算上下文百分比，以匹配 `/context`。留空或 `null` 保持默认全窗口行为 |
| `display.showConfigCounts` | boolean | false | 显示 CLAUDE.md、rules、MCPs、hooks 数量 |
| `display.showCost` | boolean | false | 使用 Claude Code 原生提供的 `cost.total_cost_usd` 显示会话费用（可用时），并附带本地估算回退方案 |
| `display.showRoutedCost` | boolean | false | 同时为路由提供商（Bedrock/Vertex）显示费用，`showCost` 默认将其隐藏。需同时开启 `showCost`。原生 `cost.total_cost_usd` 为正值时使用它（`Cost`），否则用 token 估算（`Est.`） |
| `display.showDailyCost` | boolean | false | 显示当天跨会话累计花费，格式为 `Today $12.34`，从原生 `cost.total_cost_usd` 写入插件数据目录中的按日账本。本地午夜重置。与 `showCost` 独立 |
| `display.showOutputStyle` | boolean | false | 从配置文件显示当前 Claude Code `outputStyle`，格式为 `style: <名称>` |
| `display.showDuration` | boolean | false | 显示会话时长 `⏱️ 5m` |
| `display.showSpeed` | boolean | false | 显示输出 Token 速度 `out: 42.1 tok/s` |
| `display.showUsage` | boolean | true | 显示 Claude 订阅用户的使用率限制（可用时） |
| `display.usageValue` | `percent` \| `remaining` | `percent` | 使用率显示格式（已使用 `25%`，或剩余 `75%`） |
| `display.usageBarEnabled` | boolean | true | 将使用率显示为可视化进度条而非文本 |
| `display.usageCompact` | boolean | false | 以较短的文本形式显示使用率，如 `5h: 25% (1h 30m)`；优先于 `display.usageBarEnabled` |
| `display.showResetLabel` | boolean | true | 在使用率倒计时前显示 `resets in` 前缀 |
| `display.showModelScopedUsage` | boolean | true | 显示按模型每周窗口（`model_scoped`，例如 Fable），无论其来自 stdin 还是外部用量快照。设为 `false` 后，使用率行的渲染效果等同于负载中本就没有这些窗口 |
| `display.timeFormat` | `relative` \| `absolute` \| `both` \| `elapsed` \| `elapsedAndAbsolute` | `relative` | 控制使用率窗口时间的显示方式：仅倒计时（`resets in 2h 30m`）、墙钟重置时间（`resets at 14:30`）、两者同时显示、窗口已过百分比（`53% elapsed`），或已过百分比加墙钟重置时间 |
| `display.hourCycle` | `auto` \| `h11` \| `h12` \| `h23` \| `h24` | `auto` | 墙钟重置时间（`absolute`/`both`/`elapsedAndAbsolute` 模式）的时制。`auto` 跟随系统区域设置；`h23` 强制使用 24 小时制（`14:30`），不受区域设置影响 |
| `display.showClockSeconds` | boolean | false | 在墙钟重置时间中显示秒数，如 `at 14:30:07` |
| `display.sevenDayThreshold` | 0-100 | 80 | 当 7 天使用率 ≥ 阈值时显示（0 = 始终显示） |
| `display.externalUsagePath` | string | `""` | 可选的本地使用率快照文件**绝对路径**。相对路径会被忽略。stdin `rate_limits` 存在时会附加 `balance_label`，并在 stdin 缺少 `model_scoped` 窗口时用快照补齐；stdin 窗口缺失时可整体作为回退 |
| `display.externalUsageWritePath` | string | `""` | 可选的绝对 `.json` 路径，父目录必须已存在。当 stdin `rate_limits` 存在时，ClaudeHUD 会写入私有权限快照供其他本地工具读取。相对路径、非 json 文件和缺失父目录会被忽略 |
| `display.externalUsageFreshnessMs` | number | `300000` | 外部使用率快照允许的最长存活时间，超时后会被忽略 |
| `display.showTokenBreakdown` | boolean | true | 在高上下文时（85%+）显示 Token 详情 |
| `display.showTools` | boolean | false | 显示工具活动行 |
| `display.showSkills` | boolean | false | 显示从 `Skill` 工具调用检测到的活动 Skills |
| `display.showMcp` | boolean | false | 显示从 `mcp__server__tool` 调用检测到的活动 MCP 服务器 |
| `display.toolNameMaxLength` | number | `0` | 工具名称最大显示长度。`0` 保留完整名称；截断 MCP 名称时可能缩短为最后一段 |
| `display.toolsMaxVisible` | number | `4` | 工具行最多显示的已完成工具数。`0` 表示不限制 |
| `display.showAgents` | boolean | false | 显示 Agent 活动行 |
| `display.showTodos` | boolean | false | 显示待办进度行 |
| `display.showSessionName` | boolean | false | 显示会话 slug 或 `/rename` 设置的自定义标题 |
| `display.showAuth` | boolean | false | 在第一行末尾显示当前登录的认证方式（订阅计划），例如 `Claude Max 20x`。来自 `{CLAUDE_CONFIG_DIR}.json` 的 `oauthAccount`；无 OAuth 但设置了 `ANTHROPIC_API_KEY` 时显示 `API Key` |
| `display.showAuthUser` | boolean | false | 在认证方式旁显示已登录账号（邮箱本地部分，回退到资料显示名） |
| `display.authUserLength` | number | `8` | 账号名截断前的最大字符数，超出以 `…` 截断。`0` 显示全名 |
| `display.showAdvisor` | boolean | false | 在 project 行内联显示 Claude Code `/advisor` 配置的顾问模型，例如 `Advisor: Opus 4.7`。来自 Claude Code 写入每条 assistant transcript 记录的 `advisorModel` 字段；渲染前会做控制字符/双向标记/ANSI 过滤并截断到 64 字符 |
| `display.advisorOverride` | string | `""` | 手动覆盖顾问显示文本。非空时优先于 transcript 检测，同样会做过滤和截断 |
| `display.showSessionStartDate` | boolean | false | 显示 transcript 会话开始时间戳 |
| `display.showLastResponseAt` | boolean | false | 显示最后一次 assistant 响应写入的时间距现在多久 |
| `display.showCompactions` | boolean | false | 显示本会话已发生的上下文压缩次数（手动 `/compact` 或自动压缩），从 transcript 的 `compact_boundary` 记录计数，例如 `压缩次数: 2`。第一次压缩前不显示 |
| `display.showEffortLevel` | boolean | false | 在模型徽章中显示当前推理力度。Ultracode 渲染为 `ultracode(xhigh)`，从会话 transcript 检测，因此能跟踪运行时的 `/effort` 变更 |
| `display.effortFormat` | `full` \| `symbol` \| `text` | `full` | `showEffortLevel` 开启时的渲染方式：符号加级别文本（`◑ high`）、仅符号（`◑`）、或仅级别文本（`high`）。`symbol` 下 Ultracode 仍保持完整的 `◕ ultracode(xhigh)`，以免丢失标记；没有已知符号的级别回退到级别文本 |
| `display.showClaudeCodeVersion` | boolean | false | 显示已安装的 Claude Code 版本，如 `CC v2.1.81` |
| `display.showMemoryUsage` | boolean | false | 在展开布局中显示近似系统 RAM 使用行 |
| `display.showPromptCache` | boolean | false | 显示 prompt cache 的过期时刻，数据来自 transcript |
| `display.promptCacheTtlSeconds` | number | `300` | 仅当 transcript 尚未报告 5 分钟或 1 小时缓存层级时使用的兼容回退值 |
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

`colors.barFilled` 和 `colors.barEmpty` 接受单个可见字素。控制字符、不可见格式字符（双向控制符、零宽连接符、变体选择符）、行/段落分隔符和非字符会被拒绝。宽字符（emoji、CJK）可能会影响进度条对齐，具体取决于终端。

支持的颜色名称：`dim`、`red`、`green`、`yellow`、`magenta`、`cyan`、`brightBlue`、`brightMagenta`。你也可以使用 256 色数字（`0-255`）或十六进制（`#rrggbb`）。

`display.showMemoryUsage` 为完全 opt-in 选项，仅在 `expanded` 布局下渲染。它报告本地机器的近似系统 RAM 使用情况，而非 Claude Code 或特定进程内的精确内存压力。由于可回收的 OS 缓存缓冲区仍可能被计入已用内存，该数字可能高估实际压力。

`display.showCost` 为完全 opt-in 选项。ClaudeHUD 优先使用 Claude Code 在 stdin 上提供的原生 `cost.total_cost_usd` 字段（可用时）。如果该字段缺失或对直连 Anthropic 会话无效，ClaudeHUD 会回退到现有的基于本地转录文件的估算方案，确保费用行在旧负载下仍能工作。原生字段在会话中首个 API 响应之前为空，因此费用显示可能在响应到达前保持隐藏。对于已知的路由提供商（如 Bedrock、Vertex AI），ClaudeHUD 也会隐藏费用显示，因为云提供商计费会话可能报告 `$0.00` 或省略该字段，即使会话并非真正免费。设置 `display.showRoutedCost: true`（并同时开启 `showCost`）即可为这些提供商启用费用显示：原生 `cost.total_cost_usd` 为正值时显示为 `Cost`，否则回退到基于 Anthropic 定价表的 token 估算 `Est.`。

官方 MiniMax Anthropic 兼容端点会显示 `MiniMax` 提供商标签。MiniMax M2.7 可使用其公开 token 和缓存价格进行本地估算；M3 的价格取决于单次请求的上下文层级，而累计会话 token 无法安全推断该层级，因此不会猜测 M3 费用。

`display.showPromptCache` 为完全 opt-in 选项。启用后，ClaudeHUD 会显示 **prompt cache 的过期时刻**（例如 `Cache ⏱ until 14:30`），过期后显示 `expired`。它与 HUD 中其他时刻一样遵循 `display.hourCycle` 和 `display.showClockSeconds`。如果 transcript 里还没有主会话响应，这个元素会继续隐藏。

它显示过期时刻而不是倒计时，因为状态栏只在 Claude Code 活动时重绘。在两个回合之间——正好是缓存流失的时候——倒计时会停在最后一次显示的数值上并继续报告它；而时刻无论渲染多陈旧都仍然正确。

ClaudeHUD 会尽可能从 transcript 检测缓存层级。对于不提供层级详情的旧版或代理 transcript，现有的 `display.promptCacheTtlSeconds` 设置仍作为回退值：

- **TTL 是检测出来的。** 每次缓存写入都会记录所用的层级（`usage.cache_creation.ephemeral_5m_input_tokens` 与 `ephemeral_1h_input_tokens`），因此 1 小时的会话按 1 小时计时，中途更换层级的会话也会被跟随。检测值优先于配置的回退值。
- **计时从请求开始**，而不是从它产生的响应开始，因为缓存是在请求时被读取或写入的。若以响应为基准，会把生成该响应所用的时间也算作可用时间。
- **忽略 subagent 响应。** subagent 使用自己的缓存，不会刷新主会话的缓存。

### 使用率限制

当 Claude Code 在 stdin 上提供订阅用户 `rate_limits` 数据时，使用率显示**默认启用**。它会在第 2 行与上下文进度条一起显示你的使用率消耗。

将 `display.usageValue` 设为 `remaining` 可显示剩余配额而非已使用配额。警告颜色和 7 天阈值检查仍使用底层的已使用百分比。

ClaudeHUD 优先使用官方 statusline stdin 负载中的使用率数据。如果 `rate_limits` 缺失，你可以通过 `display.externalUsagePath` 显式启用本地 sidecar 快照回退，例如让代理程序写入 JSON 文件。只要 stdin 和 sidecar 同时存在，stdin 始终优先。

回退快照必须足够新（由 `display.externalUsageFreshnessMs` 控制），并且包含有效的 `updated_at`、以及 `five_hour` 窗口、`seven_day` 窗口、`balance_label` 或 `model_scoped` 数组。`balance_label` 是预付费提供商余额的可选文本；显示前会进行裁剪、长度限制和清理。非法 JSON、过期文件或非法时间戳都会被静默忽略。

快照还可以携带 `model_scoped` 窗口，格式与 Claude Code 为 stdin 定义的 schema 相同（`display_name`、0-100 的 `utilization`、ISO 格式 `resets_at`），渲染方式与 stdin 提供的按模型窗口完全一致，且 stdin 自带 `model_scoped` 数据时始终优先。借此本地喂送程序可以显示 statusline 负载暂未包含的按模型每周配额（例如 Fable）：

```json
{
  "updated_at": "2026-07-24T14:12:37Z",
  "model_scoped": [
    { "display_name": "Fable", "utilization": 89, "resets_at": "2026-07-27T11:00:00Z" }
  ]
}
```

生成此类快照的一种零凭证方式是 Claude Code 自带的 `get_usage` 控制请求：它会返回 `rate_limits.model_scoped` 且不消耗任何 token，定时任务可将其经 `jq` 写入快照文件。HUD 本身从不发起任何请求，只读取该文件。

如果希望 ClaudeHUD 将官方 stdin `rate_limits` 写入本地快照供其他工具使用，可设置 `display.externalUsageWritePath`。该路径必须为绝对路径、以 `.json` 结尾，并位于已存在的目录中。ClaudeHUD 会使用私有权限写入该文件，并静默忽略无效路径。

免费/仅限每周账户会单独显示每周窗口，而不是显示幽灵 `5h: --` 占位符。

当 7 天使用率超过 `display.sevenDayThreshold`（默认 80%）时会显示：

```
上下文 █████░░░░░ 45% │ 使用率 ██░░░░░░░░ 25%（1小时30分 / 5小时）| ██████████ 85%（2天 / 7天）
```

如需禁用，请将 `display.showUsage` 设为 `false`。

重置时间默认显示为相对倒计时。将 `display.timeFormat` 设为 `absolute` 可显示墙钟时间，设为 `both` 可同时显示两种形式，设为 `elapsed` 可显示当前使用率窗口已过百分比，设为 `elapsedAndAbsolute` 可同时显示已过百分比和墙钟重置时间。该设置目前只能手动编辑；`/claude-hud:configure` 会保留它，但不会修改它。

墙钟重置时间（`absolute`/`both`/`elapsedAndAbsolute`）默认跟随系统区域设置决定 12/24 小时制。将 `display.hourCycle` 设为 `h23` 可强制使用 24 小时制，不受区域设置影响；设为 `h12`/`h11` 可强制使用带 AM/PM 的 12 小时制。将 `display.showClockSeconds` 设为 `true` 可在墙钟时间中显示秒数，如 `at 14:30:07`。

将 `display.showResetLabel` 设为 `false` 可使用较短的使用率倒计时格式，如 `(3h 17m)` 而非 `(resets in 3h 17m)`。

将 `display.usageCompact` 设为 `true` 可使用更短的使用率格式，如 `5h: 25% (1h 30m)`。紧凑模式优先于 `display.usageBarEnabled`。

将 `display.showModelScopedUsage` 设为 `false` 可隐藏按模型每周窗口（例如 Fable）。此后使用率行的渲染效果，与该账号本就没有这些窗口时完全一致：5h/7d 窗口保留，来自外部快照的窗口会与 stdin 的一并隐藏，且被隐藏的窗口不再计入已配置的使用率阈值，因此无法再单独让该行保持显示。

**前提条件：**
- Claude Code 必须在当前会话的 stdin 上包含订阅用户 `rate_limits` 数据
- 不适用于仅使用 API 密钥的用户

**故障排查：** 如果使用率不显示：
- 确保你已使用 Claude 订阅账户登录（而非 API 密钥）
- 检查配置中的 `display.showUsage` 未设为 `false`
- API 用户看不到使用率显示（他们按 Token 付费，没有使用率限制）
- AWS Bedrock 模型显示 `Bedrock` 并隐藏使用率限制（使用率由 AWS 管理）
- Bedrock 和 Vertex AI 模型默认隐藏费用估算（计费与 Anthropic 直连不同）；可通过 `display.showRoutedCost` 启用
- Claude Code 可能在会话中首个模型响应之前将 `rate_limits` 留空
- 某些 Claude Code 构建版本和订阅层级即使在首个响应之后仍可能省略 `rate_limits`
- 如果你配置了 `display.externalUsagePath`，ClaudeHUD 会先尝试读取该本地快照，再决定是否隐藏使用率
- ClaudeHUD 不会回退到凭据抓取或未记录的 API 调用

回退快照示例：

```json
{
  "updated_at": "2026-04-20T12:00:00.000Z",
  "five_hour": {
    "used_percentage": 42,
    "resets_at": "2026-04-20T15:00:00.000Z"
  },
  "seven_day": {
    "used_percentage": 84,
    "resets_at": "2026-04-27T12:00:00.000Z"
  }
}
```

### 配置示例

```json
{
  "language": "zh",
  "lineLayout": "expanded",
  "pathLevels": 2,
  "elementOrder": ["project", "tools", "context", "usage", "memory", "environment", "agents", "todos", "sessionTime"],
  "projectLineOrder": ["project", "model"],
  "gitStatus": {
    "enabled": true,
    "showDirty": true,
    "showAheadBehind": true,
    "showFileStats": true
  },
  "jjStatus": {
    "enabled": true,
    "showDirty": true,
    "showConflicts": true
  },
  "display": {
    "showTools": true,
    "showAgents": true,
    "showTodos": true,
    "showConfigCounts": true,
    "showDuration": true,
    "showMemoryUsage": true
  },
  "colors": {
    "context": "cyan",
    "usage": "cyan",
    "warning": "yellow",
    "usageWarning": "magenta",
    "critical": "red",
    "model": "cyan",
    "project": "yellow",
    "git": "magenta",
    "gitBranch": "cyan",
    "label": "dim",
    "custom": "#FF6600"
  }
}
```

### 显示示例

**1 级（默认）：** `[Opus] │ my-project git:(main)`

**2 级：** `[Opus] │ apps/my-project git:(main)`

**3 级：** `[Opus] │ dev/apps/my-project git:(main)`

**带脏状态指示器：** `[Opus] │ my-project git:(main*)`

**带领先/落后：** `[Opus] │ my-project git:(main ↑2 ↓1)`

**带文件统计：** `[Opus] │ my-project git:(main* !3 +1 ?2)`
- `!` = 修改的文件，`+` = 新增/暂存，`✘` = 删除，`?` = 未跟踪
- 计数为 0 的项会被省略，以保持显示整洁

### Jujutsu（jj）支持

将 `jjStatus.enabled` 设为 `true` 即可显式启用。启用后，如果在工作目录
或其父目录找到真实的 `.jj` 目录，HUD 会显示 jj 原生状态；即使 jj 与 git
共存，每次调用也只会选择其中一个。如果无法安全读取 jj，共存仓库会回退
到原有的 git 状态。

HUD 以适合提示符的只读方式运行 jj：禁用 pager、忽略实时工作副本，并从
当前 operation 读取状态，避免状态栏刷新时快照文件或修改仓库。因此，脏状态
标记反映的是 jj 最近一次工作副本快照；在另一条 jj 命令记录新更改之前，
它可能暂时滞后。

### 自动刷新

Claude Code 只在交互之后（新的助手消息、`/compact` 完成、权限模式变更、vim 模式切换）才会重新运行状态栏，因此与时间相关的 HUD 信息——会话时长、使用量重置倒计时、提示词缓存倒计时——在消息之间会停止更新。要让它们持续跳动，可以在 `~/.claude/settings.json` 的 `statusLine` 条目中添加 `refreshInterval`（秒，最小值 1）：

```json
{
  "statusLine": {
    "type": "command",
    "command": "...",
    "refreshInterval": 5
  }
}
```

`/claude-hud:setup` 会在安装时提供此选项。每次刷新都会重新运行 HUD 命令，因此推荐 5 秒；只有在需要平滑倒计时时才用 1 秒。

### 临时关闭 HUD

设置环境变量 `CLAUDE_HUD_DISABLE`，即可在本次会话中关闭 HUD，无需从 `settings.json` 中移除 `statusLine` 配置：

```bash
CLAUDE_HUD_DISABLE=1 claude
```

不设置（或设为明确的否定值：`0`、`false`、`off`、`no`）则保持 HUD 启用。关闭时 HUD 会立即退出，不读取会话记录、不执行 git 操作，状态栏在该会话中保持为空。

### 故障排查

**配置不生效？**
- 检查 JSON 语法错误：无效的 JSON 会静默回退到默认值
- 确保值有效：`pathLevels` 必须是 1、2、3 或 `full`；`lineLayout` 必须是 `expanded` 或 `compact`；`maxWidth` 必须是正数
- 删除配置文件并运行 `/claude-hud:configure` 重新生成

**Git 状态缺失？**
- 验证你是否在 git 仓库中
- 检查配置中的 `gitStatus.enabled` 不为 `false`

**jj 状态缺失，或 jj 仓库中仍显示 `git:(...)`？**
- 验证工作目录或其父目录存在 `.jj` 目录
- 在配置中将 `jjStatus.enabled` 设为 `true`（jj 支持默认不启用）
- 验证 `jj` 可执行文件已安装并位于 `PATH` 中

**工具/Agent/待办行缺失？**
- 这些默认隐藏——在配置中通过 `showTools`、`showAgents`、`showTodos` 启用
- 它们也仅在有活动可显示时才会出现

**HUD 设置后不显示？**
- 发送任意一条消息——设置会自动重新加载，但状态栏只在下一次交互后才会渲染
- 如果仍未出现，重启 Claude Code（完全退出并在终端中再次运行 `claude`）——旧版 Claude Code 需要重启才能加载 statusLine 变更
- 确认环境中没有设置 `CLAUDE_HUD_DISABLE`（例如从 shell 配置文件中导出）——它会让 HUD 完全静默，包括安装验证

---

## 运行环境要求

- Claude Code v1.0.80+
- macOS/Linux：Node.js 18+ 或 Bun
- Windows：Node.js 18+

---

## 开发

```bash
git clone https://github.com/jarrodwatts/claude-hud
cd claude-hud
npm ci && npm run build
npm test
```

详见 [CONTRIBUTING.md](CONTRIBUTING.md)。

---

## 许可证

MIT — 详见 [LICENSE](LICENSE)

---

## Star 历史

[![Star History Chart](https://api.star-history.com/svg?repos=jarrodwatts/claude-hud&type=Date)](https://star-history.com/#jarrodwatts/claude-hud&Date)
