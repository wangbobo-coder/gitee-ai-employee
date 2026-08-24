# Gitee AI 员工 (gitee-ai-employee)

An issue-driven AI developer for **DeepSeek Harness**, working against **Gitee (码云)**.

Mention your bot in a Gitee issue, and the plugin clones the repository, dispatches an
AI **worker agent** to implement the change, pushes a branch, opens a Pull Request to the
branch you ask for, and can auto-merge and auto-close the issue.

> 中文说明见 [README.zh.md](README.zh.md)。

## What it does

- **Polling**: periodically scans the Gitee issues of the repositories you watch for a new
  mention of your bot (`@botName`).
- **AI development**: creates a worker agent in a profile that clones the repo (via
  PowerShell + `curl` on Windows), explores it, implements the issue, runs checks, and
  commits on a `ai-fix/issue-<number>` branch.
- **Branch-aware**: it reads branch instructions written in natural language and uses that
  branch as both the development base and the PR target:
  - `需要修改 master-sctbc 分支` / `修改 X 分支` / `改 X 分支`
  - `基于 X 分支` / `在 X 分支上` / `以 X 分支为基础`
  - `合并到 X` / `合到 X` / `目标分支 X` / `base: X`
  The requested branch is validated against the remote with `git ls-remote`; if it does not
  exist, the plugin falls back to the repository default branch and says so in a comment.
- **PR & close**: pushes the branch, creates a PR (base = the chosen branch), optionally
  auto-merges it (`autoMerge`), and optionally closes the issue on success (`autoCloseIssue`).
- **Webhook / manual trigger**: optional webhook endpoint and a manual trigger URL for
  instant processing without waiting for the poll.

## Requirements

- DeepSeek Harness (dsh) 0.1.x, Windows (the plugin drives `git` and the Gitee API through
  PowerShell + `C:\Windows\System32\curl.exe`), a Gitee account with a personal access token.
- The worker preset is **bundled and auto-installed** into `$DSH_HOME/.agent-presets/gitee-worker`
  on first load — no manual setup.

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
| `botName` | The account/issues mention that triggers the bot, e.g. `gitee-ai`. ASCII is recommended. |
| `workRoot` | Where repositories are cloned; empty = `$DSH_HOME/gitee-workers` |
| `watchRepos` | Repos to poll, one `owner/repo` per line |
| `pollEnabled` / `pollIntervalMs` | Poll on/off and interval (milliseconds) |
| `autoMerge` | Auto-merge the created PR |
| `autoCloseIssue` | Close the issue once the task succeeds |
| `workerPreset` | Agent preset id used for the worker (default `gitee-worker`) |

## Usage

1. Make sure `pollEnabled` is on (or use the manual trigger URL shown in the status API).
2. Open (or edit) an issue in a watched repo and mention your bot:
   ```
   @gitee-ai
   需要修改 master-sctbc 分支
   参会人员选择增加学生选项，注意回显处理。
   ```
3. The plugin picks it up (usually within one poll interval), comments "已接单", runs the
   worker, and later posts the result with the PR link. With `autoCloseIssue` on, the issue
   is closed on success.

> The bot name match uses a lookahead (`(?![A-Za-z0-9_])`) so both ASCII and CJK bot names
> trigger correctly.

## Security notes

- User configuration is persisted to the **user's own profile patch layer**; the shipped
  `cordis.patch.yml` contains only an empty default and never a token.
- The token is marked secret in the schema and is never echoed by the status/config API
  (only a `tokenConfigured` boolean).
- The plugin runs with the same privileges as your dsh process; its worker agent gets
  `danger-full-access` inside the cloned workspace only.

## Development

- `dsh/index.js` — host plugin (Cordis object plugin with `dsh.bundle` manifest).
- `dsh/client.js` — web client half (settings card hover/status).
- `preset/gitee-worker/` — the bundled worker agent preset, auto-copied to
  `$DSH_HOME/.agent-presets/gitee-worker` on load if missing.

## License

MIT
