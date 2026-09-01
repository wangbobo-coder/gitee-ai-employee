# Gitee AI 员工 (gitee-ai-employee)

An issue-driven AI developer for **DeepSeek Harness**, working against **Gitee (码云)** and **GitHub**.

Mention your bot in an issue, and the plugin clones the repository, dispatches an
AI **worker agent** to implement the change, pushes a branch, opens a Pull Request to the
branch you ask for, and can auto-merge and auto-close the issue. You can watch Gitee and
GitHub repositories at the same time.

> 中文说明见 [README.zh.md](README.zh.md)。

## What it does

- **Polling**: periodically scans the issues of the repositories you watch for a new
  mention of your bot (`@botName`). Dual platform: each watch row can be prefixed
  `gitee:` or `github:` (unprefixed rows use `defaultPlatform`, default `gitee`), so you can
  watch both platforms at once.
- **AI development**: creates a worker agent in a profile that clones the repo (via
  PowerShell + `curl` on Windows), explores it, implements the issue, runs checks, and
  commits on a `ai-fix/issue-<number>` branch.
- **Branch-aware**: it reads branch instructions written in natural language and uses that
  branch as both the development base and the PR target:
  - `需要修改 release-v1.2 分支` / `修改 X 分支` / `改 X 分支`
  - `基于 X 分支` / `在 X 分支上` / `以 X 分支为基础`
  - `合并到 X` / `合到 X` / `目标分支 X` / `base: X`
  The requested branch is validated against the remote with `git ls-remote`; if it does not
  exist, the plugin falls back to the repository default branch and says so in a comment.
- **PR & close**: pushes the branch, creates a PR (base = the chosen branch), optionally
  auto-merges it (`autoMerge`), and optionally closes the issue on success (`autoCloseIssue`).
- **Webhook / manual trigger**: optional webhook endpoint and a manual trigger URL for
  instant processing without waiting for the poll.
- **Security scanning (v1.2)**: configure scan repositories (`scanRepos`) and the plugin
  drives a scan worker (reusing the DSH model) through built-in/custom security prompts to
  statically audit the cloned code. Findings are **deduplicated** — the same spot
  (`file:line` + vulnerability type) is only reported once (dedup state persists at
  `workRoot/scan-state.json`) — and new findings are submitted as issues automatically.
  Supports scheduled scanning (`scanEnabled` + `scanIntervalMs`) and manual triggering
  (the "立即扫描" button in the settings card or `POST /gitee-ai/scan`).

## Requirements

- DeepSeek Harness (dsh) 0.1.x, Windows (the plugin drives `git` and the Gitee API through
  PowerShell + `C:\Windows\System32\curl.exe`), a Gitee account with a personal access token.
- The worker and scanner presets are **bundled and auto-installed** into
  `$DSH_HOME/.agent-presets/gitee-worker` (`gitee-scanner` likewise) on first load — no manual setup.

## Install

```sh
dsh plugin --profile <your-profile> add gitee-ai-employee
```

(or if you prefer installing straight from GitHub: `dsh plugin --profile <p> add github:wangbobo-coder/gitee-ai-employee`)

Restart dsh, then open **Settings → Plugins → Plugin configuration**, find the
**Gitee AI 员工** card and configure:

| Setting | Meaning |
| --- | --- |
| `giteeToken` | Gitee personal access token (kept secret; never returned by the status API) |
| `githubToken` | GitHub personal access token, optional (kept secret; only needed for `github:` repos) |
| `defaultPlatform` | Platform for unprefixed `watchRepos` rows: `gitee` (default) or `github` |
| `botName` | The account/issues mention that triggers the bot, e.g. `gitee-ai`. ASCII is recommended. |
| `workRoot` | Where repositories are cloned; empty = `$DSH_HOME/gitee-workers` |
| `watchRepos` | Repos to poll, one per line: `owner/repo` (uses `defaultPlatform`) or `gitee:owner/repo` / `github:owner/repo` |
| `pollEnabled` / `pollIntervalMs` | Poll on/off and interval (milliseconds) |
| `autoMerge` | Auto-merge the created PR |
| `autoCloseIssue` | Close the issue once the task succeeds |
| `workerPreset` | Agent preset id used for the worker (default `gitee-worker`) |
| `scanEnabled` | Enable scheduled security scanning of `scanRepos` |
| `scanRepos` | Repos to scan, one per line: `owner/repo` with optional `gitee:`/`github:` prefix |
| `scanMinSeverity` | Minimum severity to report: `critical`/`high`/`medium`/`low`/`none` (default `medium`) |
| `scanOneIssuePerRun` | `true` = one consolidated issue per run (default); `false` = one issue per finding |
| `scanPrompts` | Custom/override prompts `{id:{name,prompt}}` (same id overrides a built-in) |
| `scanIntervalMs` | Scheduled scan interval (default 21600000 = 6 h) |
| `scanConcurrency` | Max repos scanned in parallel (1–8, default 3); a long `scanRepos` list queues up and keeps scanning until every repo is done |

## Usage

1. Make sure `pollEnabled` is on (or use the manual trigger URL shown in the status API).
2. Open (or edit) an issue in a watched repo and mention your bot:
   ```
   @gitee-ai
   需要修改 release-v1.2 分支
   参会人员选择增加学生选项，注意回显处理。
   ```
3. The plugin picks it up (usually within one poll interval), comments "已接单", runs the
   worker, and later posts the result with the PR link. With `autoCloseIssue` on, the issue
   is closed on success.

For GitHub repos the same flow applies — just configure `githubToken` and add the repo as
`github:owner/repo` in `watchRepos` (or set `defaultPlatform` to `github`). For one-off runs
you can also trigger directly:

```
http://<dsh-host>:<port>/gitee-ai/go?platform=github&owner=octo&repo=hello&number=5
```

> The bot name match uses a lookahead (`(?![A-Za-z0-9_])`) so both ASCII and CJK bot names
> trigger correctly.

## Security scanning (v1.2)

1. In the plugin config card (or `/gitee-ai/settings`), fill **扫描仓库** with one
   `[gitee:|github:]owner/repo` per line, enable **启用定时扫描**, or click **立即扫描全部仓库**.
   Click **一键获取我的仓库** to auto-fill every repo you can access (own + org memberships)
   so you can keep/remove entries before saving (equivalent API: `GET /gitee-ai/my-repos`).
2. The plugin clones the repo → runs the scan worker with the selected security prompts →
   results land at `<repo>/.gitee-scan/result.json` → findings are diffed against
   `scan-state.json` → **new** findings are submitted as an issue.

**Built-in prompt ids**: `general` / `sqli` / `xss` / `command-injection` / `path-traversal` /
`ssrf` / `hardcoded-secret` / `insecure-deserialization` / `authz` / `dos` / `dependency`.

- Override a built-in by using the same id in `scanPrompts`; add custom ids for new checks.
- Dedup signature is `file:line:vulnType`; already-reported signatures are skipped.
- `POST /gitee-ai/scan` accepts `dryRun=true` (preview, no issue) and `force=true` (re-report).
- `GET /gitee-ai/scan` returns the prompt catalog, scan jobs and dedup stats.
- Scan issues are titled with a `[安全扫描]` prefix.

## Security notes

- User configuration is persisted to the **user's own profile patch layer**; the shipped
  `cordis.patch.yml` contains only an empty default and never a token.
- The token is marked secret in the schema and is never echoed by the status/config API
  (only a `tokenConfigured` boolean).
- The plugin runs with the same privileges as your dsh process; its worker agent gets
  `danger-full-access` inside the cloned workspace only.
- The scan worker is read-only static analysis; hardcoded-secret findings report type and
  location only, never the secret value.

## Development

- `dsh/index.js` — host plugin (Cordis object plugin with `dsh.bundle` manifest).
- `dsh/client.js` — web client half (settings card hover/status).
- `preset/gitee-worker/` — the bundled worker agent preset, auto-copied to
  `$DSH_HOME/.agent-presets/gitee-worker` on load if missing.

## License

MIT
