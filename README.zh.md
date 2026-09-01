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
- **代码安全扫描（v1.2）**：配置扫描仓库（`scanRepos`）后，插件用内置/自定义**安全提示词**
  驱动扫描 worker（复用 DSH 模型）对克隆仓库做静态安全审计；同一位置（`file:line`+漏洞类型）
  的发现**只上报一次**（去重状态持久化到 `workRoot/scan-state.json`），新发现自动提交 issue。
  支持定时扫描（`scanEnabled` + `scanIntervalMs`）与手动触发（设置卡片「立即扫描」按钮或
  `POST /gitee-ai/scan`）。

## 环境要求

- DeepSeek Harness (dsh) 0.1.x，Windows（插件通过 PowerShell + `C:\Windows\System32\curl.exe`
  驱动 git 与 Gitee API），Gitee 账号及个人访问令牌。
- worker / scanner 预设在包内**自带并在首次加载时自动安装**到
  `$DSH_HOME/.agent-presets/gitee-worker`（`gitee-scanner` 同理），无需手动配置。

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
| `scanEnabled` | 是否启用定时代码安全扫描（对 `scanRepos`） |
| `scanRepos` | 扫描仓库，每行一个：`owner/repo` 或 `gitee:`/`github:` 前缀（格式同 `watchRepos`） |
| `scanMinSeverity` | 最低上报级别：`critical`/`high`/`medium`/`low`/`none`（默认 `medium`） |
| `scanOneIssuePerRun` | `true`=一次扫描新发现合并为一个 issue（默认）；`false`=每个发现一个 issue |
| `scanPrompts` | 安全提示词 `{id:{name,prompt}}`：覆盖内置（同 id）或新增自定义 id |
| `scanIntervalMs` | 定时扫描间隔（默认 21600000 = 6 小时） |
| `scanConcurrency` | 同时扫描的仓库数（1~8，默认 3）；仓库多时自动排队挨个持续扫描 |

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

## 代码安全扫描（v1.2）

1. 在插件配置卡片（或 `/gitee-ai/settings` 页面）填写 **扫描仓库**（每行一个
   `[gitee:|github:]owner/repo`），开启 **启用定时扫描**，或直接点 **立即扫描全部仓库**。
   点 **一键获取我的仓库** 会自动拉取当前账号有权限的仓库（自己的 + 所属组织的）填进
   输入框，再去掉不需要的、保存即可（等价接口 `GET /gitee-ai/my-repos`）。
2. 插件克隆仓库 → 用选中的安全提示词驱动扫描 worker 审计代码 → 结果写入
   `<repo>/.gitee-scan/result.json` → 与 `scan-state.json` 对比去重 → 把**新发现**提交 issue。

**多仓库排队（v1.2.0+）**：`scanRepos` 可以配任意多个仓库。定时 tick 会把全部仓库排进
队列，**同时最多扫描 `scanConcurrency` 个（默认 3，可设 1~8）**，扫完一个自动接下一个，
排着队把所有仓库持续扫完；重复扫描靠去重保持幂等，不会重复建 issue。

**内置提示词**（id：`general` / `sqli` / `xss` / `command-injection` / `path-traversal` /
`ssrf` / `hardcoded-secret` / `insecure-deserialization` / `authz` / `dos` / `dependency`）：

- 覆盖内置：`scanPrompts` 里用相同的 id 填自己的 `{name, prompt}`。
- 新增自定义：任意新 id；扫描时自定义提示词会与其他提示词一起发给 worker。

**去重规则**：发现按 `文件路径:行号:漏洞类型` 签名记录；已上报过的签名再次出现时跳过，
只建新发现对应的 issue。可用 `POST /gitee-ai/scan`（`dryRun=true` 预演不建 issue、
`force=true` 强制重新上报）手动控制。

**扫描状态**：`GET /gitee-ai/scan` 返回提示词清单、扫描任务与去重统计；历史记录在
`workRoot/scan-state.json`。扫描发现的 issue 标题带 `[安全扫描]` 前缀。

## 安全说明

- 用户配置持久化在**用户自身 profile 的 patch 层**；随包分发的 `cordis.patch.yml`
  只含空默认，绝不包含 token。
- token 在 schema 中标记为 secret，状态/配置接口只返回 `tokenConfigured` 布尔值，不回显明文。
- 插件与你 dsh 进程同权限运行；worker agent 仅在克隆的工作区内获得 `danger-full-access`。
- 扫描 worker 只做静态审计；硬编码密钥类发现只报告位置与类型，不回显密钥原文。

## 开发

- `dsh/index.js` — 宿主插件（标准 Cordis 对象插件，声明 `dsh.bundle` manifest）。
- `dsh/client.js` — Web 客户端半体（设置卡片/状态展示）。
- `preset/gitee-worker/` — 内置 worker agent 预设（issue 开发），首次加载缺失时自动复制到
  `$DSH_HOME/.agent-presets/gitee-worker`。
- `preset/gitee-scanner/` — 内置安全扫描 agent 预设（v1.2），自动安装到
  `$DSH_HOME/.agent-presets/gitee-scanner`。

## License

MIT
