// Browser half of the Gitee AI employee dsh plugin: a settings card in the
// installed-plugins list (设置 → 已安装插件). The card reuses the exact
// PluginCard.module.css class names injected by @deepseek-ai/dsh-client-ui
// -settings-plugins (YyYd_a_*), so it renders pixel-identical to the built-in
// Shell / Agent loop / Web search cards — a border, a 12px radius, a big bold
// name header with a description, a collapsing body of fields, and a
// discard/save footer.
//
// Hand-written in the lazy-CJS bundle protocol (window.__ModuleLoader__.load
// with a factory returning cordis-plugin exports), so no build step and no
// imports from dsh client packages — the same zero-dependency stance as the
// host half. `slots` is optional (registered lazily via ctx.inject), so a
// non-web profile simply never renders the card.
window.__ModuleLoader__.load({
  id: 'gitee-ai-employee',
  factory: (require) => {
    var module = { exports: {} }
    var exports = module.exports

    function labels() {
      return {
        title: 'Gitee AI 员工',
        description: 'issue @员工 → AI 开发 → PR → 自动关闭',
        expand: '展开',
        collapse: '收起',
        unsaved: '未保存',
        loading: '加载中…',
        loadFailed: '配置加载失败',
        discard: '放弃',
        save: '保存',
        saving: '保存中…',
        savedDone: '保存完成，已生效',
        readOnly: '只读',
        token: 'Gitee 私人令牌',
        tokenHint: '留空保持原值',
        bot: '机器人账号',
        botHint: 'issue 里 @ 它才触发',
        workRoot: '仓库工作目录',
        repos: '监听仓库',
        reposHint: '每行一个 owner/repo',
        poll: '启用定时轮询',
        interval: '轮询间隔（毫秒）',
        merge: '自动合并 PR',
        close: '成功后自动关闭 issue',
        status: '查看任务状态',
        common: '连接与公共配置',
        issueBlock: '处理 Issue（自动开发 · 提 PR）',
        scan: '代码安全扫描',
        scanEnable: '启用定时扫描（全部仓库排队持续扫描，去重幂等）',
        scanReposLabel: '扫描仓库',
        scanReposHint: '每行一个 owner/repo 或完整克隆地址（https://gitee.com/owner/repo.git、git@github.com:owner/repo.git 均可），[gitee:|github:] 前缀可选',
        scanSeverity: '最低上报级别',
        scanSeverityHint: 'critical / high / medium / low / none',
        scanOneIssue: '一次扫描合并为一个 issue',
        scanConcurrency: '同时扫描仓库数（1~8，默认 3，自动排队）',
        scanPromptsLabel: '自定义提示词（JSON）',
        scanPromptsHint: '{"id":{"name":"名称","prompt":"内容"}}，同 id 覆盖内置，留空用内置',
        scanInterval: '扫描间隔（毫秒）',
        scanFetch: '一键获取我的仓库',
        scanFetching: '获取中…',
        scanNow: '立即扫描全部仓库',
        scanning: '触发中…',
        scanDone: '已触发，结果见 /gitee-ai/scan',
        scanFailed: '触发失败',
        scanNeedRepos: '请先填写扫描仓库',
      }
    }

    function ConfigCard(react, ui) {
      var h = react.createElement
      var Input = ui && ui.Input
      var Chevron = ui && ui.IconChevronDownOutline14

      // 复用内置 settings-plugins 注入的字段样式类（At1oFq_*）
      var fieldRow = (label, hint, control, key, groupName) =>
        h(
          groupName ? 'div' : 'label',
          {
            key: key,
            role: groupName ? 'group' : undefined,
            'aria-label': groupName || undefined,
            className: 'At1oFq_field',
            style: { display: 'flex', flexDirection: 'column', gap: '6px', padding: '12px 0' },
          },
          h('div', { className: 'At1oFq_head' },
            h('span', { className: 'At1oFq_label' }, label),
          ),
          hint
            ? h('div', { style: { fontSize: '12px', lineHeight: '17px', color: 'var(--dsw-alias-label-tertiary)', display: 'block', whiteSpace: 'normal', overflow: 'visible', textOverflow: 'clip' } }, hint)
            : null,
          control,
        )

      // 分区标题块：色条 + 标题 + 行为标签 + 说明，
      // 用于把「处理 Issue」与「代码安全扫描」两个功能模块清楚分隔，防止误配置/误操作。
      var sectionBlock = (label, sub, tag, tagBg, accent, key) =>
        h('div', {
          key: key,
          style: {
            margin: '16px 0 6px',
            padding: '10px 12px',
            borderRadius: '10px',
            border: '1px solid ' + accent,
            background: 'linear-gradient(90deg, ' + accent + '1A, transparent 75%)',
            display: 'flex', flexDirection: 'column', gap: '4px',
          },
        },
          h('div', { style: { display: 'flex', alignItems: 'center', gap: '8px', flexWrap: 'wrap' } },
            h('span', { style: { width: '6px', height: '16px', borderRadius: '3px', background: accent, display: 'inline-block' } }),
            h('span', { style: { fontSize: '14px', fontWeight: 800, color: 'var(--dsw-alias-label-primary)' } }, label),
            tag ? h('span', { style: { fontSize: '11px', fontWeight: 700, color: '#fff', background: tagBg, borderRadius: '999px', padding: '2px 8px' } }, tag) : null,
          ),
          sub ? h('span', { style: { fontSize: '12px', color: 'var(--dsw-alias-label-secondary)', lineHeight: 1.45 } }, sub) : null,
        )

      // 分区内层卡片：把某一模块的全部字段包进带浅色描边的容器，与另一模块形成视觉隔离。
      var innerCard = (key, accent, children) =>
        h('div', {
          key: key,
          style: {
            border: '1px solid ' + accent + '59',
            borderRadius: '10px',
            padding: '2px 14px 6px',
            margin: '2px 0 2px',
            background: accent + '0D',
          },
        }, children)

      // 自定义开关行：左侧标签，右侧紧凑的 iOS 风格 toggle
      var toggleRow = (label, hint, checked, onChange, key) =>
        h(
          'div',
          {
            key: key,
            className: 'At1oFq_field',
            style: { display: 'flex', flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: '12px', padding: '10px 0' },
          },
          h('div', { style: { minWidth: 0, display: 'flex', flexDirection: 'column', gap: '2px' } },
            h('span', {
              className: 'At1oFq_label',
              style: { margin: 0, fontSize: '13px', fontWeight: 500, color: 'var(--dsw-alias-label-primary)' },
            }, label),
            hint
              ? h('span', { style: { fontSize: '12px', color: 'var(--dsw-alias-label-tertiary)', lineHeight: 1.4 } }, hint)
              : null,
          ),
          h(Switch, { checked: !!checked, onChange, label }),
        )

      // 紧凑圆形开关（轨道 + 滑块），用 DSH 主题 token 着色
      function Switch(props) {
        var on = !!props.checked
        return h(
          'button',
          {
            type: 'button',
            role: 'switch',
            'aria-checked': on,
            'aria-label': props.label,
            onClick: () => props.onChange(!on),
            style: {
              appearance: 'none',
              flex: 'none',
              width: '36px',
              height: '20px',
              borderRadius: '999px',
              border: 0,
              padding: 0,
              cursor: 'pointer',
              position: 'relative',
              background: on
                ? 'var(--dsw-alias-brand-primary, #2563eb)'
                : 'var(--dsw-alias-bg-module-platform, rgba(127,127,127,0.35))',
              transition: 'background .16s',
              outline: 'none',
              boxShadow: 'inset 0 0 0 1px rgba(127,127,127,0.25)',
            },
          },
          h('span', {
            style: {
              position: 'absolute',
              top: '2px',
              left: on ? '18px' : '2px',
              width: '16px',
              height: '16px',
              borderRadius: '999px',
              background: '#fff',
              boxShadow: '0 1px 2px rgba(0,0,0,0.35)',
              transition: 'left .16s',
            },
          }),
        )
      }

      // 平衡：onChange 里用 ref 读最新 draft，避免闭包陈旧
      var draftRef = { current: null }

      return function GiteeCard() {
        var t = labels()
        var openState = react.useState(false)
        var summaryState = react.useState(null)
        var draftState = react.useState(null)
        var busyState = react.useState(false)
        var noteState = react.useState('')
        var failedState = react.useState(false)
        var dirtyState = react.useState(false)
        var open = openState[0]
        var summary = summaryState[0]
        var draft = draftState[0]
        var busy = busyState[0]
        var note = noteState[0]
        var failed = failedState[0]
        var dirty = dirtyState[0]
        var scanBusyState = react.useState(false)
        var scanNoteState = react.useState('')
        var scanBusy = scanBusyState[0]
        var scanNote = scanNoteState[0]
        var fetchBusyState = react.useState(false)
        var fetchNoteState = react.useState('')
        var fetchBusy = fetchBusyState[0]
        var fetchNote = fetchNoteState[0]

        draftRef.current = draft

        var seedDraft = (config) => ({
          botName: (config && config.botName) || '',
          workRoot: (config && config.workRoot) || '',
          watchRepos: ((config && config.watchRepos) || []).join('\n'),
          pollEnabled: !!(config && config.pollEnabled),
          pollIntervalMs: (config && config.pollIntervalMs) || 60000,
          autoMerge: !!(config && config.autoMerge),
          autoCloseIssue: !!(config && config.autoCloseIssue),
          tokenConfigured: !!(config && config.tokenConfigured),
          githubTokenConfigured: !!(config && config.githubTokenConfigured),
          scanEnabled: !!(config && config.scanEnabled),
          scanRepos: ((config && config.scanRepos) || []).join('\n'),
          scanMinSeverity: (config && config.scanMinSeverity) || 'medium',
          scanOneIssuePerRun: (config && config.scanOneIssuePerRun) !== false,
          scanPrompts: (config && config.scanPrompts && Object.keys(config.scanPrompts).length)
            ? JSON.stringify(config.scanPrompts, null, 2) : '',
          scanIntervalMs: (config && config.scanIntervalMs) || 21600000,
          scanConcurrency: (config && config.scanConcurrency) || 3,
        })

        var load = react.useCallback(() => {
          fetch('/gitee-ai/config')
            .then((r) => r.json().then((body) => {
              if (!r.ok) throw new Error(body.error || 'load failed')
              return body
            }))
            .then((body) => {
              summaryState[1](body.config)
              var d = seedDraft(body.config)
              draftRef.current = d
              draftState[1](d)
              noteState[1]('')
              failedState[1](false)
            })
            .catch((error) => {
              noteState[1](String(error.message ? error.message : error))
              failedState[1](true)
            })
        }, [])

        react.useEffect(() => {
          if (open && summary === null) load()
        }, [open, summary, load])

        var setDraft = (d) => { draftState[1](d); dirtyState[1](true) }
        var setDraftFromControl = (patch) => {
          var d = Object.assign({}, draftRef.current, patch)
          draftRef.current = d
          draftState[1](d)
          dirtyState[1](true)
        }

        var save = () => {
          if (!draft) return
          var prompts = {}
          if (draft.scanPrompts && draft.scanPrompts.trim()) {
            try {
              var parsed = JSON.parse(draft.scanPrompts)
              if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
                for (var id in parsed) {
                  var pv = parsed[id] || {}
                  var nm = String(pv.name || '').trim()
                  var pt = String(pv.prompt || '').trim()
                  if (nm && pt) prompts[id] = { name: nm, prompt: pt }
                }
              }
            } catch (e) {
              noteState[1]('提示词 JSON 格式错误，请检查')
              failedState[1](true)
              return
            }
          }
          busyState[1](true)
          failedState[1](false)
          noteState[1]('')
          var payload = {
            ...((draft.token && draft.token.trim()) ? { giteeToken: draft.token.trim() } : {}),
            ...((draft.githubToken && draft.githubToken.trim()) ? { githubToken: draft.githubToken.trim() } : {}),
            botName: draft.botName,
            workRoot: draft.workRoot,
            watchRepos: (draft.watchRepos || '').split(/\r?\n/).map((s) => s.trim()).filter(Boolean),
            pollEnabled: draft.pollEnabled,
            pollIntervalMs: Number(draft.pollIntervalMs) || 60000,
            autoMerge: draft.autoMerge,
            autoCloseIssue: draft.autoCloseIssue,
            scanEnabled: !!draft.scanEnabled,
            scanRepos: (draft.scanRepos || '').split(/\r?\n/).map((s) => s.trim()).filter(Boolean),
            scanMinSeverity: draft.scanMinSeverity || 'medium',
            scanOneIssuePerRun: draft.scanOneIssuePerRun !== false,
            scanPrompts: prompts,
            scanIntervalMs: Number(draft.scanIntervalMs) || 21600000,
            scanConcurrency: Number(draft.scanConcurrency) || 3,
          }
          fetch('/gitee-ai/config', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload),
          })
            .then((r) => r.json().then((body) => {
              if (!r.ok) throw new Error(body.error || 'save failed')
              return body
            }))
            .then((body) => {
              noteState[1](t.savedDone)
              summaryState[1](body.config)
              var d = seedDraft(body.config)
              draftRef.current = d
              draftState[1](d)
              dirtyState[1](false)
            })
            .catch((error) => {
              noteState[1](String(error.message ? error.message : error))
              failedState[1](true)
            })
            .finally(() => busyState[1](false))
        }

        var discard = () => {
          if (!summary) return
          var d = seedDraft(summary)
          draftRef.current = d
          draftState[1](d)
          dirtyState[1](false)
          noteState[1]('')
          failedState[1](false)
        }

        // 立即扫描：对 draft 里的 scanRepos 逐个 POST /gitee-ai/scan（服务端自动排队，按并发上限持续扫描）
        var scanNow = () => {
          if (!draft) return
          var repos = (draft.scanRepos || '').split(/\r?\n/).map((s) => s.trim()).filter(Boolean)
          if (!repos.length) { scanNoteState[1](t.scanNeedRepos); return }
          scanBusyState[1](true)
          scanNoteState[1]('')
          var accepted = 0
          var skipped = 0
          var tasks = repos.map(function (spec) {
            var platform = /^github:/i.test(spec) ? 'github' : /^gitee:/i.test(spec) ? 'gitee' : 'gitee'
            var rest = spec.replace(/^(github|gitee):/i, '')
            var idx = rest.indexOf('/')
            var owner = rest.slice(0, idx)
            var repo = rest.slice(idx + 1)
            if (!owner || !repo) return Promise.resolve({ accepted: false })
            return fetch('/gitee-ai/scan', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ platform: platform, owner: owner, repo: repo, dryRun: false }),
            }).then(function (r) { return r.json().catch(function () { return { accepted: false } }) })
              .then(function (b) {
                if (b && b.accepted) accepted++
                else skipped++
                return b
              })
          })
          Promise.all(tasks)
            .then(function () {
              scanNoteState[1]('已排队 ' + accepted + ' 个' + (skipped ? '（跳过 ' + skipped + ' 个：正在扫/已在队列）' : '') + '，同时最多扫 ' + (draft.scanConcurrency || 3) + ' 个')
            })
            .catch(function () { scanNoteState[1](t.scanFailed) })
            .finally(function () { scanBusyState[1](false) })
        }

        // 一键获取我的仓库：拉取有权限的仓库（含所属组织），追加进 scanRepos 供人工勾选
        var normLine = (s) => String(s || '').replace(/^(gitee|github):/i, '').toLowerCase()
        var fetchMyRepos = () => {
          if (fetchBusy) return
          fetchBusyState[1](true)
          fetchNoteState[1]('')
          fetch('/gitee-ai/my-repos')
            .then((r) => r.json().catch(() => ({ ok: false, error: '响应异常' })))
            .then((b) => {
              if (!b.ok || !Array.isArray(b.repos)) { fetchNoteState[1]('获取失败：' + ((b && b.error) || '未知错误')); return }
              var cur = (draftRef.current.scanRepos || '').split(/\r?\n/).map((s) => s.trim()).filter(Boolean)
              var seen = {}
              cur.forEach((s) => { seen[normLine(s)] = true })
              var lines = cur.slice()
              b.repos.forEach((x) => {
                var line = x.platform + ':' + x.owner + '/' + x.repo
                if (!seen[normLine(line)]) { lines.push(line); seen[normLine(line)] = true }
              })
              setDraftFromControl({ scanRepos: lines.join('\n') })
              fetchNoteState[1]('已填入 ' + b.repos.length + ' 个仓库（含既有保留，去掉不需要的再保存）')
            })
            .catch((e) => fetchNoteState[1]('获取失败：' + String(e.message || e)))
            .finally(() => fetchBusyState[1](false))
        }

        // ── 头部（大标题 + 描述 + 展开箭头）──
        var statusLine = summary
          ? '轮询' + (summary.pollEnabled ? ' 开 · ' + Math.round((summary.pollIntervalMs || 0) / 1000) + 's' : ' 关')
            + ' · 仓库 ' + ((summary.watchRepos || []).length) + ' 个'
            + ' · 扫描' + (summary.scanEnabled ? ' 开' : ' 关')
            + (summary.tokenConfigured ? '' : ' · 未配置令牌')
          : t.description

        var chevronEl = Chevron
          ? h(Chevron, {
              className: 'YyYd_a_chevron' + (open ? ' YyYd_a_chevronOpen' : ''),
            })
          : h('span', {
              className: 'YyYd_a_chevron' + (open ? ' YyYd_a_chevronOpen' : ''),
              style: { display: 'inline-flex' },
            }, '▾')

        var header = h(
          'button',
          {
            type: 'button',
            className: 'YyYd_a_header',
            'aria-expanded': open,
            'aria-label': (open ? t.collapse : t.expand) + ': ' + t.title,
            onClick: () => openState[1](!open),
          },
          h('span', { className: 'YyYd_a_headText' },
            h('span', { className: 'YyYd_a_name' }, t.title),
            h('span', { className: 'YyYd_a_description' }, statusLine),
          ),
          dirty ? h('span', { className: 'YyYd_a_pending' }, t.unsaved) : null,
          chevronEl,
        )

        // ── 主体（字段 + 底部保存）──
        var body = null
        if (open) {
          if (!summary || !draft) {
            body = h(
              'div',
              { className: 'YyYd_a_body', style: { padding: '12px 16px', color: 'var(--dsw-alias-label-tertiary)', fontSize: '13px' } },
              note || t.loading,
            )
          } else {
            var controls = []
            // ── 公共区：令牌 / 工作目录（两个功能模块共用，放最顶上）──
            controls.push(sectionBlock(t.common,
              'Gitee / GitHub 令牌与仓库工作目录同时供「处理 Issue」和「代码安全扫描」使用：扫描与开发都以令牌身份访问仓库，都在同一工作目录下克隆。',
              '两个功能模块共用 · 修改需谨慎', '#64748b', '#64748b', 'commonBlock'))
            var commonFields = []
            commonFields.push(h('div', { key: 'tokenRow', style: { display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(190px, 1fr))', gap: '12px', padding: '12px 0 2px' } },
              fieldRow(t.token, draft.tokenConfigured ? t.tokenHint : undefined, h(Input, {
                key: 'token',
                type: 'password',
                placeholder: draft.tokenConfigured ? '••••••••（留空保持原值）' : '输入 Gitee 私人令牌',
                value: (draft.token !== undefined ? draft.token : ''),
                onChange: (e) => setDraftFromControl({ token: e.target.value }),
              }), 'token'),
              fieldRow('GitHub 令牌（可选）', '留空保持原值；用于 github: 前缀仓库', h(Input, {
                key: 'githubToken',
                type: 'password',
                placeholder: draft.githubTokenConfigured ? '••••••••（留空保持原值）' : '输入 GitHub 私人令牌（可选）',
                value: (draft.githubToken !== undefined ? draft.githubToken : ''),
                onChange: (e) => setDraftFromControl({ githubToken: e.target.value }),
              }), 'githubToken'),
            ))
            commonFields.push(fieldRow(t.workRoot, undefined, h(Input, {
              key: 'workRoot',
              value: draft.workRoot || '',
              onChange: (e) => setDraftFromControl({ workRoot: e.target.value }),
            }), 'workRoot'))
            controls.push(innerCard('commonCard', '#64748b', commonFields))

            // ── 分区A：处理 Issue（真实操作仓库）──
            controls.push(sectionBlock(t.issueBlock,
              '监听 issue：@ 机器人后自动克隆仓库开发、推分支、提 PR，可自动合并 / 自动关闭。下面这些设置会真实操作你的仓库（改代码、推送分支、合并 PR），请仔细确认。',
              '会真实操作仓库 · 自动提 PR', '#dc2626', '#3b82f6', 'issueBlock'))
            var issueFields = []
            issueFields.push(fieldRow(t.bot, t.botHint, h(Input, {
              key: 'bot',
              value: draft.botName || '',
              onChange: (e) => setDraftFromControl({ botName: e.target.value }),
            }), 'bot'))
            issueFields.push(fieldRow(t.repos, t.reposHint, h('textarea', {
              key: 'repos',
              rows: 3,
              className: 'At1oFq_input',
              style: { height: 'auto', padding: '8px 12px', resize: 'vertical', lineHeight: 1.5 },
              value: draft.watchRepos || '',
              onChange: (e) => setDraftFromControl({ watchRepos: e.target.value }),
            }), 'repos'))
            issueFields.push(toggleRow(t.poll, undefined, draft.pollEnabled, (v) => setDraftFromControl({ pollEnabled: v }), 'poll'))
            issueFields.push(fieldRow(t.interval, undefined, h(Input, {
              key: 'interval',
              type: 'number',
              value: draft.pollIntervalMs,
              onChange: (e) => setDraftFromControl({ pollIntervalMs: e.target.value }),
            }), 'interval'))
            issueFields.push(toggleRow(t.merge, undefined, draft.autoMerge, (v) => setDraftFromControl({ autoMerge: v }), 'merge'))
            issueFields.push(toggleRow(t.close, undefined, draft.autoCloseIssue, (v) => setDraftFromControl({ autoCloseIssue: v }), 'close'))
            controls.push(innerCard('issueCard', '#3b82f6', issueFields))

            // ── 分区B：代码安全扫描（只读审计）──
            controls.push(sectionBlock(t.scan,
              '对「扫描仓库」里的仓库做静态安全审计（克隆到本地、按内置/自定义提示词检查），发现新漏洞去重后提交 [安全扫描] issue。全程只读审计，不会改代码、不会提 PR。',
              '只读审计 · 只提交漏洞 issue', '#059669', '#10b981', 'scanBlock'))
            var scanFields = []
            scanFields.push(toggleRow(t.scanEnable, undefined, draft.scanEnabled, (v) => setDraftFromControl({ scanEnabled: v }), 'scanEnable'))
            scanFields.push(fieldRow(t.scanReposLabel, t.scanReposHint, h('textarea', {
              key: 'scanRepos', rows: 3,
              className: 'At1oFq_input',
              style: { height: 'auto', padding: '8px 12px', resize: 'vertical', lineHeight: 1.5 },
              value: draft.scanRepos || '',
              onChange: (e) => setDraftFromControl({ scanRepos: e.target.value }),
            }), 'scanRepos'))
            scanFields.push(h('div', { key: 'fetchReposRow', style: { display: 'flex', gap: '8px', alignItems: 'center', padding: '4px 0', flexWrap: 'wrap' } },
              h('button', {
                type: 'button',
                onClick: fetchMyRepos,
                disabled: fetchBusy,
                style: { background: '#2f6fed', color: '#fff', border: 0, borderRadius: '8px', padding: '6px 12px', fontSize: '12px', cursor: 'pointer' },
              }, fetchBusy ? t.scanFetching : t.scanFetch),
              fetchNote ? h('span', { style: { fontSize: '12px', color: 'var(--dsw-alias-label-secondary)' } }, fetchNote) : null,
            ))
            scanFields.push(fieldRow(t.scanSeverity, t.scanSeverityHint, h('select', {
              key: 'scanSeverity',
              className: 'At1oFq_input',
              style: { padding: '8px 12px' },
              value: draft.scanMinSeverity || 'medium',
              onChange: (e) => setDraftFromControl({ scanMinSeverity: e.target.value }),
            }, ['critical', 'high', 'medium', 'low', 'none'].map((s) => h('option', { key: s, value: s }, s))), 'scanSeverity'))
            scanFields.push(toggleRow(t.scanOneIssue, undefined, draft.scanOneIssuePerRun, (v) => setDraftFromControl({ scanOneIssuePerRun: v }), 'scanOneIssue'))
            scanFields.push(fieldRow(t.scanConcurrency, undefined, h(Input, {
              key: 'scanConcurrency', type: 'number', min: 1, max: 8,
              value: draft.scanConcurrency,
              onChange: (e) => setDraftFromControl({ scanConcurrency: e.target.value }),
            }), 'scanConcurrency'))
            scanFields.push(fieldRow(t.scanPromptsLabel, t.scanPromptsHint, h('textarea', {
              key: 'scanPrompts', rows: 4,
              className: 'At1oFq_input',
              style: { height: 'auto', padding: '8px 12px', resize: 'vertical', lineHeight: 1.4, fontFamily: 'Consolas,monospace', fontSize: '11px' },
              value: draft.scanPrompts || '',
              onChange: (e) => setDraftFromControl({ scanPrompts: e.target.value }),
            }), 'scanPrompts'))
            scanFields.push(fieldRow(t.scanInterval, undefined, h(Input, {
              key: 'scanInterval', type: 'number',
              value: draft.scanIntervalMs,
              onChange: (e) => setDraftFromControl({ scanIntervalMs: e.target.value }),
            }), 'scanInterval'))
            scanFields.push(h('div', { key: 'scanNowRow', style: { display: 'flex', gap: '8px', alignItems: 'center', padding: '8px 0', flexWrap: 'wrap' } },
              h('button', {
                type: 'button',
                onClick: scanNow,
                disabled: scanBusy,
                style: { background: 'var(--dsw-alias-danger, #dc2626)', color: '#fff', border: 0, borderRadius: '8px', padding: '8px 14px', fontSize: '13px', cursor: 'pointer' },
              }, scanBusy ? t.scanning : t.scanNow),
              scanNote ? h('span', { style: { fontSize: '12px', color: 'var(--dsw-alias-label-secondary)' } }, scanNote) : null,
            ))
            controls.push(innerCard('scanCard', '#10b981', scanFields))

            body = h(
              'div',
              { className: 'YyYd_a_body' },
              h('a', {
                href: '/gitee-ai/settings',
                target: '_blank',
                rel: 'noreferrer',
                style: { display: 'inline-block', marginTop: '12px', fontSize: '12px', color: 'var(--dsw-alias-label-secondary)', textDecoration: 'underline' },
              }, t.status + ' ↗'),
              controls,
              note
                ? h('p', {
                    className: failed ? 'YyYd_a_failed' : 'YyYd_a_readOnly',
                    role: 'status',
                    style: failed ? {} : { margin: '8px 0 0', fontSize: '12px', lineHeight: '1.5' },
                  }, note)
                : null,
              h('div', { className: 'YyYd_a_footer' },
                h('button', {
                  type: 'button',
                  className: 'YyYd_a_discard',
                  disabled: !dirty || busy,
                  onClick: discard,
                }, t.discard),
                h('button', {
                  type: 'button',
                  className: 'YyYd_a_save',
                  disabled: busy,
                  onClick: save,
                }, busy ? t.saving : t.save),
              ),
            )
          }
        }

        return h(
          'li',
          { className: 'YyYd_a_card' + (open ? ' YyYd_a_cardOpen' : '') },
          header,
          body,
        )
      }
    }

    function registerCard(ctx) {
      if (typeof ctx.inject !== 'function') return
      ctx.inject(['slots'], (scope) => {
        fetch('/gitee-ai/config')
          .then((response) => {
            if (response.status === 404) return
            try {
              mountCard(scope)
            } catch (error) {
              console.error('[gitee-ai] settings card skipped: ' + error)
            }
          })
          .catch(() => {})
      })
    }

    function mountCard(ctx) {
      var react
      try {
        react = require('react')
      } catch (error) {
        console.error('[gitee-ai] settings card skipped: ' + error)
        return
      }
      var ui
      try {
        ui = require('@deepseek-ai/dsh-client-ui-primitives')
      } catch (error) {
        ui = {}
      }
      var Card = ConfigCard(react, ui)
      ctx.slots.inject('settings.plugin.item', function* () {
        yield ctx.slots.register({ name: 'settings.plugin.item', id: 'gitee-ai-employee', key: 'gitee-ai-employee', order: 30 }, Card)
      })
    }

    function apply(ctx) {
      registerCard(ctx)
      if (typeof ctx.effect === 'function') {
        ctx.effect(() => () => {}, 'gitee-ai: settings card')
      }
    }

    exports.apply = apply
    // `slots` is optional, so it is not required here: registerCard checks.
    exports.inject = []
    return module.exports
  },
})
