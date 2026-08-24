// ============================================================================
// Gitee AI 员工 (gitee-ai-employee) —— 标准 Cordis bundle 插件（host 半边）
// ----------------------------------------------------------------------------
// 以标准 bundle 组合包形式承载，可通过 dsh plugin add 安装：
//   轮询 @botName 的 Gitee / GitHub issue → 派发 worker agent 在克隆的仓库里
//   开发 → 推送分支 → 创建 PR → 自动合并（若允许）→ 自动关闭 issue。
//   支持「基于/修改 X 分支」等自然语言指定目标分支（PR 打到指定分支）。
//   watchRepos 每行可带平台前缀：[gitee:|github:]owner/repo，无前缀按
//   config.defaultPlatform（默认 gitee）判定；两平台可混用。
//
// 分发形态：公开 npm 包 + GitHub 仓库（wangbobo-coder/gitee-ai-employee）。
// 配置来自 patch 行的 config 字段；用户配置保存在用户自身 profile/patch 层，
// 本包内置 cordis.patch.yml 只含空默认，绝不携带任何隐私信息。
// 公开版默认路径按运行环境推导（$DSH_HOME），不写死机器路径。
// ============================================================================

import { Service } from "@deepseek-ai/cordis";
import z from "@deepseek-ai/schemastery";
import yaml from "yaml";
import { readFileSync, writeFileSync, existsSync, mkdirSync, copyFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { tmpdir, homedir } from "node:os";
import { join } from "node:path";

const DEFAULT_CONFIG = {
  giteeToken: "",
  githubToken: "",
  botName: "dsh-ai-employee",
  webhookPath: "/gitee-ai-webhook",
  webhookSecret: "",
  // 工作目录/临时目录默认为空：apply 时按运行环境推导（$DSH_HOME/.gitee-workers、系统 tmp），
  // 不再写死任何机器路径，保证包可分发到任意机器。
  workRoot: "",
  workerPreset: "gitee-worker",
  autoMerge: true,
  autoCloseIssue: true,
  gitAuthorName: "Gitee AI Employee",
  gitAuthorEmail: "ai-employee@localhost",
  taskTimeoutMs: 1800000,
  pollEnabled: false,
  pollIntervalMs: 60000,
  watchRepos: [],
  // watchRepos 无平台前缀的行默认所属平台："gitee" | "github"
  defaultPlatform: "gitee",
  tmpDir: "",
  gitUser: "",
};

// Cordis 4 原生 host 插件形态：对象插件 { Config, inject, apply }。
// 不要用 class + apply：类插件只调用实例的 [Symbol.for("cordis.init")]，
// 普通类的 apply 永远不会被执行（这是 DSH 动态插件与原生插件的关键差异）。
const GITEE_CONFIG_SCHEMA = z.object({
    giteeToken: z.string().default(DEFAULT_CONFIG.giteeToken).role("secret"),
    githubToken: z.string().default(DEFAULT_CONFIG.githubToken).role("secret"),
    botName: z.string().default(DEFAULT_CONFIG.botName),
    webhookPath: z.string().default(DEFAULT_CONFIG.webhookPath),
    webhookSecret: z.string().default(DEFAULT_CONFIG.webhookSecret),
    workRoot: z.string().default(DEFAULT_CONFIG.workRoot),
    workerPreset: z.string().default(DEFAULT_CONFIG.workerPreset),
    autoMerge: z.boolean().default(DEFAULT_CONFIG.autoMerge),
    autoCloseIssue: z.boolean().default(DEFAULT_CONFIG.autoCloseIssue),
    gitAuthorName: z.string().default(DEFAULT_CONFIG.gitAuthorName),
    gitAuthorEmail: z.string().default(DEFAULT_CONFIG.gitAuthorEmail),
    taskTimeoutMs: z.number().default(DEFAULT_CONFIG.taskTimeoutMs),
    pollEnabled: z.boolean().default(DEFAULT_CONFIG.pollEnabled),
    pollIntervalMs: z.number().default(DEFAULT_CONFIG.pollIntervalMs),
    watchRepos: z.array(z.string()).default([]),
    defaultPlatform: z.string().default(DEFAULT_CONFIG.defaultPlatform),
    tmpDir: z.string().default(DEFAULT_CONFIG.tmpDir),
    gitUser: z.string().default(""),
});

export default {
  Config: GITEE_CONFIG_SCHEMA,

  // 硬依赖声明：Cordis 会等这些服务全部提供后才 apply 本插件。
  // composition 插件在 DSH boot 早期加载，agents/agentPresets/shell/timer
  // 是核心；webServer / agentDefaultModel / settings 作为可选服务用
  // ctx.get() 兜底读取（缺失时相应能力自动降级，插件仍可加载）。
  inject: ["agents", "agentPresets", "shell", "timer"],

  apply(ctx, rawConfig) {
    // runtime.callback(ctx, config)：配置作为第二个参数传入（不是 ctx.config）
    const config = { ...DEFAULT_CONFIG, ...(rawConfig || ctx.config || {}) };
    // ── 可移植默认：未显式配置时按运行环境推导，不写死机器路径 ──
    const dshHome = process.env.DSH_HOME ? process.env.DSH_HOME : join(homedir(), ".dsh");
    if (!config.workRoot) {
      config.workRoot = join(dshHome, "gitee-workers");
      console.log("[gitee-ai] workRoot default -> " + config.workRoot);
    }
    if (!config.tmpDir) config.tmpDir = tmpdir();
    const agents = ctx.agents;
    const agentDefaultModel = ctx.get("agentDefaultModel");
    const agentPresets = ctx.agentPresets;
    const webServer = ctx.get("webServer");
    const shell = ctx.shell;
    const timer = ctx.timer;
    console.log("[gitee-ai] apply(composition) services ok: agents/shell/timer available; webServer=" + (webServer ? "yes" : "no") + " agentDefaultModel=" + (agentDefaultModel ? "yes" : "no"));
    ensureWorkerPreset();

    // ── 宿主 settings 命名空间注册（关键：让「设置 → 插件 → 插件配置」页显示本插件卡片）──
    // 该页只渲染「宿主 serve 的命名空间」对应的 settings.plugin.item 卡片，且要求
    // 卡片 key === 命名空间（gitee-ai-employee）。不注册命名空间，卡片即使已注册也
    // 永远不会被该页派发 —— 旧版桌面端有另一种列表机制，故当时能显示、这里不能。
    ctx.inject(["settings"], (sctx) => {
      try {
        sctx.settings.register("gitee-ai-employee", GITEE_CONFIG_SCHEMA, { base: { ...config } });
        console.log("[gitee-ai] settings namespace 'gitee-ai-employee' registered (settings card enabled)");
      } catch (error) {
        console.error("[gitee-ai] settings namespace register failed:", String(error && error.message ? error.message : error));
      }
    });

    const jobs = new Map();
    const active = new Set();
    const handledKeys = new Set();
    let seqCounter = 0;
    const uniqId = () =>
      "gitee-" + Date.now().toString(36) + "-" + (++seqCounter).toString(36) + "-" + Math.random().toString(36).slice(2, 8);

    function tokenOk() {
      return typeof config.giteeToken === "string" && config.giteeToken.trim() !== "";
    }

    // ── 自包含 worker 预设：把包内 preset 落盘到 $DSH_HOME/.agent-presets ──
    // 保证安装本插件的用户无需手动复制 preset，开箱即可用。
    function ensureWorkerPreset() {
      try {
        const presetId = config.workerPreset || "gitee-worker";
        const presetDir = join(process.env.DSH_HOME || join(homedir(), ".dsh"), ".agent-presets", presetId);
        const target = join(presetDir, "agent.cordis.yml");
        if (existsSync(target)) {
          console.log("[gitee-ai] worker preset already present: " + presetDir);
          return;
        }
        const src = fileURLToPath(new URL("../preset/" + presetId + "/agent.cordis.yml", import.meta.url));
        if (!existsSync(src)) {
          console.error("[gitee-ai] bundled worker preset missing: " + src);
          return;
        }
        mkdirSync(presetDir, { recursive: true });
        copyFileSync(src, target);
        const srcMeta = fileURLToPath(new URL("../preset/" + presetId + "/preset.yml", import.meta.url));
        if (existsSync(srcMeta)) copyFileSync(srcMeta, join(presetDir, "preset.yml"));
        console.log("[gitee-ai] worker preset installed -> " + presetDir);
      } catch (e) {
        console.error("[gitee-ai] ensureWorkerPreset error:", String((e && e.message) || e));
      }
    }

    async function sh(command, opts = {}) {
      const { workdir, timeoutMs = 120000 } = opts;
      const spec = shell.resolve({
        command,
        ...(workdir ? { workdir } : {}),
        ...(timeoutMs ? { timeoutMs } : {}),
        sandboxPolicy: { mode: "danger-full-access" },
      });
      return await shell.run(spec);
    }

    function parseForm(raw) {
      const out = {};
      const parts = String(raw).split("&");
      for (const part of parts) {
        if (!part) continue;
        const eq = part.indexOf("=");
        const k = eq < 0 ? part : part.slice(0, eq);
        const v = eq < 0 ? "" : part.slice(eq + 1);
        try { out[decodeURIComponent(k)] = decodeURIComponent(v); } catch (e) { out[k] = v; }
      }
      return out;
    }

    // ── 平台 API：Gitee / GitHub，Authorization: token 头认证 ──────────────
    function platformInfo(platform) {
      const g = platform === "github";
      return {
        base: g ? "https://api.github.com" : "https://gitee.com/api/v5",
        token: g ? config.githubToken : config.giteeToken,
      };
    }
    function tokenOkFor(platform) {
      const info = platformInfo(platform);
      return typeof info.token === "string" && info.token.trim() !== "";
    }
    function normPlatform(p) {
      const s = String(p || "").toLowerCase().trim();
      return s === "github" ? "github" : "gitee";
    }

    // watchRepos 行格式："github:owner/repo" / "gitee:owner/repo" / 无前缀按
    // config.defaultPlatform 判定。
    function parseRepoSpec(spec) {
      const s = String(spec || "").trim();
      let platform = normPlatform(config.defaultPlatform || "gitee");
      let rest = s;
      const m = /^(github|gitee):(.+)$/i.exec(s);
      if (m) { platform = normPlatform(m[1]); rest = m[2].trim(); }
      const idx = rest ? rest.indexOf("/") : -1;
      if (idx <= 0 || idx === rest.length - 1) return null;
      const owner = rest.slice(0, idx).trim();
      const repo = rest.slice(idx + 1).trim();
      if (!owner || !repo || /[\s.]/.test(owner) || /[\s\\]/.test(repo)) return null;
      return { platform, owner, repo };
    }

    let apiSeq = 0;
    async function apiFetch(platform, method, path, body) {
      const info = platformInfo(platform);
      const url = info.base + path;
      const token = info.token;
      const stamp = Date.now() + "-" + (++apiSeq);
      const outFile = config.tmpDir + "\\gitee-out-" + stamp + ".json";
      const codeFile = config.tmpDir + "\\gitee-code-" + stamp + ".txt";
      let cmd;
      if (body !== undefined && body !== null) {
        const b64 = Buffer.from(JSON.stringify(body), "utf8").toString("base64");
        const tmp = config.tmpDir + "\\gitee-body-" + stamp + ".json";
        cmd = `[IO.File]::WriteAllText('${tmp}', [Text.Encoding]::UTF8.GetString([Convert]::FromBase64String('${b64}')), (New-Object System.Text.UTF8Encoding($false))); & 'C:\\Windows\\System32\\curl.exe' -sS -o '${outFile}' -w '%{http_code}' -X ${method} '${url}' -H 'Content-Type: application/json' -H 'Authorization: token ${token}' -d '@${tmp}' | Set-Content -Encoding ASCII '${codeFile}'`;
      } else {
        cmd = `& 'C:\\Windows\\System32\\curl.exe' -sS -o '${outFile}' -w '%{http_code}' '${url}' -H 'Authorization: token ${token}' | Set-Content -Encoding ASCII '${codeFile}'`;
      }
      const r = await sh(cmd, { timeoutMs: 60000 });
      if (r.exitCode !== 0 && r.exitCode !== null) {
        throw new Error(platform + " api exec failed (" + r.exitCode + "): " + (r.stderr.text || "") + " | " + (r.stdout.text || ""));
      }
      let httpCode = 0;
      try {
        const codeRes = await sh(`Get-Content -Raw -Path '${codeFile}' -ErrorAction SilentlyContinue`, { timeoutMs: 15000 });
        httpCode = Number((codeRes.stdout.text || "").trim());
      } catch (e) { httpCode = 0; }
      let bodyText = "";
      try {
        const bodyRes = await sh(`Get-Content -Raw -Path '${outFile}' -ErrorAction SilentlyContinue`, { timeoutMs: 15000 });
        bodyText = (bodyRes.stdout.text || "").trim();
      } catch (e) { bodyText = ""; }
      try { void sh(`Remove-Item -Force -ErrorAction SilentlyContinue '${outFile}','${codeFile}'`, { timeoutMs: 10000 }); } catch (e) {}
      if (!Number.isFinite(httpCode) || httpCode < 200 || httpCode >= 300) {
        const err = { status: httpCode, body: bodyText };
        err.message = platform + " api HTTP " + httpCode + " for " + method + " " + path + " | " + bodyText.slice(0, 200);
        throw err;
      }
      if (!bodyText) return null;
      try { return JSON.parse(bodyText); } catch (e) { return { raw: bodyText }; }
    }

    async function apiFetchRaw(platform, method, path, body) {
      try {
        const data = await apiFetch(platform, method, path, body);
        return { ok: true, status: 200, data };
      } catch (e) {
        return { ok: false, status: e && e.status, message: String((e && e.message) || e) };
      }
    }

    // 按平台构造仓库级 API 方法集（GitHub 与 Gitee 路径/语义尽量复用）
    function platformApi(platform, owner, repo) {
      const p = normPlatform(platform);
      const gh = p === "github";
      const base = `/repos/${owner}/${repo}`;
      return {
        getIssue: (n) => apiFetch(p, "GET", `${base}/issues/${encodeURIComponent(n)}`),
        listOpenIssues: () => apiFetch(p, "GET", `${base}/issues?state=open&per_page=50${gh ? "&type=issues" : ""}`),
        addComment: (n, bodyText) => apiFetch(p, "POST", `${base}/issues/${encodeURIComponent(n)}/comments`, { body: bodyText }),
        createPr: (data) => apiFetch(p, "POST", `${base}/pulls`, data),
        mergePr: (n) => apiFetch(p, "PUT", `${base}/pulls/${encodeURIComponent(n)}/merge`, { merge_method: "merge" }),
        getRepo: () => apiFetch(p, "GET", `${base}`),
        getMe: () => apiFetch(p, "GET", "/user"),
        closeIssue: (n, enterprise) => gh
          ? apiFetch(p, "PATCH", `${base}/issues/${encodeURIComponent(n)}`, { state: "closed" })
          : apiFetch(p, "PATCH", (enterprise ? `/enterprises/${enterprise}/issues/${encodeURIComponent(n)}` : `${base}/issues/${encodeURIComponent(n)}`), { state: "closed" }),
        prUrl: (n) => gh ? `https://github.com/${owner}/${repo}/pull/${n}` : `https://gitee.com/${owner}/${repo}/pull/${n}`,
        hostLabel: () => gh ? "GitHub" : "Gitee",
      };
    }

    async function cloneUrlFor(platform, owner, repo) {
      const p = normPlatform(platform);
      if (p === "github") {
        if (!tokenOkFor("github")) throw new Error("github token unavailable");
        return `https://x-access-token:${config.githubToken}@github.com/${owner}/${repo}.git`;
      }
      const user = await ensureGitUser();
      if (!user) throw new Error("git user unavailable (no token or /user probe failed)");
      return `https://${user}:${config.giteeToken}@gitee.com/${owner}/${repo}.git`;
    }

    async function ensureGitUser() {
      if (config.gitUser) return config.gitUser;
      if (!tokenOk()) return "";
      try {
        const me = await apiFetch("gitee", "GET", "/user");
        if (me && me.login) {
          config.gitUser = me.login;
          console.log("[gitee-ai] detected git user: " + config.gitUser);
        }
      } catch (e) {
        console.log("[gitee-ai] git user detect failed: " + String((e && e.message) || e));
      }
      return config.gitUser;
    }

    function repoDir(owner, repo) { return config.workRoot + "\\" + owner + "\\" + repo; }
    function shellQuote(v) { return `'${String(v).replace(/'/g, "''")}'`; }
    async function ensureRepo(platform, owner, repo) {
      const dir = repoDir(owner, repo);
      try {
        const probe = await sh(`if (Test-Path '${dir.replace(/'/g, "''")}\\.git') { 'yes' } else { 'no' }`, { timeoutMs: 15000 });
        if ((probe.stdout.text || "").trim() === "yes") {
          await sh(`git -C ${shellQuote(dir)} fetch origin --prune --tags`, { timeoutMs: 300000 });
          return dir;
        }
      } catch (e) { /* fallthrough */ }
      const parent = config.workRoot + "\\" + owner;
      await sh(`New-Item -ItemType Directory -Force -Path ${shellQuote(parent)} | Out-Null`, { timeoutMs: 15000 });
      const url = await cloneUrlFor(platform, owner, repo);
      const r = await sh(`git clone ${shellQuote(url)} ${shellQuote(dir)}`, { timeoutMs: 600000 });
      if (r.exitCode !== 0) {
        throw new Error("git clone failed (" + r.exitCode + "): " + ((r.stderr.text || r.stdout.text || "").slice(0, 500)));
      }
      return dir;
    }

    function summarizeAgent(agent, firstSeq) {
      let started = false;
      let text = "";
      let reason;
      let completed = false;
      let errorMsg = "";
      for (const event of agent.session.events) {
        if (event.seq < firstSeq) continue;
        if (event.type === "turn/start") { started = true; continue; }
        if (!started) continue;
        if (event.type === "assistant/message") {
          const joined = event.data.message.content
            .filter((b) => b.type === "text")
            .map((b) => b.text)
            .join("");
          if (joined !== "") text = joined;
        }
        if (event.type === "turn/end") reason = event.data.reason;
      }
      if (reason) {
        if (reason.kind === "completed") completed = true;
        else if (reason.kind === "error") errorMsg = (reason.error && reason.error.message) || JSON.stringify(reason.error);
        else errorMsg = "turn reason: " + reason.kind;
      }
      return { text, completed, errorMsg };
    }

    async function runWorker({ dir, branchName, taskText }) {
      const selection = agentDefaultModel && typeof agentDefaultModel.currentSelection === "function"
        ? agentDefaultModel.currentSelection()
        : null;
      const { agent, dispose } = await agents.create({
        sessionId: "gitee-worker-" + uniqId(),
        meta: { cwd: dir },
        agentOptions: {
          ...(selection && selection.provider && selection.model
            ? { provider: selection.provider, model: selection.model }
            : {}),
        },
        setup: async (agentCtx) => {
          try {
            const perms = agentCtx.get("permissionPresets");
            if (perms !== undefined) perms.set(agentCtx.agent.session, "danger-full-access");
          } catch (e) { /* optional */ }
          await agentPresets.mount(agentCtx, config.workerPreset);
        },
      });
      await agent.whenIdle();
      const firstSeq = agent.session.seq;
      agent.followup({
        id: uniqId(),
        role: "user",
        content: [{ type: "text", text: taskText }],
        source: { kind: "user" },
      });
      await agent.whenIdle();
      const summary = summarizeAgent(agent, firstSeq);
      if (typeof dispose === "function") { try { await dispose(); } catch (e) {} }
      return summary;
    }

    // ── 从 issue 文本解析目标分支 ──
    // 支持多种说法：需要修改 X 分支 / 改 X 分支 / 基于 X 分支 / 在 X 分支上 /
    // 以 X 分支(为基础) / 合并到 X / 合到 X / 目标分支 X / base:X 等。
    // 任何指名分支的场合都用该分支作为开发基准与 PR 目标（若远端存在）。
    // 「修改 X（无“分支”字）」也归为候选，交给远端校验兜底。
    function requestedBranch(text) {
      const src = String(text || "");
      const pats = [
        // 1) 需要修改 X 分支 / 修改 X 分支 / 改 X(…) 分支
        /(?:需要\s*)?(?:修改|改动|调整|变更|改)\s*([A-Za-z0-9][A-Za-z0-9_\-./]*)(?:\s*\([^)\r\n]*\))?\s*分支/,
        // 2) 基于 X 分支 / 在 X 分支上 / 以 X 分支为基准
        /(?:基于|在|以)\s*([A-Za-z0-9][A-Za-z0-9_\-./]*)(?:\s*\([^)\r\n]*\))?\s*分支/,
        // 3) 合并到 X / 合到 X / 合入 X / 合并至 X
        /(?:合到|合入|合并到|合并至)\s*([A-Za-z0-9][A-Za-z0-9_\-./]*)/,
        // 4) 目标分支[:] X / 基础分支[:] X / merge(to/into): X / base: X
        /(?:(?:目标分支|基础分支)\s*[:：]?\s*|merge\s*(?:to|into)?\s*[:：]?\s*|base\s*[:：]\s*)([A-Za-z0-9][A-Za-z0-9_\-./]*)/i,
        // 5) 兜底：修改 X（无“分支”字，依赖远端分支校验防误伤）
        /(?:需要\s*)?(?:修改|改动|调整|变更)\s*([A-Za-z0-9][A-Za-z0-9_\-./]*)/,
      ];
      for (const re of pats) {
        const m = src.match(re);
        if (!m || !m[1]) continue;
        const cand = String(m[1]).trim();
        if (!/^[A-Za-z0-9][A-Za-z0-9_\-./]*$/.test(cand)) continue;
        if (cand === "master" || cand === "main") continue; // 默认分支无需特别指定
        return cand;
      }
      return null;
    }

    async function branchExistsOnRemote(dir, branch) {
      try {
        const r = await sh(`git -C ${shellQuote(dir)} ls-remote --heads origin ${shellQuote(branch)}`, { timeoutMs: 60000 });
        const out = ((r && r.stdout && r.stdout.text) || "") + ((r && r.stderr && r.stderr.text) || "");
        return /refs\/heads\//.test(out);
      } catch (e) {
        return false;
      }
    }

    async function processIssue(platform, owner, repo, number, issue, triggerComment) {
      const p = normPlatform(platform);
      const api = platformApi(p, owner, repo);
      const key = owner + "/" + repo + "#" + number;
      if (!tokenOkFor(p)) {
        console.log("[gitee-ai] skip: " + p + " token not configured");
        return { skipped: "no-token" };
      }
      if (active.has(key)) return { skipped: "busy" };
      active.add(key);
      handledKeys.add(key);
      const job = {
        key, owner, repo, number, status: "queued", step: "prepare",
        title: (issue && issue.title) || "", createdAt: Date.now(), updatedAt: Date.now(), detail: "", prUrl: "",
      };
      jobs.set(key, job);
      console.log("[gitee-ai] task received (" + p + "): " + key);
      const update = (patch) => { Object.assign(job, patch); job.updatedAt = Date.now(); };
      try {
        await api.addComment(number, `🤖 **AI 员工已接单**：开始处理该 issue。\n任务编号：\`${key}\``).catch(() => {});
        update({ status: "running", step: "clone" });
        const dir = await ensureRepo(p, owner, repo);
        let baseBranch = "master";
        try {
          const rd = await api.getRepo();
          if (rd && rd.default_branch) baseBranch = rd.default_branch;
        } catch (e) { /* keep master */ }
        // ── 按 issue 指示选择基准分支（PR 目标分支）──────────────────
        // issue 里写「基于 X 分支 / 在 X 分支上 / 合并到 X / 目标分支 X / base:X」
        // 时使用 X 作为 PR 的 base；否则用仓库默认分支。远端不存在则退回默认。
        const requestedBase = requestedBranch(((issue && issue.title) || "") + "\n" + ((issue && issue.body) || ""));
        if (requestedBase && requestedBase !== baseBranch) {
          const exists = await branchExistsOnRemote(dir, requestedBase);
          if (exists) {
            console.log("[gitee-ai] base branch per issue: " + requestedBase + " (default was " + baseBranch + ")");
            baseBranch = requestedBase;
            await api.addComment(number, `ℹ️ 已按 issue 要求基于 \`${requestedBase}\` 分支开发，PR 将合并到 \`${requestedBase}\`。`).catch(() => {});
          } else {
            console.log("[gitee-ai] requested branch " + requestedBase + " not on remote; keep default " + baseBranch);
            await api.addComment(number, `⚠️ 远端不存在 \`${requestedBase}\` 分支，本次退回默认分支 \`${baseBranch}\`。`).catch(() => {});
          }
        }
        const branchName = "ai-fix/issue-" + number;
        update({ step: "branch" });
        await sh(`git -C ${shellQuote(dir)} checkout -B ${shellQuote(branchName)} origin/${baseBranch}`, { workdir: dir, timeoutMs: 120000 });
        await sh(`git -C ${shellQuote(dir)} config user.name ${shellQuote(config.gitAuthorName)}`, { workdir: dir });
        await sh(`git -C ${shellQuote(dir)} config user.email ${shellQuote(config.gitAuthorEmail)}`, { workdir: dir });

        const issueBody = ((issue && issue.body) || "").slice(0, 6000);
        const taskText = [
          `你是 ${api.hostLabel()} 仓库 ${owner}/${repo} 的 AI 员工。仓库已克隆到 ${dir}，当前分支是 ${branchName}（基于 origin/${baseBranch}，PR 将合并到 ${baseBranch}）。`,
          ``,
          `任务内容（issue #${number}）：`,
          `标题：${(issue && issue.title) || "(无标题)"}`,
          `描述：\n${issueBody || "(无描述)"}`,
          triggerComment ? `\n触发评论：${triggerComment.slice(0, 2000)}` : "",
          ``,
          `要求：`,
          `1. 先探索仓库结构，理解 issue 要解决的问题。`,
          `2. 在仓库目录 ${dir} 中实现修复/功能，遵循仓库既有风格与约定。`,
          `3. 修改后尽量用仓库可用的方式验证（运行测试/构建/语法检查）。`,
          `4. 用 git add 加入相关改动并 commit；commit message 以 \`fix #${number}:\` 或 \`feat #${number}:\` 开头。`,
          `5. 不要执行 git push（推送由系统完成）。`,
          `6. 最后用一段话总结：改了什么、如何验证、结果如何。`,
          ``,
          `注意：只改与任务相关的代码；不得提交敏感信息；如果无法完成，明确说明原因。`,
        ].join("\n");

        update({ step: "working" });
        let summary;
        try {
          summary = await Promise.race([
            runWorker({ dir, branchName, taskText }),
            new Promise((resolve) => {
              timer.timeout(() => resolve({
                text: "任务超时，worker 未在限定时间内完成。", completed: false, errorMsg: "timeout",
              }), config.taskTimeoutMs);
            }),
          ]);
        } catch (e) {
          summary = { text: "worker 运行异常：" + String((e && e.message) || e), completed: false, errorMsg: "exception" };
        }

        update({ step: "push" });
        await sh(`git -C ${shellQuote(dir)} push -u origin ${shellQuote(branchName)}`, { workdir: dir, timeoutMs: 300000 });

        update({ step: "pr" });
        const prTitle = `[AI] ${(issue && issue.title) || ("Fix issue #" + number)} (#${number})`;
        const prBody = `DeepSeek Harness AI 员工自动生成。\n\n关联 issue: #${number}\n\n---\n\n${(summary.text || "").slice(0, 4000)}`;
        let prNumber = null;
        let prUrl = "";
        try {
          const created = await api.createPr({
            title: prTitle, head: branchName, base: baseBranch, body: prBody, prune_source_branch: false,
          });
          prNumber = created && created.number;
          prUrl = (created && created.html_url) || (prNumber ? api.prUrl(prNumber) : "");
        } catch (e) {
          const errText = String((e && e.message) || e);
          if (/already|已存在|exist/i.test(errText)) {
            const list = await apiFetch(p, "GET", `/repos/${owner}/${repo}/pulls?state=open`).catch(() => null);
            const arr = Array.isArray(list) ? list : [];
            const found = arr.find((p) => p.head === branchName || (p.head && p.head.ref) === branchName || p.head === `${owner}:${branchName}`);
            if (found) { prNumber = found.number; prUrl = found.html_url || ""; }
          } else {
            throw e;
          }
        }
        update({ status: "pr-created", prUrl, detail: (summary.text || "").slice(0, 3000) });

        let merged = false;
        if (config.autoMerge && prNumber) {
          update({ step: "merge" });
          try {
            await api.mergePr(prNumber);
            merged = true;
            update({ status: "merged", prUrl });
          } catch (e) {
            update({ status: "pr-created", detail: "PR 已创建但自动合并失败：" + String((e && e.message) || e) });
          }
        }

        const statusEmoji = merged ? "✅" : (prNumber ? "🚀" : "⚠️");
        const comment = [
          `${statusEmoji} **AI 员工任务完成**`,
          ``,
          `- 分支：\`${branchName}\``,
          prNumber ? `- PR：[${repo}#${prNumber}](${prUrl})` : `- 未创建 PR（请在 ${api.hostLabel()} 上检查）`,
          merged ? "- 状态：**已自动合并**" : "- 状态：PR 待审查合并",
          ``,
          `**处理总结：**`,
          ``,
          (summary.text || "(无总结输出)").slice(0, 3500),
        ].filter((l) => l !== "").join("\n");
        await api.addComment(number, comment).catch(() => {});

        // ── 完成后自动关闭 issue（企业仓库走企业前缀路径）──
        if (config.autoCloseIssue) {
          update({ step: "close-issue" });
          try {
            let entPath = null;
            if (p === "gitee") {
              const repoMeta = (issue && issue.repository) || (await api.getRepo().catch(() => null));
              entPath = (repoMeta && repoMeta.namespace && repoMeta.namespace.path) || (repoMeta && repoMeta.enterprise && repoMeta.enterprise.path) || "";
            }
            await api.closeIssue(number, entPath || null);
            update({ status: merged ? "merged" : "pr-created", step: "closed" });
            console.log("[gitee-ai] issue closed: " + key);
          } catch (e) {
            console.log("[gitee-ai] close issue failed for " + key + ": " + String((e && e.message) || e));
            update({ status: merged ? "merged" : "pr-created", step: "close-failed" });
          }
        }

        console.log("[gitee-ai] task finished: " + key + " merged=" + merged + " pr=" + prNumber + " closed=" + config.autoCloseIssue);
        return { ok: true, prNumber, merged };
      } catch (e) {
        update({ status: "failed", detail: String((e && e.message) || e) });
        console.error("[gitee-ai] task error: " + key, e);
        await api.addComment(number, `❌ **AI 员工处理失败**：\n\n\`\`\`\n${String((e && e.message) || e).slice(0, 1500)}\n\`\`\``).catch(() => {});
        return { failed: true };
      } finally {
        active.delete(key);
      }
    }

    let pollDisposer = null;
    async function pollOnce() {
      if (!config.pollEnabled) return;
      const repos = Array.isArray(config.watchRepos) ? config.watchRepos : [];
      for (const spec of repos) {
        const parsed = parseRepoSpec(spec);
        if (!parsed) { console.log("[gitee-ai] poll: bad repo spec '" + spec + "', skip"); continue; }
        const { platform: p, owner, repo: rname } = parsed;
        if (!tokenOkFor(p)) { console.log("[gitee-ai] poll: " + p + " token not configured for " + spec + ", skip"); continue; }
        try {
          const api = platformApi(p, owner, rname);
          const list = await api.listOpenIssues();
          const arr = Array.isArray(list) ? list : (list && Array.isArray(list.data) ? list.data : []);
          console.log("[gitee-ai] poll " + spec + ": " + arr.length + " open issue(s)");
          for (const issue of arr) {
            const number = issue && issue.number;
            if (!number) continue;
            if (issue && issue.pull_request) continue; // GitHub 的 issues 列表会混入 PR
            const key = owner + "/" + rname + "#" + number;
            if (handledKeys.has(key)) continue;
            if (active.has(key)) continue;
            if (jobs.has(key)) { handledKeys.add(key); continue; }
            const issueText = ((issue && issue.title) || "") + "\n" + ((issue && issue.body) || "");
            if (!mentionsBot(issueText)) {
              console.log("[gitee-ai] poll: issue " + key + " has no @" + config.botName + ", skip");
              continue;
            }
            console.log("[gitee-ai] poll: found @mention issue " + key);
            handledKeys.add(key);
            void processIssue(p, owner, rname, number, issue, "");
          }
        } catch (e) {
          console.error("[gitee-ai] poll error for " + spec + ": " + String((e && e.message) || e));
        }
      }
    }

    function restartPolling() {
      if (pollDisposer) { try { pollDisposer(); } catch (e) {} pollDisposer = null; }
      if (config.pollEnabled && (tokenOk() || tokenOkFor("github"))) {
        pollDisposer = timer.interval(() => { void pollOnce(); }, Math.max(10000, config.pollIntervalMs || 60000));
        console.log("[gitee-ai] polling started every " + Math.round((config.pollIntervalMs || 60000) / 1000) + "s for " + (config.watchRepos || []).length + " repo(s)");
        void pollOnce();
      } else {
        console.log("[gitee-ai] polling off");
      }
    }

    async function readBody(req) {
      const dec = new TextDecoder();
      let text = "";
      for await (const chunk of req) {
        text += typeof chunk === "string" ? chunk : dec.decode(chunk, { stream: true });
      }
      text += dec.decode();
      return text;
    }

    function send(res, code, obj) {
      res.writeHead(code, { "Content-Type": "application/json; charset=utf-8" });
      res.end(JSON.stringify(obj));
    }

    // ── 配置持久化：把设置页保存的表单写回插件包自己的 cordis.patch.yml ──
    // （本包作为 profile bundle 挂载，配置只存在于包内 patch；同时写 vendor
    //   源文件与已安装副本，两处保持一致，重启后 bundle 读到的是同一份。）
    function patchFilePaths() {
      const paths = [];
      try { paths.push(fileURLToPath(new URL("../cordis.patch.yml", import.meta.url))); } catch (e) {}
      try { paths.push(fileURLToPath(new URL("../../../vendor/gitee-ai-employee/cordis.patch.yml", import.meta.url))); } catch (e) {}
      return paths.filter((p) => p && existsSync(p));
    }
    async function saveConfigToPatch(nextConfig) {
      const paths = patchFilePaths();
      if (!paths.length) throw new Error("cannot locate cordis.patch.yml");
      const written = [];
      for (const p of paths) {
        const text = await readFile(p);
        const doc = yaml.parseDocument(text);
        const root = doc.contents;
        let updated = false;
        if (root && root.items && root.items[0] && root.items[0].get) {
          const insertSeq = root.items[0].get("insert");
          if (insertSeq && insertSeq.items && insertSeq.items[0] && insertSeq.items[0].get) {
            const entryMap = insertSeq.items[0];
            const entryJson = entryMap.toJSON ? entryMap.toJSON() : null;
            if (entryJson && entryJson.id === "gitee-ai-employee") {
              const configMap = entryMap.get("config", true);
              if (configMap && configMap.set) {
                for (const [k, v] of Object.entries(nextConfig)) {
                  if (v === undefined) continue;
                  configMap.set(k, v);
                }
                updated = true;
              }
            }
          }
        }
        if (updated) {
          await writeFile(p, doc.toString());
          written.push(p);
        }
      }
      if (!written.length) throw new Error("gitee-ai-employee entry not found in patch");
      return written.join("; ");
    }
    async function readFile(p) {
      const { readFile } = await import("node:fs/promises");
      return readFile(p, "utf8");
    }
    async function writeFile(p, content) {
      const { writeFile } = await import("node:fs/promises");
      return writeFile(p, content, "utf8");
    }

    function settingsHtml(err, ok) {
      const c = config;
      const esc = (v) => String(v ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/"/g, "&quot;");
      const tokenVal = c.giteeToken ? "已配置（" + c.botName + "）" : "";
      return `<!DOCTYPE html><html lang="zh"><head><meta charset="utf-8"><title>Gitee AI 员工 · 设置</title>
<style>
body{font-family:system-ui,-apple-system,Segoe UI,Microsoft YaHei,sans-serif;background:#0e1116;color:#e6e8ec;margin:0;padding:32px 16px}
.wrap{max-width:640px;margin:0 auto}
h1{font-size:20px;margin:0 0 4px}h2{font-size:14px;color:#9aa3af;font-weight:500;margin:20px 0 8px}
.card{background:#161b22;border:1px solid #2a313c;border-radius:12px;padding:18px 20px;margin-bottom:12px}
label{display:block;font-size:13px;color:#9aa3af;margin:10px 0 4px}
input[type=text],input[type=password],input[type=number]{width:100%;box-sizing:border-box;background:#0d1117;border:1px solid #2a313c;border-radius:8px;color:#e6e8ec;padding:8px 10px;font-size:14px}
input:focus{outline:none;border-color:#3b82f6}
.check{display:flex;align-items:center;gap:8px;margin:8px 0}
.check input{width:auto}
button{background:#2563eb;color:#fff;border:0;border-radius:8px;padding:10px 18px;font-size:14px;cursor:pointer;margin-top:14px}
button:hover{background:#1d4ed8}
.err{background:#7f1d1d;color:#fecaca;border:1px solid #991b1b;border-radius:8px;padding:10px 12px;font-size:13px;margin-bottom:12px}
.ok{background:#14532d;color:#bbf7d0;border:1px solid #166534;border-radius:8px;padding:10px 12px;font-size:13px;margin-bottom:12px}
.mono{font-family:Consolas,monospace;font-size:12px;color:#9aa3af}
.hint{font-size:12px;color:#6b7280;margin-top:6px}
</style></head><body><div class="wrap">
<h1>Gitee AI 员工</h1><div class="mono">Composition 插件 · 配置保存到 cordis.patch.yml · 重启 DSH 后生效</div>
${err ? `<div class="err">${esc(err)}</div>` : ""}
${ok ? `<div class="ok">${esc(ok)}</div>` : ""}
<form method="POST" action="/gitee-ai/settings">
<div class="card"><h2>基础</h2>
<label>Gitee 私人令牌（token）</label><input type="password" name="giteeToken" placeholder="b04e…" value="">
<div class="hint">${esc(tokenVal)} 留空则保持原值</div>
<label>GitHub 私人令牌（token，可选）</label><input type="password" name="githubToken" placeholder="ghp_…" value="">
<div class="hint">${esc(c.githubToken ? "已配置" : "未配置")} 留空则保持原值；用于 github: 前缀的监听仓库</div>
<label>默认平台（watchRepos 无前缀行）</label><select name="defaultPlatform" style="width:100%;box-sizing:border-box;background:#0d1117;border:1px solid #2a313c;border-radius:8px;color:#e6e8ec;padding:8px 10px;font-size:14px">
<option value="gitee" ${(c.defaultPlatform || "gitee") !== "github" ? "selected" : ""}>gitee</option>
<option value="github" ${(c.defaultPlatform || "gitee") === "github" ? "selected" : ""}>github</option>
</select>
<label>机器人账号（issue 里 @ 它触发）</label><input type="text" name="botName" value="${esc(c.botName)}">
<label>workRoot（克隆仓库的工作目录）</label><input type="text" name="workRoot" value="${esc(c.workRoot)}">
</div>
<div class="card"><h2>仓库与轮询</h2>
<label>监听仓库（[gitee:|github:]owner/repo，每行一个）</label><textarea name="watchRepos" rows="3" style="width:100%;box-sizing:border-box;background:#0d1117;border:1px solid #2a313c;border-radius:8px;color:#e6e8ec;padding:8px 10px;font-size:13px">${esc(Array.isArray(c.watchRepos) ? c.watchRepos.join("\n") : "")}</textarea>
<div class="check"><input type="checkbox" name="pollEnabled" ${c.pollEnabled ? "checked" : ""}><span>启用定时轮询</span></div>
<label>轮询间隔（毫秒）</label><input type="number" name="pollIntervalMs" value="${esc(c.pollIntervalMs)}">
</div>
<div class="card"><h2>自动处理</h2>
<div class="check"><input type="checkbox" name="autoMerge" ${c.autoMerge ? "checked" : ""}><span>自动合并 PR</span></div>
<div class="check"><input type="checkbox" name="autoCloseIssue" ${c.autoCloseIssue ? "checked" : ""}><span>成功后自动关闭 issue</span></div>
<div class="hint">保存后本进程立即生效，同时写入 patch 文件（重启后同样生效）。</div>
</div>
<button type="submit">保存配置</button>
</form>
<p class="hint">状态查询：<span class="mono">/gitee-ai-status</span>（JSON）</p>
</div></body></html>`;
    }

    async function handleSettings(req, res) {
      try {
        const method = (req.method || "GET").toUpperCase();
        if (method === "POST") {
          const raw = await readBody(req);
          const form = parseForm(raw);
          const next = { ...config };
          if (form.giteeToken && form.giteeToken.trim()) next.giteeToken = form.giteeToken.trim();
          if (form.githubToken && form.githubToken.trim()) next.githubToken = form.githubToken.trim();
          if (form.defaultPlatform) next.defaultPlatform = normPlatform(form.defaultPlatform);
          if (form.botName !== undefined) next.botName = form.botName.trim() || next.botName;
          if (form.workRoot !== undefined) next.workRoot = form.workRoot.trim() || next.workRoot;
          if (form.pollIntervalMs) next.pollIntervalMs = Number(form.pollIntervalMs) || next.pollIntervalMs;
          next.watchRepos = (form.watchRepos || "").split(/\r?\n/).map(s => s.trim()).filter(Boolean);
          next.pollEnabled = form.pollEnabled === "on";
          next.autoMerge = form.autoMerge === "on";
          next.autoCloseIssue = form.autoCloseIssue === "on";
          const p = await saveConfigToPatch(next);
          // 内存中立即更新（本进程生效），并重启轮询
          config.giteeToken = next.giteeToken;
          config.githubToken = next.githubToken;
          config.defaultPlatform = next.defaultPlatform;
          config.botName = next.botName;
          config.workRoot = next.workRoot;
          config.pollIntervalMs = next.pollIntervalMs;
          config.watchRepos = next.watchRepos;
          config.pollEnabled = next.pollEnabled;
          config.autoMerge = next.autoMerge;
          config.autoCloseIssue = next.autoCloseIssue;
          restartPolling();
          res.writeHead(302, { Location: "/gitee-ai/settings?ok=" + encodeURIComponent("已保存到 " + p + "（本进程已生效；重启 DSH 后同样生效）") });
          res.end();
          return;
        }
        // GET：渲染设置表单
        const q = queryParams(req.url || "");
        const ok = q.ok ? decodeURIComponent(q.ok) : "";
        const err = q.err ? decodeURIComponent(q.err) : "";
        sendHtml(res, settingsHtml(err, ok));
      } catch (e) {
        console.error("[gitee-ai] settings handler error:", e);
        res.writeHead(302, { Location: "/gitee-ai/settings?err=" + encodeURIComponent(String((e && e.message) || e)) });
        res.end();
      }
    }

    function sendHtml(res, html) {
      res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
      res.end(html);
    }

    function queryParams(rawUrl) {
      const qIdx = rawUrl.indexOf("?");
      if (qIdx < 0) return {};
      const out = {};
      const parts = rawUrl.slice(qIdx + 1).split("&");
      for (const part of parts) {
        if (!part) continue;
        const eq = part.indexOf("=");
        const k = eq < 0 ? part : part.slice(0, eq);
        const v = eq < 0 ? "" : part.slice(eq + 1);
        try { out[decodeURIComponent(k)] = decodeURIComponent(v); } catch (e) { out[k] = v; }
      }
      return out;
    }

    async function handleWebhook(req, res) {
      try {
        const secret = req.headers["x-gitee-token"] || "";
        if (config.webhookSecret && secret !== config.webhookSecret) {
          send(res, 401, { error: "invalid secret" }); return;
        }
        const raw = await readBody(req);
        if (!raw) { send(res, 400, { error: "empty body" }); return; }
        let payload = null;
        if ((req.headers["content-type"] || "").toLowerCase().includes("application/json")) {
          try { payload = JSON.parse(raw); } catch (e) { console.error("[gitee-ai] json parse error", e); }
        } else {
          try {
            const params = parseForm(raw);
            payload = JSON.parse(params.payload || "{}");
          } catch (e) { console.error("[gitee-ai] form parse error", e); }
        }
        if (payload && payload.hook_name) console.log("[gitee-ai] webhook event: " + payload.hook_name);
        if (payload) void dispatchPayload(payload);
        send(res, 200, { ok: true });
      } catch (e) {
        console.error("[gitee-ai] webhook handler error:", e);
        send(res, 500, { error: String((e && e.message) || e) });
      }
    }

    async function handleTrigger(req, res) {
      try {
        const q = queryParams(req.url || "");
        const platform = normPlatform(q.platform || config.defaultPlatform);
        const owner = (q.owner || "").trim();
        const repo = (q.repo || "").trim();
        const number = (q.number || "").trim();
        if (!owner || !repo || !number) {
          send(res, 400, { ok: false, error: "owner/repo/number required" });
          return;
        }
        send(res, 200, { ok: true, accepted: true, key: owner + "/" + repo + "#" + number, note: "处理中，详见日志/面板" });
        let issueDetail = null;
        try { issueDetail = await apiFetch(platform, "GET", `/repos/${owner}/${repo}/issues/${encodeURIComponent(number)}`); } catch (e) { issueDetail = null; }
        void processIssue(platform, owner, repo, number, issueDetail || {}, (q.comment || "").slice(0, 2000));
      } catch (e) {
        console.error("[gitee-ai] trigger handler error:", e);
        send(res, 500, { ok: false, error: String((e && e.message) || e) });
      }
    }

    function mentionsBot(text) {
      if (!text) return false;
      // 不用 \b：中文/全角结尾的 botName 在 JS \w 语义下永远没有边界，导致匹配失败。
      // 用「后瞻非 ASCII 单词字符（或串尾）」替代，ASCII 与中文 botName 都正确。
      return new RegExp(`@${config.botName.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}(?![A-Za-z0-9_])`, "i").test(text);
    }

    function extractIssue(payload) {
      return (payload && payload.issue) || (payload && payload.object_attributes && payload.object_attributes.issue) || undefined;
    }

    async function dispatchPayload(payload) {
      const repo = (payload && payload.repository) || (payload && payload.project);
      const full = (repo && (repo.full_name || repo.path_with_namespace || repo.fullName)) || "";
      const [owner, rname] = String(full).split("/");
      if (!owner || !rname) { console.log("[gitee-ai] no repo in payload"); return; }
      const issue = extractIssue(payload);
      const number = (issue && issue.number) || (payload && payload.number) || (issue && issue.iid) || (payload && payload.object_attributes && payload.object_attributes.iid);
      if (!number) { console.log("[gitee-ai] no issue number"); return; }
      const issueText = ((issue && issue.body) || "") + "\n" + ((issue && issue.title) || "");
      const commentBody = (payload && payload.comment && payload.comment.body) || (payload && payload.object_attributes && payload.object_attributes.note) || "";
      if (!mentionsBot(issueText + "\n" + commentBody)) {
        console.log("[gitee-ai] no @mention of " + config.botName + "; skip issue #" + number);
        return;
      }
      const key = owner + "/" + rname + "#" + number;
      const existing = jobs.get(key);
      if (existing && Date.now() - existing.createdAt < 60000) { console.log("[gitee-ai] debounced: " + key); return; }
      if (active.has(key)) { console.log("[gitee-ai] already active: " + key); return; }
      handledKeys.add(key);
      let issueDetail = null;
      try { issueDetail = await apiFetch("gitee", "GET", `/repos/${owner}/${rname}/issues/${encodeURIComponent(number)}`); } catch (e) { issueDetail = issue; }
      await processIssue("gitee", owner, rname, number, issueDetail || issue, commentBody);
    }

    // ── 注册 HTTP 路由：全新随机路径，避开历史残留 ────────────────────
    // （webServer 为可选服务：缺失时路由不注册，轮询/worker 仍可工作）
    let settingsDisposer = null;
    if (webServer) {
      try {
        settingsDisposer = webServer.register({ kind: "exact", path: "/gitee-ai/settings", handler: handleSettings });
      } catch (e) {
        console.error("[gitee-ai] cannot register settings page:", (e && e.message) || e);
        settingsDisposer = null;
      }
    }
    if (settingsDisposer) {
      ctx.on("dispose", () => { try { settingsDisposer(); } catch (e) {} });
      console.log("[gitee-ai] settings page at /gitee-ai/settings");
    }
    function randomSuffix() { return String(Math.floor(1000 + Math.random() * 90000)); }
    let hookPath = "/gitee-ai-hook-" + randomSuffix();
    let hookDisposer = null;
    for (let attempt = 0; webServer && attempt < 40; attempt++) {
      try {
        hookDisposer = webServer.register({ kind: "exact", path: hookPath, handler: handleWebhook });
        break;
      } catch (e) {
        if (attempt === 39) { hookDisposer = null; break; }
        hookPath = "/gitee-ai-hook-" + randomSuffix();
      }
    }
    const finalHookPath = hookDisposer ? hookPath : null;

    let goPath = "/gitee-ai-go-" + randomSuffix();
    let goDisposer = null;
    for (let attempt = 0; webServer && attempt < 40; attempt++) {
      try {
        goDisposer = webServer.register({ kind: "exact", path: goPath, handler: handleTrigger });
        break;
      } catch (e) {
        if (attempt === 39) { goDisposer = null; break; }
        goPath = "/gitee-ai-go-" + randomSuffix();
      }
    }
    const finalGoPath = goDisposer ? goPath : null;

    ctx.on("dispose", () => {
      if (hookDisposer) try { hookDisposer(); } catch (e) {}
      if (goDisposer) try { goDisposer(); } catch (e) {}
      if (pollDisposer) try { pollDisposer(); } catch (e) {}
    });
    console.log("[gitee-ai] webhook at " + (finalHookPath || "UNAVAILABLE") + " | manual trigger at " + (finalGoPath || "UNAVAILABLE"));

    // ── 提供 HTTP 状态/诊断端点（供 HTTP 查询，替代原 Client UI 的 RPC）──
    let statusPath = "/gitee-ai-status-" + randomSuffix();
    let statusDisposer = null;
    for (let attempt = 0; webServer && attempt < 40; attempt++) {
      try {
        statusDisposer = webServer.register({
          kind: "exact",
          path: statusPath,
          handler: async (req, res) => {
            const rows = [];
            for (const job of jobs.values()) {
              rows.push({ key: job.key, status: job.status, step: job.step, title: job.title, prUrl: job.prUrl, detail: (job.detail || "").slice(0, 300) });
            }
            send(res, 200, {
              ok: true,
              config: {
                botName: config.botName, webhookPath: finalHookPath, triggerPath: finalGoPath,
                workRoot: config.workRoot, autoMerge: config.autoMerge,
                autoCloseIssue: !!config.autoCloseIssue, tokenConfigured: tokenOk(),
                githubTokenConfigured: tokenOkFor("github"),
                defaultPlatform: config.defaultPlatform || "gitee",
                gitUser: config.gitUser || "", pollEnabled: !!config.pollEnabled,
                pollIntervalMs: config.pollIntervalMs,
                watchRepos: Array.isArray(config.watchRepos) ? config.watchRepos : [],
              },
              jobs: rows.slice(-50).reverse(),
            });
          },
        });
        break;
      } catch (e) {
        if (attempt === 39) { statusDisposer = null; break; }
        statusPath = "/gitee-ai-status-" + randomSuffix();
      }
    }
    const finalStatusPath = statusDisposer ? statusPath : null;
    if (statusDisposer) {
      ctx.on("dispose", () => { try { statusDisposer(); } catch (e) {} });
      console.log("[gitee-ai] status endpoint at " + finalStatusPath);
    }

    // ── 固定 JSON 配置 API（client 设置卡片读写；GET 读、POST 保存）──
    let configApiDisposer = null;
    if (webServer) {
      try {
      configApiDisposer = webServer.register({
        kind: "exact",
        path: "/gitee-ai/config",
        handler: async (req, res) => {
          const method = (req.method || "GET").toUpperCase();
          if (method === "POST") {
            try {
              const raw = await readBody(req);
              let body = {};
              const ct = (req.headers["content-type"] || "").toLowerCase();
              if (ct.includes("application/json")) {
                try { body = JSON.parse(raw || "{}"); } catch (e) { body = {}; }
              } else if (raw) {
                body = parseForm(raw);
              }
              const next = { ...config };
              if (typeof body.giteeToken === "string" && body.giteeToken.trim()) next.giteeToken = body.giteeToken.trim();
              if (typeof body.botName === "string" && body.botName.trim()) next.botName = body.botName.trim();
              if (typeof body.workRoot === "string" && body.workRoot.trim()) next.workRoot = body.workRoot.trim();
              if (body.pollIntervalMs !== undefined) next.pollIntervalMs = Number(body.pollIntervalMs) || next.pollIntervalMs;
              if (Array.isArray(body.watchRepos)) next.watchRepos = body.watchRepos.map(String).map(s => s.trim()).filter(Boolean);
              if (typeof body.pollEnabled === "boolean") next.pollEnabled = body.pollEnabled;
              if (typeof body.autoMerge === "boolean") next.autoMerge = body.autoMerge;
              if (typeof body.autoCloseIssue === "boolean") next.autoCloseIssue = body.autoCloseIssue;
              if (typeof body.defaultPlatform === "string") next.defaultPlatform = normPlatform(body.defaultPlatform);
              if (typeof body.githubToken === "string" && body.githubToken.trim()) next.githubToken = body.githubToken.trim();
              const savedTo = await saveConfigToPatch(next);
              Object.assign(config, next);
              restartPolling();
              send(res, 200, { ok: true, savedTo, config: configSummary() });
            } catch (e) {
              console.error("[gitee-ai] config save error:", e);
              send(res, 500, { ok: false, error: String((e && e.message) || e) });
            }
            return;
          }
          // GET：返回当前配置（不含原始 token，只给 tokenConfigured 标记）
          send(res, 200, { ok: true, config: configSummary(), jobs: lastJobs() });
        },
      });
    } catch (e) {
      console.error("[gitee-ai] cannot register config api:", (e && e.message) || e);
      configApiDisposer = null;
    }
    if (configApiDisposer) {
      ctx.on("dispose", () => { try { configApiDisposer(); } catch (e) {} });
      console.log("[gitee-ai] config api at /gitee-ai/config");
    }
    }
    function configSummary() {
      return {
        botName: config.botName, webhookPath: finalHookPath, triggerPath: finalGoPath,
        workRoot: config.workRoot, autoMerge: config.autoMerge,
        autoCloseIssue: !!config.autoCloseIssue, tokenConfigured: tokenOk(),
        githubTokenConfigured: tokenOkFor("github"),
        defaultPlatform: config.defaultPlatform || "gitee",
        gitUser: config.gitUser || "", pollEnabled: !!config.pollEnabled,
        pollIntervalMs: config.pollIntervalMs,
        watchRepos: Array.isArray(config.watchRepos) ? config.watchRepos : [],
      };
    }
    function lastJobs() {
      const rows = [];
      for (const job of jobs.values()) {
        rows.push({ key: job.key, status: job.status, step: job.step, title: job.title, prUrl: job.prUrl, detail: (job.detail || "").slice(0, 300) });
      }
      return rows.slice(-50).reverse();
    }

    // ── 启动轮询（如有配置）──
    restartPolling();
    console.log("[gitee-ai] plugin ready (composition). tokenConfigured=" + tokenOk() + " polling=" + config.pollEnabled);
  },
};
