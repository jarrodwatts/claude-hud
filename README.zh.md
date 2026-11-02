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
/hud
```

`/hud` 会检查你的环境，并在征得你同意后把状态栏指向 HUD。它需要 Node.js 22.18 或更高版本；如果你的版本较旧，`/hud` 会在你的机器上找到更新的版本，或帮你安装一个。

<details>
<summary><strong>更喜欢用终端？</strong></summary>

```bash
claude plugin marketplace add jarrodwatts/claude-hud
claude plugin install claude-hud@claude-hud
```

然后在会话中运行 `/reload-plugins` 和 `/hud`。

</details>

**更新：** 默认情况下，Claude Code 不会自动更新第三方插件。要开启自动更新，运行 `/plugin`，打开 **Marketplaces**，选择 **claude-hud**，然后选择 **Enable auto-update**。也可以手动运行 `claude plugin marketplace update claude-hud` 和 `claude plugin update claude-hud@claude-hud`，然后运行 `/reload-plugins`。无需重新设置。

## 显示效果

默认显示两行：

```
[Opus] │ my-project git:(main*)
Context █████░░░░░ 45% │ Usage ██░░░░░░░░ 25% (resets in 1h 30m)
```

- **第 1 行**：模型、检测到时的提供商标签（`Bedrock`、`Vertex`、`MiniMax`）、项目路径和 git 分支。
- **第 2 行**：上下文用量（随占用依次变为绿、黄、红）以及订阅用户的使用率限制。

可选行包括工具、子代理和待办，此外还有大约一百个选项：

```
◐ Edit: auth.ts | ✓ Read ×3 | ✓ Grep ×2        ← 工具
◐ explore [haiku]: Finding auth code (2m 15s)    ← 子代理
▸ Fix authentication bug (2/5)                   ← 待办
```

## 修改、修复与反馈

直接告诉 Claude，或输入 `/hud` 并说明你想要什么：“显示工具活动”、“使用紧凑布局”、“HUD 是空白的”、“上下文条看起来不对”。Claude 会查找相关选项，给你看预览，并在你同意后保存修改。`/hud` 还可以撤销上一次修改，重放最近一次真实渲染来解释你看到的内容；如果确实是 bug，它会生成一份脱敏报告，你完整读过之后才会提交。

设置保存在 `~/.claude/plugins/claude-hud/config.json`（如设置了 `$CLAUDE_CONFIG_DIR` 则在其下）。要在某个会话中关闭 HUD，用 `CLAUDE_HUD_DISABLE=1` 启动 Claude Code。

## 安全

HUD 的逻辑运行在一个被锁定的 Node 进程中。Node 的权限模型阻止它启动程序、读取你的凭据，以及写入它自己数据目录以外的任何位置。导入围栏让它拿不到 Node 的网络模块和网络全局对象；这道围栏挡住了目前发现的每一种逃逸方式，每次改动都会逐一测试。一个单独的小文件负责运行它所需的固定 `git`、`jj` 和内存命令。HUD 读取 Claude Code 的 stdin、会话 transcript、Claude 配置文件以及当前目录的 git 或 jj 元数据，不调用未公开的 API。

`--extra-cmd` 会在每次刷新时运行一条 shell 命令，并把输出显示在第一行。除非 HUD 的环境中设置了 `CLAUDE_HUD_ALLOW_EXTRA_CMD=1`，否则它会被忽略。请把它视为任意代码执行，切勿使用来源不可信的命令。

## 运行环境要求

- Claude Code v2.1.260 或更高版本
- Node.js 22.18 或更高版本（Bun 可以启动 HUD，HUD 随后在 Node 上运行）

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
