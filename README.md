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
  `$DSH_HOME/.agent-presets/gitee-worker` on load if missing (refreshed when the
  bundled copy differs from the one already on disk).
- `preset/gitee-scanner/` — the bundled security-scan agent preset (v1.2).

## DSH compatibility (v1.3.1)

v1.3.1 fixes "plugin loads fine but every worker/scan fails" on DSH 0.2.x. All three are
follow-ups to host API changes:

- **shell execution**: 0.2.x dropped `shell.run()`; use
  `shell.execute(shell.resolve(req)).result()`. The old code threw
  `shell.run is not a function`.
- **agent preset registration**: 0.2.x `agentPresets` only honours an explicit
  `register(definition)` and no longer scans `$DSH_HOME/.agent-presets`; the old code threw
  `Unknown agent preset: gitee-scanner`. The plugin now both registers in code and writes
  the preset directory (compatibility with older builds).
- **persona config field**: `@deepseek-ai/dsh-persona` takes its body as `prefix`
  (required), not `text`; `text` threw `$.prefix missing required value`.

After upgrading, **restart the DSH process**. The plugin is installed as an npm package and
a running process never re-imports new code from disk — toggling the plugin on/off is not
enough.

## Secrets are no longer written to the patch (v1.3.2)

Before v1.3.2, saving the settings page serialized the *whole* config — tokens included —
into `cordis.patch.yml` inside the installed package. That put a plaintext Gitee token in a
file that is copied around with the package and can end up in a repository.

From v1.3.2 the secret fields (`giteeToken`, `githubToken`, `webhookSecret`) are handled by
the host credentials service instead:

- **Storage**: the value lives in `$DSH_HOME/.credentials.yaml` (owner-only, written by
  DSH), under the refs `GITEE_TOKEN`, `GITHUB_TOKEN`, `GITEE_WEBHOOK_SECRET`.
- **On load**: the plugin resolves those refs, so an env var of the same name also works —
  the provider store wins, the environment is the fallback.
- **On save**: the patch always receives an empty string for these fields. The patch stays
  safe to copy, commit, and ship.

If the credentials service is unavailable (a minimal host without it), the plugin still
works but keeps secrets in memory only — they must be re-entered after a restart, and it
logs a warning saying so.

Existing installs: after upgrading, re-enter the token once in the settings page (or set
`GITEE_TOKEN` in the environment). The old plaintext value in the patch is blanked on the
next save; if you want it gone immediately, edit the patch and set the field to `""`.

Also part of v1.3.2:

- `summarizeAgent` reads events through `session.snapshotEvents(fromSeq)` — 0.2.x sessions
  no longer expose an iterable `events` array, which made every scan report
  `agent.session.events is not iterable`.
- The bundled persona no longer uses `{{cwd}}`. Only `{{provider}}` and `{{model}}` are
  registered prompt variables in 0.2.x; anything else throws
  `unknown prompt variable "{{cwd}}"`.
- `ensurePreset` overwrites a stale on-disk preset instead of treating its presence as
  "already up to date".

## License

MIT
