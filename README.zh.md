# Gitee AI 员工 (gitee-ai-employee)

面向 **DeepSeek Harness** 的 issue 驱动型 AI 开发者，支持 **Gitee（码云）** 与 **GitHub**。

在 issue 里 @ 你的机器人，插件就会克隆仓库、派出 AI **worker agent** 实现改动、
推送分支、按你指定的分支创建 Pull Request，并可按需自动合并、自动关闭 issue。
Gitee 与 GitHub 仓库可以同时监听。

## 功能

- **轮询**：定时扫描你监听的仓库里新出现 `@botName` 的 issue。**双平台**：每个监听行可加
  `gitee:` / `github:` 前缀（无前缀按 `defaultPlatform`，默认 gitee），两种平台可混用。
- **AI 开发**：创建 worker agent（Windows 下经 PowerShell + curl 克隆仓库），探索代码、
  实现需求、跑校验、在 `ai-fix/issue-<number>` 分支上提交。
- **分支感知**：会读取 issue 里用自然语言指定的分支，作为开发基准和 PR 目标：
  - `需要修改 release-v1.2 分支` / `修改 X 分支` / `改 X 分支`
  - `基于 X 分支` / `在 X 分支上` / `以 X 分支为基础`
  - `合并到 X` / `合到 X` / `目标分支 X` / `base: X`
  指定分支会用 `git ls-remote` 校验远端存在性；不存在则退回仓库默认分支并在评论中说明。
- **PR 与关闭**：推送分支、创建 PR（base = 所选分支），可按需自动合并（`autoMerge`）、
  成功后自动关闭 issue（`autoCloseIssue`）。
- **Webhook / 手动触发**：可选 webhook 端点与手动触发 URL，无需等轮询即时处理。

## 环境要求

- DeepSeek Harness (dsh) 0.1.x，Windows（插件通过 PowerShell + `C:\Windows\System32\curl.exe`
  驱动 git 与 Gitee API），Gitee 账号及个人访问令牌。
- worker 预设在包内**自带并在首次加载时自动安装**到 `$DSH_HOME/.agent-presets/gitee-worker`，
  无需手动配置。

## 安装

```sh
dsh plugin --profile <你的-profile> add gitee-ai-employee
```

（或直接从 GitHub 安装：`dsh plugin --profile <p> add github:wangbobo-coder/gitee-ai-employee`）

重启 dsh 后，打开 **设置 → 插件 → 插件配置**，找到 **Gitee AI 员工** 卡片进行配置：

| 配置项 | 说明 |
| --- | --- |
| `giteeToken` | Gitee 个人访问令牌（标记为 secret，状态接口不回显） |
| `githubToken` | GitHub 个人访问令牌，可选（标记为 secret；仅当监听 `github:` 仓库时必填） |
| `defaultPlatform` | 无前缀 watchRepos 行所属平台：`gitee`（默认）或 `github` |
| `botName` | 触发机器人的账号，如 `gitee-ai`。建议使用 ASCII 名称。 |
| `workRoot` | 仓库克隆目录；留空 = `$DSH_HOME/gitee-workers` |
| `watchRepos` | 监听仓库，每行一个：`owner/repo`（按 defaultPlatform）或 `gitee:owner/repo` / `github:owner/repo` |
| `pollEnabled` / `pollIntervalMs` | 是否轮询 / 轮询间隔（毫秒） |
| `autoMerge` | 是否自动合并创建的 PR |
| `autoCloseIssue` | 任务成功后是否自动关闭 issue |
| `workerPreset` | worker 使用的 agent 预设 id（默认 `gitee-worker`） |

## 使用

1. 打开 `pollEnabled`（或使用状态接口给出的手动触发 URL）。
2. 在监听的仓库里新建/编辑 issue 并 @ 机器人：
   ```
   @gitee-ai
   需要修改 release-v1.2 分支
   参会人员选择增加学生选项，注意回显处理。
   ```
3. 插件会在一个轮询周期内接单（评论“已接单”），运行 worker，最后回帖结果与 PR 链接；
   开启 `autoCloseIssue` 时成功后自动关闭 issue。

GitHub 同理：配置 `githubToken` 后在 `watchRepos` 里写 `github:owner/repo`（或把
`defaultPlatform` 设为 `github`）。也可以直接手动触发单个任务：

```
http://<dsh-host>:<port>/gitee-ai/go?platform=github&owner=octo&repo=hello&number=5
```

> 机器人匹配使用前瞻断言（`(?![A-Za-z0-9_])`），ASCII 与中文 botName 都能正确触发。

## 安全说明

- 用户配置持久化在**用户自身 profile 的 patch 层**；随包分发的 `cordis.patch.yml`
  只含空默认，绝不包含 token。
- token 在 schema 中标记为 secret，状态/配置接口只返回 `tokenConfigured` 布尔值，不回显明文。
- 插件与你 dsh 进程同权限运行；worker agent 仅在克隆的工作区内获得 `danger-full-access`。

## 开发

- `dsh/index.js` — 宿主插件（标准 Cordis 对象插件，声明 `dsh.bundle` manifest）。
- `dsh/client.js` — Web 客户端半体（设置卡片/状态展示）。
- `preset/gitee-worker/` — 内置 worker agent 预设，首次加载缺失时自动复制到
  `$DSH_HOME/.agent-presets/gitee-worker`。

## License

MIT
