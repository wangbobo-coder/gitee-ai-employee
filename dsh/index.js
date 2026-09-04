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

// 路径分隔符：Windows 用反斜杠，mac / linux 用正斜杠（保证跨平台路径正确）。
const PATH_SEP = (typeof process !== "undefined" && process.platform === "win32") ? "\\" : "/";

// 插件自身版本（读包内 package.json），用于启动日志 / 状态接口自报，
// 便于在运行日志里一眼确认当前加载的到底是不是最新版。
const PLUGIN_VERSION = (() => {
  try { return JSON.parse(readFileSync(fileURLToPath(new URL("../package.json", import.meta.url)), "utf8")).version || "?"; } catch (e) { return "?"; }
})();

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
  // ── 代码安全扫描（v1.2+）─────────────────────────────────────────────
  scanEnabled: false,          // 是否启用定时扫描（scanRepos）
  scanRepos: [],               // 扫描仓库列表（格式同 watchRepos：[gitee:|github:]owner/repo）
  scanMinSeverity: "medium",   // 最低上报级别：critical|high|medium|low|none
  scanOneIssuePerRun: true,    // true=一次扫描合并成一个 issue；false=每个发现一个 issue
  scanPrompts: {},             // 提示词 { [id]: { name, prompt } }：覆写内置或新增自定义
  scanWorkerPreset: "gitee-scanner",
  scanIntervalMs: 21600000,    // 定时扫描间隔（默认 6 小时）
  scanTimeoutMs: 1800000,      // 单次扫描超时（默认 30 分钟）
  scanConcurrency: 3,          // 同时扫描的仓库上限（1~8；配很多仓库时排队持续扫描）
};

// ── 内置代码安全扫描提示词 ──────────────────────────────────────────────
// scanPrompts 配置 = { [id]: { name, prompt } }，未配置时用这里的默认值；
// 用户可在设置里按相同 id 覆写内容，或新增自定义 id（任意字符串 id），
// 扫描时把选中的提示词连同审计任务一起发给扫描 worker。
const BUILTIN_SCAN_PROMPTS = {
  general: {
    name: "综合安全审计",
    prompt: "对仓库代码做一次全面安全审计：SQL 注入、XSS、命令注入、路径穿越、SSRF、硬编码密钥、不安全反序列化、越权/认证绕过、错误信息泄露、危险 API 误用等。每个发现都要落到具体文件与行号。",
  },
  sqli: {
    name: "SQL 注入",
    prompt: "查找 SQL 注入风险：字符串拼接的 SQL、ORM 使用不当（原生查询/动态查询拼接用户输入）、存储过程拼接、动态 order by/limit/列名拼接等。确认输入来源为用户可控且未经参数化。",
  },
  xss: {
    name: "XSS 跨站脚本",
    prompt: "查找 XSS 风险：未转义输出用户输入、innerHTML/v-html/dangerouslySetInnerHTML/模板字符串渲染、不安全的 href/javascript:、反射型与存储型 XSS。指出注入点、存储点与输出点。",
  },
  "command-injection": {
    name: "命令注入",
    prompt: "查找命令注入风险：exec/system/spawn/popen/ProcessBuilder/Runtime.exec/child_process 拼接用户输入、shell=True、不安全的子进程调用、危险的 eval 执行。指出注入点与可达性分析。",
  },
  "path-traversal": {
    name: "路径穿越",
    prompt: "查找路径穿越风险：文件读写拼接用户可控路径、zip 解压路径、下载文件名未校验 ../、任意路径删除/复制、符号链接攻击等。指出危险操作的文件与行号。",
  },
  ssrf: {
    name: "SSRF",
    prompt: "查找 SSRF 风险：接收用户 URL/主机/IP 后由服务端发起请求、代理转发、图片/附件抓取、Webhook、DNS 后访问内网、云元数据（169.254.169.254）可达等。指出请求发起点与数据来源。",
  },
  "hardcoded-secret": {
    name: "硬编码密钥",
    prompt: "查找硬编码的密钥/令牌/口令：AK/SK、API key、token、password/passwd、私钥、连接串中的口令、.env 文件被提交、密钥写入代码常量等。指出文件行号与密钥类型，但描述中不要粘贴完整密钥原文。",
  },
  "insecure-deserialization": {
    name: "不安全反序列化",
    prompt: "查找不安全反序列化风险：pickle、yaml.load/unsafe_load、readObject/XMLDecoder、不安全的 JSON 深度解析、反序列化用户输入后对象方法调用等。指出入口与潜在影响。",
  },
  authz: {
    name: "越权与认证绕过",
    prompt: "查找越权与认证绕过风险：仅前端鉴权、IDOR（直接用 id 访问他人资源）、缺失鉴权的管理端点、弱口令/默认口令逻辑、JWT 校验缺失或算法混淆、权限校验顺序错误等。",
  },
  dos: {
    name: "资源耗尽 / DoS",
    prompt: "查找资源耗尽风险：无上限的正则（ReDoS）、大文件/海量请求无限制、解压炸弹、无限重试无退避、未限制的查询深度/递归深度、内存放大等。指出触发点。",
  },
  dependency: {
    name: "依赖与供应链",
    prompt: "检查依赖风险：package.json/requirements.txt/pom.xml/go.mod 里存在已知高危漏洞的依赖、锁文件缺失、自定义证书校验被关闭的请求、依赖安装脚本风险等。只报告可确认的问题。",
  },
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
    scanEnabled: z.boolean().default(DEFAULT_CONFIG.scanEnabled),
    scanRepos: z.array(z.string()).default([]),
    scanMinSeverity: z.string().default(DEFAULT_CONFIG.scanMinSeverity),
    scanOneIssuePerRun: z.boolean().default(DEFAULT_CONFIG.scanOneIssuePerRun),
    // scanPrompts 是自由格式提示词映射 {id:{name,prompt}}，不放进 schema
    // （此 DSH 的 schemastery 无 z.record；运行时对 object/array 都做归一化）。
    scanWorkerPreset: z.string().default(DEFAULT_CONFIG.scanWorkerPreset),
    scanIntervalMs: z.number().default(DEFAULT_CONFIG.scanIntervalMs),
    scanTimeoutMs: z.number().default(DEFAULT_CONFIG.scanTimeoutMs),
    scanConcurrency: z.number().default(DEFAULT_CONFIG.scanConcurrency),
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
    // scanPrompts 归一化：兼容 {id:{name,prompt}} 与 [{id,name,prompt}] 两种形态
    config.scanPrompts = toPromptMap(config.scanPrompts);
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
    let webServer = ctx.get("webServer");
    const shell = ctx.shell;
    const timer = ctx.timer;
    console.log("[gitee-ai] plugin v" + PLUGIN_VERSION + " loaded | " + ((typeof process !== "undefined" && process.platform) || "?") + " | node " + ((typeof process !== "undefined" && process.version) || "?"));
    ensureWorkerPreset();

    // ── 提示词归一化：兼容 {id:{name,prompt}} 与 [{id,name,prompt}] 两种形态 ──
    function toPromptMap(v) {
      const out = {};
      if (Array.isArray(v)) {
        for (const e of v) {
          const id = String((e && e.id) || "").trim();
          const name = String((e && e.name) || "").trim();
          const prompt = String((e && e.prompt) || "").trim();
          if (id && prompt) out[id] = { name: name || id, prompt };
        }
      } else if (v && typeof v === "object" && !Array.isArray(v)) {
        for (const [id, e] of Object.entries(v)) {
          if (!e || typeof e !== "object") continue;
          const name = String(e.name || "").trim();
          const prompt = String(e.prompt || "").trim();
          if (prompt) out[id] = { name: name || id, prompt };
        }
      }
      return out;
    }

    // ── 宿主 settings 命名空间注册（关键：让「设置 → 插件 → 插件配置」页显示本插件卡片）──
    // 该页只渲染「宿主 serve 的命名空间」对应的 settings.plugin.item 卡片，且要求
    // 卡片 key === 命名空间（gitee-ai-employee）。不注册命名空间，卡片即使已注册也
    // 永远不会被该页派发 —— 旧版桌面端有另一种列表机制，故当时能显示、这里不能。
    ctx.inject(["settings"], (sctx) => {
      try {
        // base 里剔除 schema 未声明的自由格式字段（scanPrompts），避免校验报错
        const baseCfg = Object.assign({}, config);
        delete baseCfg.scanPrompts;
        sctx.settings.register("gitee-ai-employee", GITEE_CONFIG_SCHEMA, { base: baseCfg });
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

    // ── 自包含 agent 预设：把包内 preset 落盘到 $DSH_HOME/.agent-presets ──
    // 保证安装本插件的用户无需手动复制 preset，开箱即可用。
    // gitee-worker：issue 开发 worker；gitee-scanner：代码安全扫描审计员。
    function ensureWorkerPreset() {
      for (const presetId of ["gitee-worker", "gitee-scanner"]) ensurePreset(presetId);
    }
    function ensurePreset(presetId) {
      try {
        const presetDir = join(process.env.DSH_HOME || join(homedir(), ".dsh"), ".agent-presets", presetId);
        const target = join(presetDir, "agent.cordis.yml");
        if (existsSync(target)) {
          console.log("[gitee-ai] preset already present: " + presetDir);
          return;
        }
        const src = fileURLToPath(new URL("../preset/" + presetId + "/agent.cordis.yml", import.meta.url));
        if (!existsSync(src)) {
          console.error("[gitee-ai] bundled preset missing: " + src);
          return;
        }
        mkdirSync(presetDir, { recursive: true });
        copyFileSync(src, target);
        const srcMeta = fileURLToPath(new URL("../preset/" + presetId + "/preset.yml", import.meta.url));
        if (existsSync(srcMeta)) copyFileSync(srcMeta, join(presetDir, "preset.yml"));
        console.log("[gitee-ai] preset installed -> " + presetDir);
      } catch (e) {
        console.error("[gitee-ai] ensurePreset error (" + presetId + "):", String((e && e.message) || e));
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

    // watchRepos/scanRepos 行格式：
    //   "github:owner/repo" / "gitee:owner/repo" / 无前缀按 config.defaultPlatform 判定；
    //   也兼容完整克隆地址：https://gitee.com/owner/repo.git、git@gitee.com:owner/repo.git、
    //   https://github.com/owner/repo.git（按 host 推断平台，显式前缀优先）；
    //   owner/repo 末尾的 .git 与多余斜杠会自动剥除。
    function parseRepoSpec(spec) {
      const s = String(spec || "").trim().replace(/\/+$/, "");
      if (!s) return null;
      let platform = normPlatform(config.defaultPlatform || "gitee");
      let rest = s;
      let prefixed = false;
      const m = /^(github|gitee):(.+)$/i.exec(s);
      if (m) { prefixed = true; platform = normPlatform(m[1]); rest = m[2].trim().replace(/\/+$/, ""); }
      // 完整克隆地址（host / owner / repo 三段提取）
      const urlM = /^(?:https?:\/\/|git@|ssh:\/\/git@|git:\/\/)([^\/:#]+)[:\/]([^\/]+)\/([^\/]+?)(?:\.git)?\/?$/i.exec(rest);
      if (urlM) {
        const host = urlM[1].toLowerCase();
        const owner = urlM[2].trim();
        const repo = urlM[3].trim();
        if (!prefixed) platform = host.includes("github.") ? "github" : "gitee";
        if (!owner || !repo || /[\s.]/.test(owner) || /[\s\\]/.test(repo)) return null;
        return { platform, owner, repo };
      }
      // 以 http(s):// 开头但没匹配成完整地址（缺仓库段等）→ 拒绝，避免拆出畸形 owner/repo
      if (/^https?:\/\//i.test(rest)) return null;
      const idx = rest ? rest.indexOf("/") : -1;
      if (idx <= 0 || idx === rest.length - 1) return null;
      const owner = rest.slice(0, idx).trim();
      const repo = rest.slice(idx + 1).trim().replace(/\.git$/, "");
      if (!owner || !repo || /[\s.]/.test(owner) || /[\s\\]/.test(repo)) return null;
      return { platform, owner, repo };
    }

    let apiSeq = 0;
    async function apiFetch(platform, method, path, body) {
      const info = platformInfo(platform);
      const url = info.base + path;
      const token = info.token;
      // 优先使用 Node 原生 fetch（Electron/Host 主进程 Node 24 自带，稳定且不经
      // PowerShell 管道）；仅在原生 fetch 不可用时回退到 PowerShell+curl。
      if (typeof fetch === "function") {
        const ctrl = new AbortController();
        const to = setTimeout(() => ctrl.abort(), 60000);
        try {
          const headers = {
            "Authorization": "token " + token,
            "Accept": "application/json",
            "User-Agent": "gitee-ai-employee",
          };
          const init = { method, headers, signal: ctrl.signal };
          if (body !== undefined && body !== null) {
            headers["Content-Type"] = "application/json";
            init.body = JSON.stringify(body);
          }
          const res = await fetch(url, init);
          const text = await res.text();
          if (!res.ok) {
            const err = { status: res.status, body: text };
            const hint = (res.status === 404 && method === "POST")
              ? "（若为 Gitee：token 可能缺少 issues/pull_requests 等写权限，请到 gitee.com 私人令牌重新生成并勾选对应 scope）"
              : "";
            err.message = platform + " api HTTP " + res.status + " for " + method + " " + path + " | " + text.slice(0, 200) + hint;
            throw err;
          }
          if (!text) return null;
          try { return JSON.parse(text); } catch (e) { return { raw: text }; }
        } catch (e) {
          if (e && e.status !== undefined) throw e;
          let err;
          if (e && e.name === "AbortError") {
            err = new Error(platform + " api timeout for " + method + " " + path);
          } else {
            err = new Error(platform + " api network error for " + method + " " + path + ": " + String((e && e.message) || e));
          }
          err.status = 0;
          err.body = "";
          throw err;
        } finally {
          clearTimeout(to);
        }
      }
      const stamp = Date.now() + "-" + (++apiSeq);
      const outFile = config.tmpDir + PATH_SEP + "gitee-out-" + stamp + ".json";
      const codeFile = config.tmpDir + PATH_SEP + "gitee-code-" + stamp + ".txt";
      let cmd;
      if (body !== undefined && body !== null) {
        const b64 = Buffer.from(JSON.stringify(body), "utf8").toString("base64");
        const tmp = config.tmpDir + PATH_SEP + "gitee-body-" + stamp + ".json";
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
    // 注意：Gitee 已把「建/改 issue」接口改成 /repos/{owner}/issues（repo 放请求体），
    // 旧的 /repos/{owner}/{repo}/issues 写操作会返回 404 "project or enterprise"。
    function platformApi(platform, owner, repo) {
      const p = normPlatform(platform);
      const gh = p === "github";
      const base = `/repos/${owner}/${repo}`;
      return {
        getIssue: (n) => apiFetch(p, "GET", `${base}/issues/${encodeURIComponent(n)}`),
        listOpenIssues: () => apiFetch(p, "GET", `${base}/issues?state=open&per_page=50`),
        createIssue: (data) => gh
          ? apiFetch(p, "POST", `${base}/issues`, data)
          : apiFetch(p, "POST", `/repos/${owner}/issues`, Object.assign({}, data, { owner, repo })),
        addComment: (n, bodyText) => apiFetch(p, "POST", `${base}/issues/${encodeURIComponent(n)}/comments`, { body: bodyText }),
        createPr: (data) => apiFetch(p, "POST", `${base}/pulls`, data),
        mergePr: (n) => apiFetch(p, "PUT", `${base}/pulls/${encodeURIComponent(n)}/merge`, { merge_method: "merge" }),
        getRepo: () => apiFetch(p, "GET", `${base}`),
        getMe: () => apiFetch(p, "GET", "/user"),
        closeIssue: (n, enterprise) => gh
          ? apiFetch(p, "PATCH", `${base}/issues/${encodeURIComponent(n)}`, { state: "closed" })
          : apiFetch(p, "PATCH", `/repos/${owner}/issues/${encodeURIComponent(n)}`, { repo, state: "closed" }),
        prUrl: (n) => gh ? `https://github.com/${owner}/${repo}/pull/${n}` : `https://gitee.com/${owner}/${repo}/pull/${n}`,
        hostLabel: () => gh ? "GitHub" : "Gitee",
      };
    }

    // 一键获取「我的仓库」：自己 + 协作 + 所属组织的仓库（GitHub affiliation /
    // Gitee type=all），供填入 scanRepos 后人工勾选保留。
    async function fetchMyRepos(platform) {
      const p = normPlatform(platform);
      if (!tokenOkFor(p)) return { ok: false, error: p + " 未配置令牌" };
      const out = [];
      const diag = { at: new Date().toISOString(), platform: p };
      try {
        if (p === "github") {
          for (let page = 1; page <= 5; page++) {
            const data = await apiFetch(p, "GET", `/user/repos?affiliation=owner,collaborator,organization_member&sort=full_name&per_page=100&page=${page}`);
            diag["page" + page] = Array.isArray(data) ? Array(data.length).fill(0).map((_, i) => { const r = data[i]; return String((r && r.full_name) || ""); }).slice(0, 3) : (data === null ? null : (typeof data === "object" ? String(JSON.stringify(data).slice(0, 120)) : String(data)));
            if (!Array.isArray(data) || data.length === 0) break;
            for (const r of data) {
              const fn = String((r && r.full_name) || "").trim();
              if (!fn || !fn.includes("/")) continue;
              const [ow, rp] = fn.split("/");
              out.push({ platform: p, owner: ow, repo: rp, fullName: fn });
            }
            if (data.length < 100) break;
          }
        } else {
          for (let page = 1; page <= 5; page++) {
            const data = await apiFetch(p, "GET", `/user/repos?type=all&per_page=100&page=${page}`);
            diag["page" + page] = Array.isArray(data) ? Array(data.length).fill(0).map((_, i) => { const r = data[i]; return String((r && r.full_name) || ""); }).slice(0, 3) : (data === null ? null : (typeof data === "object" ? String(JSON.stringify(data).slice(0, 120)) : String(data)));
            if (!Array.isArray(data) || data.length === 0) break;
            for (const r of data) {
              const fn = String((r && r.full_name) || "").trim();
              if (!fn || !fn.includes("/")) continue;
              const [ow, rp] = fn.split("/");
              out.push({ platform: p, owner: ow, repo: rp, fullName: fn });
            }
            if (data.length < 100) break;
          }
        }
        diag.ok = true;
        diag.count = out.length;
      } catch (e) {
        diag.ok = false;
        diag.error = String((e && e.message) || e);
        try { writeFileSync(config.tmpDir + PATH_SEP + "gitee-my-repos-" + p + "-last.json", JSON.stringify(diag, null, 2), "utf8"); } catch (e2) {}
        return { ok: false, error: diag.error };
      }
      try { writeFileSync(config.tmpDir + PATH_SEP + "gitee-my-repos-" + p + "-last.json", JSON.stringify(diag, null, 2), "utf8"); } catch (e2) {}
      return { ok: true, repos: out };
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

    function repoDir(owner, repo) { return config.workRoot + PATH_SEP + owner + PATH_SEP + repo; }
    function shellQuote(v) { return `'${String(v).replace(/'/g, "''")}'`; }
    async function ensureRepo(platform, owner, repo) {
      const dir = repoDir(owner, repo);
      // 跨平台检查是否已克隆：直接走文件系统，不依赖 PowerShell / shell 语法（mac / linux 亦可）
      if (existsSync(dir + PATH_SEP + ".git")) {
        await sh(`git -C ${shellQuote(dir)} fetch origin --prune --tags`, { timeoutMs: 300000 });
        return dir;
      }
      mkdirSync(config.workRoot + PATH_SEP + owner, { recursive: true });
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

    async function runWorker({ dir, branchName, taskText, preset }) {
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
          await agentPresets.mount(agentCtx, preset || config.workerPreset);
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

    // ════════════════════════════════════════════════════════════════════
    // 代码安全扫描（v1.2）：
    //   clone 仓库 → 用「内置/自定义提示词」驱动扫描 worker（复用 DSH 模型）
    //   → 解析结构化发现 → 与 scan-state.json 去重 → 把新发现提交 issue。
    //   同一位置（file:line) 同类问题只上报一次，重复扫描不会重复建 issue。
    // ════════════════════════════════════════════════════════════════════
    const scanJobs = new Map();
    const scanActive = new Set();
    const scanQueue = [];      // 待扫描仓库队列：受 scanConcurrency 限制，排队持续扫描
    let scanPollDisposer = null;

    function severityWeight(s) {
      const w = { critical: 4, high: 3, medium: 2, low: 1, none: 0 };
      return w[String(s || "").toLowerCase()] ?? 0;
    }
    function normSeverity(s) {
      const v = String(s || "").toLowerCase();
      return ["critical", "high", "medium", "low"].includes(v) ? v : "low";
    }
    function scanStateFile() {
      return join(config.workRoot, "scan-state.json");
    }
    function loadScanState() {
      try {
        const p = scanStateFile();
        if (existsSync(p)) {
          const doc = JSON.parse(readFileSync(p, "utf8"));
          if (doc && doc.version === 1) return doc;
        }
      } catch (e) { console.error("[gitee-ai] scan-state load error:", String((e && e.message) || e)); }
      return { version: 1, reported: {}, runs: {} };
    }
    function saveScanState(state) {
      try {
        mkdirSync(config.workRoot, { recursive: true });
        writeFileSync(scanStateFile(), JSON.stringify(state, null, 2), "utf8");
      } catch (e) { console.error("[gitee-ai] scan-state save error:", String((e && e.message) || e)); }
    }
    function findingSig(f) {
      const file = String((f && f.file) || "").replace(/\\/g, "/").replace(/^\.\//, "");
      const vuln = String((f && f.vulnType) || "general").trim();
      if (file) return file + ":" + (Number(f && f.line) || 0) + ":" + vuln;
      return ":nofile:" + vuln + ":" + String((f && f.title) || "").slice(0, 80);
    }
    function resolveScanPrompts(ids, customPrompt) {
      const merged = Object.assign({}, BUILTIN_SCAN_PROMPTS, config.scanPrompts || {});
      const selected = Array.isArray(ids) && ids.length ? ids : Object.keys(merged);
      const out = [];
      for (const id of selected) {
        const e = merged[id];
        if (!e) continue;
        out.push({ id, name: e.name || id, prompt: String(e.prompt || "") });
      }
      if (customPrompt && String(customPrompt).trim()) {
        out.push({ id: "custom", name: "自定义提示词", prompt: String(customPrompt).trim() });
      }
      return out;
    }
    function buildScanTask({ p, owner, repo, dir, commit, prompts, resultFile }) {
      const host = p === "github" ? "GitHub" : "Gitee";
      const list = prompts.map((x, i) => `${i + 1}. [${x.id}] ${x.name}\n   ${x.prompt}`).join("\n");
      return [
        `你是 ${host} 仓库 ${owner}/${repo} 的安全代码审计员。仓库已克隆到 ${dir}，当前提交 ${commit || "HEAD"}。`,
        ``,
        `任务：按下列提示词逐项审计代码，寻找真实的安全漏洞。只做静态代码审计。`,
        `绝对不要修改任何仓库文件（扫描结果文件除外）；不要执行 git add/commit/push；不要动 git 状态。`,
        ``,
        `审计提示词（逐项执行）：`,
        list,
        ``,
        `输出要求：`,
        `1. 把结果写入文件 ${resultFile}（用文件写入/编辑工具创建或覆盖该文件）——必须是严格 JSON。`,
        `2. 格式：{"findings":[{"vulnType":"sqli","severity":"high","title":"一句话标题","file":"相对路径如 src/app.js","line":123,"description":"漏洞说明：触发点/输入来源/危害","suggestion":"修复建议"}]}`,
        `3. severity 只允许 critical/high/medium/low 之一。`,
        `4. 只报告真实、可定位到 file:line 的问题；没有把握或纯风格问题不要报，宁缺毋滥。`,
        `5. 同一文件同一行同类问题只报一条，避免重复。`,
        `6. 硬编码密钥类发现：description 里只写密钥类型与位置，严禁粘贴密钥/令牌/口令原文。`,
        `7. 全部审计完没有发现任何漏洞时，写入 {"findings":[]}。`,
      ].join("\n");
    }
    async function readScanResult(resultFile) {
      try {
        const text = readFileSync(resultFile, "utf8").trim();
        if (!text) return { findings: [], note: "empty-result" };
        const parsed = JSON.parse(text);
        const arr = Array.isArray(parsed) ? parsed : (Array.isArray(parsed.findings) ? parsed.findings : []);
        const findings = arr.filter((f) => f && f.title).map((f) => ({
          vulnType: String(f.vulnType || "general").slice(0, 60),
          severity: normSeverity(f.severity),
          title: String(f.title).slice(0, 200),
          file: String(f.file || "").replace(/\\/g, "/").replace(/^\.\//, ""),
          line: Number(f.line) || 0,
          description: String(f.description || "").slice(0, 2000),
          suggestion: String(f.suggestion || "").slice(0, 1000),
        }));
        return { findings, note: "" };
      } catch (e) {
        return { findings: [], note: "parse-error: " + String((e && e.message) || e) };
      }
    }
    function buildFindingsBody(owner, repo, findings, commit) {
      const esc = (v) => String(v ?? "").replace(/[|]/g, "\\|").replace(/[\r\n]+/g, " ").slice(0, 400);
      const sevEmoji = { critical: "🔴", high: "🟠", medium: "🟡", low: "🔵" };
      const rows = findings.map((f) =>
        `| ${sevEmoji[f.severity] || ""} ${f.severity} | \`${esc(f.file) || "(未知)"}:${f.line || "-"}\` | ${esc(f.title)} | \`${esc(f.vulnType)}\` |`
      ).join("\n");
      const details = findings.map((f, i) => {
        const lines = [
          `### ${i + 1}. [${f.severity}] ${f.title}`,
          ``,
          `- 类型：\`${esc(f.vulnType)}\`　位置：\`${esc(f.file) || "(未知)"}:${f.line || "-"}\``,
          ``,
          (f.description || "").trim() || "(无描述)",
        ];
        if ((f.suggestion || "").trim()) {
          lines.push("", `**修复建议：** ${f.suggestion.trim()}`);
        }
        return lines.join("\n");
      }).join("\n\n");
      return [
        `🤖 **代码安全扫描报告** — ${owner}/${repo} @ \`${(commit || "HEAD").slice(0, 8)}\``,
        ``,
        `本次扫描共发现 **${findings.length}** 个新问题（同一位置/同类问题不会重复上报）。`,
        ``,
        `| 级别 | 位置 | 问题 | 类型 |`,
        `| --- | --- | --- | --- |`,
        rows,
        ``,
        `---`,
        ``,
        details,
      ].join("\n");
    }

    async function scanRepo(platform, owner, repo, opts = {}) {
      const p = normPlatform(platform);
      const api = platformApi(p, owner, repo);
      const key = owner + "/" + repo;
      if (!tokenOkFor(p)) return { skipped: "no-token" };
      if (scanActive.has(key)) return { skipped: "busy" };
      scanActive.add(key);
      // 复用排队时创建的 job（否则新建），确保队列状态可见、不重复
      let job = scanJobs.get(key) || null;
      if (!job) {
        job = { key, platform: p, status: "scanning", step: "prepare", startedAt: Date.now(), updatedAt: Date.now(), detail: "", dryRun: !!opts.dryRun, force: !!opts.force };
        scanJobs.set(key, job);
      } else {
        Object.assign(job, { status: "scanning", step: "prepare", startedAt: Date.now(), updatedAt: Date.now(), detail: "", dryRun: !!opts.dryRun, force: !!opts.force });
      }
      const update = (patch) => { Object.assign(job, patch); job.updatedAt = Date.now(); };
      const state = loadScanState();
      try {
        update({ step: "clone" });
        const dir = await ensureRepo(p, owner, repo);
        let commit = "";
        try {
          const cv = await sh(`git -C ${shellQuote(dir)} rev-parse HEAD`, { timeoutMs: 15000 });
          commit = ((cv && cv.stdout && cv.stdout.text) || "").trim();
        } catch (e) {}
        const prompts = resolveScanPrompts(opts.prompts, opts.customPrompt);
        update({ step: "scanning", detail: "prompts: " + prompts.map((x) => x.id).join(",") });
        const scanDir = join(dir, ".gitee-scan");
        const resultFile = join(scanDir, "result.json");
        try { mkdirSync(scanDir, { recursive: true }); } catch (e) {}
        const taskText = buildScanTask({ p, owner, repo, dir, commit, prompts, resultFile });
        let summary;
        try {
          summary = await Promise.race([
            runWorker({ dir, branchName: "", taskText, preset: config.scanWorkerPreset }),
            new Promise((resolve) => timer.timeout(() => resolve({
              text: "扫描超时，worker 未在限定时间内完成。", completed: false, errorMsg: "timeout",
            }), config.scanTimeoutMs)),
          ]);
        } catch (e) {
          summary = { text: "扫描 worker 运行异常：" + String((e && e.message) || e), completed: false, errorMsg: "exception" };
        }
        update({ step: "collect" });
        const { findings, note } = await readScanResult(resultFile);
        if (note) update({ step: "dedup", detail: note });
        const newFindings = [];
        let dupCount = 0;
        for (const f of findings) {
          if (severityWeight(f.severity) < severityWeight(config.scanMinSeverity)) { f.skip = "below-minimum"; continue; }
          const sig = findingSig(f);
          const prev = state.reported[key] && state.reported[key][sig];
          if (prev && !opts.force) { f.skip = "duplicate"; dupCount++; continue; }
          newFindings.push(f);
        }
        update({ step: "report", detail: "found=" + findings.length + " new=" + newFindings.length + (opts.dryRun ? " (dry-run)" : "") });
        let issueNumber = null;
        let issueUrl = "";
        const issueRefs = [];
        if (newFindings.length && !opts.dryRun) {
          if (config.scanOneIssuePerRun) {
            const title = `[安全扫描] ${owner}/${repo}：${newFindings.length} 个新发现`;
            const created = await api.createIssue({ title, body: buildFindingsBody(owner, repo, newFindings, commit) });
            issueNumber = created && created.number;
            issueUrl = (created && created.html_url) || "";
            for (const f of newFindings) issueRefs.push({ finding: f, issueNumber, issueUrl });
          } else {
            for (const f of newFindings) {
              const created = await api.createIssue({
                title: `[安全扫描] ${owner}/${repo}：${f.severity} ${f.title}`,
                body: buildFindingsBody(owner, repo, [f], commit),
              });
              issueRefs.push({ finding: f, issueNumber: created && created.number, issueUrl: (created && created.html_url) || "" });
            }
          }
        }
        // 记录去重状态（dry-run 不标记 reported，正式跑时可上报）
        if (!opts.dryRun && issueRefs.length) {
          state.reported[key] = state.reported[key] || {};
          for (const ref of issueRefs) {
            const sig = findingSig(ref.finding);
            state.reported[key][sig] = {
              vulnType: ref.finding.vulnType, severity: ref.finding.severity, title: ref.finding.title,
              file: ref.finding.file, line: ref.finding.line,
              description: (ref.finding.description || "").slice(0, 2000),
              suggestion: (ref.finding.suggestion || "").slice(0, 1000),
              issueNumber: ref.issueNumber, issueUrl: ref.issueUrl, reportedAt: Date.now(), commit,
            };
          }
        }
        state.runs[key] = {
          at: Date.now(), commit, durationMs: Date.now() - job.startedAt,
          found: findings.length, reported: newFindings.length, duplicates: dupCount,
          note: note || "", dryRun: !!opts.dryRun, issueNumber,
          workerSummary: (summary.text || "").slice(0, 500),
        };
        saveScanState(state);
        update({ status: "done", detail: "found=" + findings.length + " new=" + newFindings.length + " issue=" + (issueNumber || (opts.dryRun ? "dry-run" : "none")), issueNumber, issueUrl });
        console.log("[gitee-ai] scan done: " + key + " found=" + findings.length + " new=" + newFindings.length + " issue=" + (issueNumber || "none"));
        return { ok: true, key, scanned: findings.length, new: newFindings.length, issueNumber, issueUrl, commit, dryRun: !!opts.dryRun, note };
      } catch (e) {
        state.runs[key] = { at: Date.now(), error: String((e && e.message) || e) };
        saveScanState(state);
        update({ status: "failed", detail: String((e && e.message) || e) });
        console.error("[gitee-ai] scan error: " + key, e);
        return { failed: true, error: String((e && e.message) || e) };
      } finally {
        scanActive.delete(key);
      }
    }

    function scanJobsList() {
      const rows = [];
      for (const job of scanJobs.values()) {
        rows.push({ key: job.key, status: job.status, step: job.step, startedAt: job.startedAt, dryRun: job.dryRun, issueNumber: job.issueNumber, detail: (job.detail || "").slice(0, 300) });
      }
      return rows.slice(-30).reverse();
    }
    function scanStateSummary() {
      const s = loadScanState();
      const out = {};
      for (const key of Object.keys(s.reported || {})) {
        const list = Object.values(s.reported[key] || {});
        const bySeverity = {};
        for (const r of list) bySeverity[r.severity] = (bySeverity[r.severity] || 0) + 1;
        out[key] = { reported: list.length, bySeverity, lastRun: s.runs && s.runs[key] };
      }
      const runs = {};
      for (const key of Object.keys(s.runs || {})) runs[key] = s.runs[key];
      return { reported: out, runs };
    }

    // ── 扫描调度：并发受限的持续队列 ──────────────────────────────────────
    // scanRepos 可配任意多个仓库：定时 tick 把全部仓库排进 scanQueue，
    // 同时最多执行 scanConcurrency 个（默认 3），一个扫完自动接下一个，
    // 队列一路排到底把整个列表扫完；重复扫描由 scan-state.json 去重保持幂等。
    function scanConcurrencyLimit() {
      const n = Number(config.scanConcurrency);
      return Number.isFinite(n) && n > 0 ? Math.min(Math.floor(n), 8) : 3;
    }
    function scanQueuedOrActive(key) {
      if (scanActive.has(key)) return true;
      return scanQueue.some((q) => q.key === key);
    }
    function scanEnqueue(platform, owner, repo, opts = {}) {
      const p = normPlatform(platform);
      const key = owner + "/" + repo;
      if (!tokenOkFor(p)) return { accepted: false, reason: "no-token", key };
      if (scanActive.has(key)) return { accepted: false, reason: "busy", key };
      if (scanQueue.some((q) => q.key === key)) return { accepted: false, reason: "queued", key };
      const job = {
        key, platform: p, status: "queued", step: "waiting",
        queuedAt: Date.now(), updatedAt: Date.now(), detail: "",
        dryRun: !!opts.dryRun, force: !!opts.force,
      };
      scanQueue.push({ key, platform: p, owner, repo, opts });
      scanJobs.set(key, job);
      scanPump();
      return { accepted: true, key, queued: true };
    }
    function scanPump() {
      while (scanActive.size < scanConcurrencyLimit() && scanQueue.length > 0) {
        const item = scanQueue.shift();
        if (!item) continue;
        if (scanActive.has(item.key)) continue;
        const job = scanJobs.get(item.key);
        if (job) { job.status = "starting"; job.updatedAt = Date.now(); }
        void scanRepo(item.platform, item.owner, item.repo, item.opts || {})
          .catch((e) => console.error("[gitee-ai] scan task error " + item.key + ":", String((e && e.message) || e)))
          .finally(() => scanPump());
      }
    }
    function scanQueueSummary() {
      return {
        length: scanQueue.length,
        active: scanActive.size,
        concurrency: scanConcurrencyLimit(),
        items: scanQueue.map((q) => q.key),
      };
    }

    // 定时扫描：scanEnabled 时按 scanIntervalMs 把 scanRepos 全部排进队列持续扫描。
    // 去重让重复扫描是幂等的：同一位置同类问题不会重复建 issue。
    async function scanPollOnce() {
      if (!config.scanEnabled) return;
      const repos = Array.isArray(config.scanRepos) ? config.scanRepos : [];
      let added = 0;
      for (const spec of repos) {
        const parsed = parseRepoSpec(spec);
        if (!parsed) { console.log("[gitee-ai] scan: bad repo spec '" + spec + "', skip"); continue; }
        const { platform: p, owner, repo: rname } = parsed;
        if (!tokenOkFor(p)) { console.log("[gitee-ai] scan: " + p + " token missing for " + spec); continue; }
        const key = owner + "/" + rname;
        if (scanQueuedOrActive(key)) continue;
        const r = scanEnqueue(p, owner, rname, {});
        if (r && r.accepted) added++;
      }
      if (added > 0 || scanQueue.length > 0) {
        console.log("[gitee-ai] scheduled scan enqueued +" + added + " (queued=" + scanQueue.length + ", active=" + scanActive.size + "/" + scanConcurrencyLimit() + ")");
      }
    }
    function restartScanPolling() {
      if (scanPollDisposer) { try { scanPollDisposer(); } catch (e) {} scanPollDisposer = null; }
      if (config.scanEnabled && (tokenOk() || tokenOkFor("github"))) {
        scanPollDisposer = timer.interval(() => { void scanPollOnce(); }, Math.max(60000, config.scanIntervalMs || 21600000));
        console.log("[gitee-ai] scheduled scan every " + Math.round((config.scanIntervalMs || 21600000) / 60000) + "min for " + (config.scanRepos || []).length + " repo(s), concurrency=" + scanConcurrencyLimit());
        void scanPollOnce();
      } else {
        console.log("[gitee-ai] scheduled scan off");
      }
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
        const entries = findPluginEntries(doc);
        if (entries.length) {
          for (const entryMap of entries) {
            let configMap = entryMap.get("config", true);
            if (!configMap || !configMap.set) {
              configMap = doc.createNode({});
              entryMap.set("config", configMap);
            }
            for (const [k, v] of Object.entries(nextConfig)) {
              if (v === undefined) continue;
              configMap.set(k, v);
            }
          }
          await writeFile(p, doc.toString());
          written.push(p);
        }
      }
      if (!written.length) {
        // 兜底：任何 patch 里都没有本插件条目（全新安装/非 overlay 布局）
        // → 把条目 + config 直接补写进第一个 patch 文件，保证配置可落盘、可重启生效。
        const p = paths[0];
        let doc;
        try { doc = yaml.parseDocument(await readFile(p)); } catch (e) { doc = new yaml.Document(); }
        if (!doc.contents) doc.contents = doc.createNode([]);
        if (!yaml.isSeq(doc.contents)) doc.contents = doc.createNode([doc.contents]);
        const block = doc.createNode([{ insert: [{ id: "gitee-ai-employee", name: "gitee-ai-employee", config: nextConfig }] }]);
        doc.contents.add(block.items[0]);
        await writeFile(p, doc.toString());
        written.push(p);
      }
      return written.join("; ");
    }
    // 在 patch 文档中查找所有 gitee-ai-employee 条目节点。
    // 兼容：顶层为 `- insert:` 序列、顶层为单个 `insert:` 映射、以及存在多个 insert 块的文档。
    function findPluginEntries(doc) {
      const out = [];
      const scan = (nodes) => {
        if (!nodes) return;
        for (const item of nodes) {
          if (!item || !item.get) continue;
          const ins = item.get("insert");
          if (ins && ins.items) {
            for (const e of ins.items) {
              try {
                const j = e && e.toJSON && e.toJSON();
                if (j && j.id === "gitee-ai-employee") out.push(e);
              } catch (err) { /* 跳过无法序列化的节点 */ }
            }
          }
        }
      };
      const root = doc && doc.contents;
      if (yaml.isSeq(root)) scan(root && root.items);
      else scan([root].filter(Boolean));
      return out;
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
      const toJson = (v) => { try { return v ? JSON.stringify(v, null, 2) : ""; } catch (e) { return ""; } };
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
<div class="card"><h2>代码安全扫描（v1.2）</h2>
<div class="check"><input type="checkbox" name="scanEnabled" ${c.scanEnabled ? "checked" : ""}><span>启用定时扫描（把下方全部仓库排进队列，周期持续扫描，去重幂等）</span></div>
<label>扫描仓库（[gitee:|github:]owner/repo，每行一个）</label>
<div style="display:flex;gap:8px;align-items:center;margin:4px 0;flex-wrap:wrap"><button type="button" id="scanFetchRepos" style="background:#2f6fed;color:#fff;border:0;border-radius:8px;padding:6px 12px;font-size:12px;cursor:pointer">一键获取我的仓库</button><span id="scanFetchNote" style="color:#8b949e;font-size:12px">拉取自己有权限的仓库（含所属组织）填入下方，去掉不需要的再保存</span></div>
<textarea name="scanRepos" id="scanReposInput" rows="6" style="width:100%;box-sizing:border-box;background:#0d1117;border:1px solid #2a313c;border-radius:8px;color:#e6e8ec;padding:8px 10px;font-size:13px">${esc(Array.isArray(c.scanRepos) ? c.scanRepos.join("\n") : "")}</textarea>
<label>最低上报级别</label><select name="scanMinSeverity" style="width:100%;box-sizing:border-box;background:#0d1117;border:1px solid #2a313c;border-radius:8px;color:#e6e8ec;padding:8px 10px;font-size:14px">
${["critical", "high", "medium", "low", "none"].map((s) => `<option value="${s}" ${(c.scanMinSeverity || "medium") === s ? "selected" : ""}>${s}</option>`).join("")}
</select>
<div class="check"><input type="checkbox" name="scanOneIssuePerRun" ${c.scanOneIssuePerRun !== false ? "checked" : ""}><span>一次扫描的新发现合并为一个 issue</span></div>
<label>同时扫描的仓库数（并发上限 1~8，默认 3；配很多仓库时自动排成队列逐个持续扫描）</label><input type="number" name="scanConcurrency" min="1" max="8" value="${esc(c.scanConcurrency || 3)}">
<label>扫描间隔（毫秒，默认 21600000 = 6 小时）</label><input type="number" name="scanIntervalMs" value="${esc(c.scanIntervalMs || 21600000)}">
<label>自定义/覆盖提示词（JSON：{"id":{"name":"名称","prompt":"提示词"}}，留空用内置）</label><textarea name="scanPrompts" rows="5" style="width:100%;box-sizing:border-box;background:#0d1117;border:1px solid #2a313c;border-radius:8px;color:#e6e8ec;padding:8px 10px;font-size:12px;font-family:Consolas,monospace">${esc(toJson(c.scanPrompts))}</textarea>
<div class="hint">内置提示词 id：general / sqli / xss / command-injection / path-traversal / ssrf / hardcoded-secret / insecure-deserialization / authz / dos / dependency。填相同 id 即覆盖内置，自定义 id 即新增。</div>
<div class="hint">手动触发：<span class="mono">POST /gitee-ai/scan {owner,repo}</span>（dryRun=true 不建 issue；多仓库自动排队）；结果/状态见 <span class="mono">GET /gitee-ai/scan</span> 与 workRoot/scan-state.json</div>
</div>
<button type="submit">保存配置</button>
</form>
<p class="hint">状态查询：<span class="mono">/gitee-ai-status</span>（JSON）</p>
<script>
(function () {
  function normLine(s) { return String(s || '').replace(/^(gitee|github):/i, '').toLowerCase(); }
  var btn = document.getElementById('scanFetchRepos');
  if (!btn) return;
  btn.addEventListener('click', function () {
    var ta = document.getElementById('scanReposInput');
    var note = document.getElementById('scanFetchNote');
    btn.disabled = true; btn.textContent = '获取中…';
    fetch('/gitee-ai/my-repos')
      .then(function (r) { return r.json().catch(function () { return { ok: false, error: '响应异常' }; }); })
      .then(function (b) {
        if (!b.ok || !Array.isArray(b.repos)) { note.textContent = '获取失败：' + ((b && b.error) || '未知错误'); return; }
        var cur = (ta.value || '').split(/\r?\n/).map(function (s) { return s.trim(); }).filter(Boolean);
        var seen = {}; cur.forEach(function (s) { seen[normLine(s)] = true; });
        var lines = cur.slice();
        b.repos.forEach(function (x) {
          var line = x.platform + ':' + x.owner + '/' + x.repo;
          if (!seen[normLine(line)]) { lines.push(line); seen[normLine(line)] = true; }
        });
        ta.value = lines.join('\n');
        note.textContent = '已填入 ' + b.repos.length + ' 个仓库（含既有保留，请去掉不需要的再保存）';
      })
      .catch(function (e) { note.textContent = '获取失败：' + String(e.message || e); })
      .finally(function () { btn.disabled = false; btn.textContent = '一键获取我的仓库'; });
  });
})();
</script>
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
          // ── 扫描字段 ──
          next.scanEnabled = form.scanEnabled === "on";
          next.scanRepos = (form.scanRepos || "").split(/\r?\n/).map(s => s.trim()).filter(Boolean);
          if (form.scanMinSeverity && ["critical", "high", "medium", "low", "none"].includes(form.scanMinSeverity)) next.scanMinSeverity = form.scanMinSeverity;
          next.scanOneIssuePerRun = form.scanOneIssuePerRun === "on";
          if (form.scanConcurrency) next.scanConcurrency = Math.min(Math.max(Number(form.scanConcurrency) || 3, 1), 8);
          if (form.scanIntervalMs) next.scanIntervalMs = Number(form.scanIntervalMs) || next.scanIntervalMs;
          if (form.scanPrompts && form.scanPrompts.trim()) {
            try {
              const parsed = JSON.parse(form.scanPrompts);
              const sp = {};
              if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
                for (const [id, v] of Object.entries(parsed)) {
                  const name = String((v && v.name) || "").trim();
                  const prompt = String((v && v.prompt) || "").trim();
                  if (name && prompt) sp[id] = { name, prompt };
                }
                next.scanPrompts = sp;
              }
            } catch (e) { /* 提示词解析失败则保持原值 */ }
          }
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
          config.scanEnabled = next.scanEnabled;
          config.scanRepos = next.scanRepos;
          config.scanMinSeverity = next.scanMinSeverity;
          config.scanOneIssuePerRun = next.scanOneIssuePerRun;
          config.scanConcurrency = next.scanConcurrency;
          config.scanIntervalMs = next.scanIntervalMs;
          config.scanPrompts = next.scanPrompts;
          restartPolling();
          restartScanPolling();
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
    // （webServer 为可选服务且通常在 apply 之后才就绪：先立即尝试，未就绪时
    //   用 ctx.inject 等它出现后再补注册，保证 /gitee-ai/config 等路由终态可用）
    let finalHookPath = null;
    let finalGoPath = null;
    let finalStatusPath = null;
    const registerAllRoutes = () => {
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
    finalHookPath = hookDisposer ? hookPath : null;

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
    finalGoPath = goDisposer ? goPath : null;

    ctx.on("dispose", () => {
      if (hookDisposer) try { hookDisposer(); } catch (e) {}
      if (goDisposer) try { goDisposer(); } catch (e) {}
      if (pollDisposer) try { pollDisposer(); } catch (e) {}
      if (scanPollDisposer) try { scanPollDisposer(); } catch (e) {}
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
    finalStatusPath = statusDisposer ? statusPath : null;
    if (statusDisposer) {
      ctx.on("dispose", () => { try { statusDisposer(); } catch (e) {} });
      console.log("[gitee-ai] status endpoint at " + finalStatusPath);
    }

    // ── 扫描 API（固定路径，client 设置卡片调用）──
    //   POST /gitee-ai/scan {spec}（原始仓库行，统一解析）或 {platform?,owner,repo,dryRun?,force?,prompts?,customPrompt?}
    //   GET  /gitee-ai/scan → 提示词清单 + 扫描任务 + 去重状态
    let scanApiDisposer = null;
    if (webServer) {
      try {
        scanApiDisposer = webServer.register({
          kind: "exact",
          path: "/gitee-ai/scan",
          handler: async (req, res) => {
            const method = (req.method || "GET").toUpperCase();
            if (method === "POST") {
              try {
                const raw = await readBody(req);
                let body = {};
                const ct = (req.headers["content-type"] || "").toLowerCase();
                if (ct.includes("application/json")) {
                  try { body = JSON.parse(raw || "{}"); } catch (e) { body = {}; }
                } else if (raw) body = parseForm(raw);
                let platform = normPlatform(body.platform || config.defaultPlatform);
                let owner = String(body.owner || "").trim();
                let repo = String(body.repo || "").trim();
                // 支持直接传原始仓库行（client「立即扫描全部仓库」就是传 spec 行）：
                // 统一走 parseRepoSpec，兼容 owner/repo、gitee:/github: 前缀、完整克隆地址。
                // （不能在这里对 URL 用 indexOf('/') 切分——会把 https://… 切成 owner='https:'）
                if (body.spec !== undefined && String(body.spec).trim()) {
                  const parsed = parseRepoSpec(String(body.spec));
                  if (!parsed) {
                    send(res, 400, { ok: false, error: "无法解析仓库：" + String(body.spec) + "（支持 owner/repo、gitee:owner/repo、完整克隆地址）" });
                    return;
                  }
                  platform = parsed.platform;
                  owner = parsed.owner;
                  repo = parsed.repo;
                }
                if (!owner || !repo) { send(res, 400, { ok: false, error: "owner/repo required" }); return; }
                const opts = {
                  dryRun: body.dryRun === true || body.dryRun === "true",
                  force: body.force === true || body.force === "true",
                  prompts: Array.isArray(body.prompts) ? body.prompts.map(String) : undefined,
                  customPrompt: typeof body.customPrompt === "string" ? body.customPrompt : undefined,
                };
                const key = owner + "/" + repo;
                const enc = scanEnqueue(platform, owner, repo, opts);
                if (!enc.accepted) {
                  send(res, 200, { ok: true, accepted: false, reason: enc.reason, key, queue: scanQueueSummary() });
                  return;
                }
                console.log("[gitee-ai] scan enqueued: " + key + " dryRun=" + opts.dryRun + " (queued=" + scanQueue.length + ", active=" + scanActive.size + "/" + scanConcurrencyLimit() + ")");
                send(res, 200, { ok: true, accepted: true, key, dryRun: opts.dryRun, queued: true, queue: scanQueueSummary(), note: "已入队，同时最多扫描 " + scanConcurrencyLimit() + " 个仓库，扫完自动接下一个；状态见 GET /gitee-ai/scan" });
              } catch (e) {
                console.error("[gitee-ai] scan handler error:", e);
                send(res, 500, { ok: false, error: String((e && e.message) || e) });
              }
              return;
            }
            const prompts = Object.assign({}, BUILTIN_SCAN_PROMPTS, config.scanPrompts || {});
            send(res, 200, { ok: true, config: scanConfigSummary(), prompts, jobs: scanJobsList(), state: scanStateSummary(), queue: scanQueueSummary() });
          },
        });
      } catch (e) {
        console.error("[gitee-ai] cannot register scan api:", (e && e.message) || e);
        scanApiDisposer = null;
      }
      if (scanApiDisposer) {
        ctx.on("dispose", () => { try { scanApiDisposer(); } catch (e) {} });
        console.log("[gitee-ai] scan api at /gitee-ai/scan");
      }

      // ── 我的仓库 API：一键拉取当前账号有权限的仓库（填 scanRepos 后人工勾选）──
      //   GET /gitee-ai/my-repos?platform=gitee|github（缺省：全部已配 token 的平台）
      let myReposApiDisposer = null;
      if (webServer) {
        try {
          myReposApiDisposer = webServer.register({
            kind: "exact",
            path: "/gitee-ai/my-repos",
            handler: async (req, res) => {
              try {
                const q = queryParams(req.url || "");
                const want = normPlatform((q.platform || "").trim());
                const platforms = [];
                if (want && (want === "gitee" || want === "github")) {
                  platforms.push(want);
                } else {
                  if (tokenOkFor("gitee")) platforms.push("gitee");
                  if (tokenOkFor("github")) platforms.push("github");
                }
                if (!platforms.length) { send(res, 200, { ok: false, error: "未配置 gitee/github 令牌" }); return; }
                const repos = [];
                const errors = [];
                for (const p of platforms) {
                  const r = await fetchMyRepos(p);
                  if (r.ok) repos.push(...r.repos);
                  else errors.push(p + ": " + r.error);
                }
                send(res, 200, { ok: true, total: repos.length, repos, errors });
              } catch (e) {
                console.error("[gitee-ai] my-repos handler error:", e);
                send(res, 500, { ok: false, error: String((e && e.message) || e) });
              }
            },
          });
        } catch (e) {
          console.error("[gitee-ai] cannot register my-repos api:", (e && e.message) || e);
          myReposApiDisposer = null;
        }
        if (myReposApiDisposer) {
          ctx.on("dispose", () => { try { myReposApiDisposer(); } catch (e) {} });
          console.log("[gitee-ai] my-repos api at /gitee-ai/my-repos");
        }
      }
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
              // ── 扫描配置 ──
              if (typeof body.scanEnabled === "boolean") next.scanEnabled = body.scanEnabled;
              if (Array.isArray(body.scanRepos)) next.scanRepos = body.scanRepos.map(String).map(s => s.trim()).filter(Boolean);
              if (typeof body.scanMinSeverity === "string") {
                const v = String(body.scanMinSeverity).toLowerCase();
                if (["critical", "high", "medium", "low", "none"].includes(v)) next.scanMinSeverity = v;
              }
              if (typeof body.scanOneIssuePerRun === "boolean") next.scanOneIssuePerRun = body.scanOneIssuePerRun;
              if (body.scanPrompts && typeof body.scanPrompts === "object" && !Array.isArray(body.scanPrompts)) {
                const sp = {};
                for (const [id, v] of Object.entries(body.scanPrompts)) {
                  const name = String((v && v.name) || "").trim();
                  const prompt = String((v && v.prompt) || "").trim();
                  if (name && prompt) sp[id] = { name, prompt };
                }
                next.scanPrompts = sp;
              }
              if (body.scanIntervalMs !== undefined) next.scanIntervalMs = Number(body.scanIntervalMs) || next.scanIntervalMs;
              if (body.scanTimeoutMs !== undefined) next.scanTimeoutMs = Number(body.scanTimeoutMs) || next.scanTimeoutMs;
              if (body.scanConcurrency !== undefined) next.scanConcurrency = Math.min(Math.max(Number(body.scanConcurrency) || 3, 1), 8);
              const savedTo = await saveConfigToPatch(next);
              Object.assign(config, next);
              restartPolling();
              restartScanPolling();
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
    };
    if (webServer) {
      try { registerAllRoutes(); }
      catch (e) { console.error("[gitee-ai] route registration failed:", String((e && e.message) || e)); }
    } else {
      // webServer 在 apply 时尚未就绪：等它出现后再补注册（机制同 settings）
      ctx.inject(["webServer"], (wctx) => {
        if (webServer) return;
        webServer = (wctx && wctx.get ? wctx.get("webServer") : undefined) || ctx.get("webServer") || webServer;
        if (!webServer) return;
        try { registerAllRoutes(); }
        catch (e) { console.error("[gitee-ai] late route registration failed:", String((e && e.message) || e)); }
      });
    }
    function configSummary() {
      return {
        botName: config.botName, webhookPath: finalHookPath, triggerPath: finalGoPath,
        workRoot: config.workRoot, autoMerge: config.autoMerge,
        autoCloseIssue: !!config.autoCloseIssue, tokenConfigured: tokenOk(),
        githubTokenConfigured: tokenOkFor("github"),
        version: PLUGIN_VERSION,
        defaultPlatform: config.defaultPlatform || "gitee",
        gitUser: config.gitUser || "", pollEnabled: !!config.pollEnabled,
        pollIntervalMs: config.pollIntervalMs,
        watchRepos: Array.isArray(config.watchRepos) ? config.watchRepos : [],
        ...scanConfigSummary(),
      };
    }
    function scanConfigSummary() {
      return {
        scanEnabled: !!config.scanEnabled,
        scanRepos: Array.isArray(config.scanRepos) ? config.scanRepos : [],
        scanMinSeverity: config.scanMinSeverity || "medium",
        scanOneIssuePerRun: config.scanOneIssuePerRun !== false,
        scanPrompts: config.scanPrompts || {},
        scanWorkerPreset: config.scanWorkerPreset || "gitee-scanner",
        scanIntervalMs: config.scanIntervalMs || 21600000,
        scanTimeoutMs: config.scanTimeoutMs || 1800000,
        scanConcurrency: scanConcurrencyLimit(),
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
    restartScanPolling();
    console.log("[gitee-ai] plugin ready (composition). tokenConfigured=" + tokenOk() + " polling=" + config.pollEnabled + " scan=" + config.scanEnabled);
  },
};
