// Browser half of the Gitee AI employee dsh plugin: a plugin card on the
// sidebar 插件 page (PluginManagerPage), rendered through the `plugins.item`
// slot introduced in DSH 0.2.x. The old 0.1.x surface — a collapsible card in
// 设置 → 已安装插件 registered into the `settings.plugin.item` slot, styled by
// copying the settings-plugins CSS-module hashes (YyYd_a_* / At1oFq_*) — no
// longer exists in the new client: the settings page is read-only and those
// class hashes are gone. This version therefore:
//   * registers { name: 'plugins.item', id: 'gitee-ai-employee' } while the
//     Host serves the 'gitee-ai-employee' settings namespace (the same
//     whileServed-gated pattern the shipped agent-loop/shell/web-search cards
//     use), so the card only appears when the host half is actually loaded;
//   * renders the two views the Plugins page asks for: view 'summary' (the
//     one-liner under the card title) and view 'page' (the full config form
//     with its own save controls on the plugin's detail page);
//   * keeps the zero-build lazy-CJS protocol (window.__ModuleLoader__.load)
//     and the zero-dependency stance: all styling is inline, driven by DSH
//     theme tokens (--dsw-alias-*), so no bundled CSS-module hash can break
//     it again. Server IO is unchanged: GET/POST /gitee-ai/config, plus
//     /gitee-ai/scan and /gitee-ai/my-repos helpers.
window.__ModuleLoader__.load({
  id: 'gitee-ai-employee',
  factory: (require) => {
    var module = { exports: {} }
    var exports = module.exports

    const NS = 'gitee-ai-employee' // settings namespace served by the host half

    function labels() {
      return {
        title: 'Gitee AI 员工',
        description: 'issue @员工 → AI 开发 → PR → 自动关闭',
        unsaved: '未保存',
        loading: '加载中…',
        loadFailed: '配置加载失败',
        discard: '放弃',
        save: '保存',
        saving: '保存中…',
        savedDone: '保存完成，已生效',
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

    function ConfigPage(react, ui) {
      var h = react.createElement
      var Input = ui && ui.Input

      var fieldRow = (label, hint, control, key) =>
        h('div', {
          key: key,
          style: { display: 'flex', flexDirection: 'column', gap: '6px', padding: '12px 0' },
        },
          h('div', { style: { display: 'flex', alignItems: 'center' } },
            h('span', {
              style: { fontSize: '13px', fontWeight: 600, color: 'var(--dsw-alias-label-primary)' },
            }, label),
          ),
          hint
            ? h('div', { style: { fontSize: '12px', lineHeight: '17px', color: 'var(--dsw-alias-label-tertiary)', whiteSpace: 'normal' } }, hint)
            : null,
          control,
        )

      var toggleRow = (label, hint, checked, onChange, key) =>
        h('div', {
          key: key,
          style: { display: 'flex', flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: '12px', padding: '10px 0' },
        },
          h('div', { style: { minWidth: 0, display: 'flex', flexDirection: 'column', gap: '2px' } },
            h('span', {
              style: { margin: 0, fontSize: '13px', fontWeight: 500, color: 'var(--dsw-alias-label-primary)' },
            }, label),
            hint
              ? h('span', { style: { fontSize: '12px', color: 'var(--dsw-alias-label-tertiary)', lineHeight: 1.4 } }, hint)
              : null,
          ),
          h('button', {
            type: 'button',
            role: 'switch',
            'aria-checked': !!checked,
            'aria-label': label,
            onClick: () => onChange(!checked),
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
              background: checked
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
                left: checked ? '18px' : '2px',
                width: '16px',
                height: '16px',
                borderRadius: '999px',
                background: '#fff',
                boxShadow: '0 1px 2px rgba(0,0,0,0.35)',
                transition: 'left .16s',
              },
            })),
        )

      var sectionBlock = (label, sub, tag, accent, key) =>
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
            tag ? h('span', { style: { fontSize: '11px', fontWeight: 700, color: '#fff', background: accent, borderRadius: '999px', padding: '2px 8px' } }, tag) : null,
          ),
          sub ? h('span', { style: { fontSize: '12px', color: 'var(--dsw-alias-label-secondary)', lineHeight: 1.45 } }, sub) : null,
        )

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

      var inputStyle = {
        width: '100%',
        boxSizing: 'border-box',
        background: 'var(--dsw-alias-bg-input, rgba(127,127,127,0.08))',
        color: 'var(--dsw-alias-label-primary)',
        border: '1px solid var(--dsw-alias-border-primary, rgba(127,127,127,0.3))',
        borderRadius: '8px',
        padding: '8px 12px',
        fontSize: '13px',
        outline: 'none',
      }

      // 平衡：onChange 里用 ref 读最新 draft，避免闭包陈旧
      var draftRef = { current: null }

      return function GiteeCard(props) {
        var t = labels()
        // The Plugins page asks either view:'summary' (one-liner) or
        // view:'page' (full form with its own save controls).
        var view = (props && props.view) || 'page'

        var summaryState = react.useState(null)
        var draftState = react.useState(null)
        var busyState = react.useState(false)
        var noteState = react.useState('')
        var failedState = react.useState(false)
        var dirtyState = react.useState(false)
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
          if (summary === null) load()
        }, [summary, load])

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
            // 原始仓库行交给服务端统一解析（owner/repo、gitee:owner/repo、完整克隆地址均可）。
            return fetch('/gitee-ai/scan', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ spec: spec, dryRun: false }),
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

        // ── view:'summary'：卡片标题下的一句话状态行 ──
        if (view === 'summary') {
          if (!summary) return null
          return '轮询' + (summary.pollEnabled ? ' 开 · ' + Math.round((summary.pollIntervalMs || 0) / 1000) + 's' : ' 关')
            + ' · 仓库 ' + ((summary.watchRepos || []).length) + ' 个'
            + ' · 扫描' + (summary.scanEnabled ? ' 开' : ' 关')
            + (summary.tokenConfigured ? '' : ' · 未配置令牌')
        }

        // ── view:'page'：整页配置表单（页面宿主提供标题/图标/面包屑，本组件只渲染表单本体与保存控件）──
        if (!summary || !draft) {
          return h('div', { 'data-gitee-ai-config': true, style: { padding: '12px 0', color: 'var(--dsw-alias-label-tertiary)', fontSize: '13px' } },
            note || t.loading)
        }
        var controls = []
        controls.push(sectionBlock(t.common,
          'Gitee / GitHub 令牌与仓库工作目录同时供「处理 Issue」和「代码安全扫描」使用：扫描与开发都以令牌身份访问仓库，都在同一工作目录下克隆。',
          '两个功能模块共用 · 修改需谨慎', '#64748b', 'commonBlock'))
        var commonFields = []
        commonFields.push(h('div', { key: 'tokenRow', style: { display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(190px, 1fr))', gap: '12px', padding: '12px 0 2px' } },
          fieldRow(t.token, draft.tokenConfigured ? t.tokenHint : undefined, h(Input || 'input', {
            key: 'token',
            type: 'password',
            placeholder: draft.tokenConfigured ? '••••••••（留空保持原值）' : '输入 Gitee 私人令牌',
            value: (draft.token !== undefined ? draft.token : ''),
            style: inputStyle,
            onChange: (e) => setDraftFromControl({ token: e.target.value }),
          }), 'token'),
          fieldRow('GitHub 令牌（可选）', '留空保持原值；用于 github: 前缀仓库', h(Input || 'input', {
            key: 'githubToken',
            type: 'password',
            placeholder: draft.githubTokenConfigured ? '••••••••（留空保持原值）' : '输入 GitHub 私人令牌（可选）',
            value: (draft.githubToken !== undefined ? draft.githubToken : ''),
            style: inputStyle,
            onChange: (e) => setDraftFromControl({ githubToken: e.target.value }),
          }), 'githubToken'),
        ))
        commonFields.push(fieldRow(t.workRoot, undefined, h(Input || 'input', {
          key: 'workRoot',
          value: draft.workRoot || '',
          style: inputStyle,
          onChange: (e) => setDraftFromControl({ workRoot: e.target.value }),
        }), 'workRoot'))
        controls.push(innerCard('commonCard', '#64748b', commonFields))

        controls.push(sectionBlock(t.issueBlock,
          '监听 issue：@ 机器人后自动克隆仓库开发、推分支、提 PR，可自动合并 / 自动关闭。下面这些设置会真实操作你的仓库（改代码、推送分支、合并 PR），请仔细确认。',
          '会真实操作仓库 · 自动提 PR', '#3b82f6', 'issueBlock'))
        var issueFields = []
        issueFields.push(fieldRow(t.bot, t.botHint, h(Input || 'input', {
          key: 'bot',
          value: draft.botName || '',
          style: inputStyle,
          onChange: (e) => setDraftFromControl({ botName: e.target.value }),
        }), 'bot'))
        issueFields.push(fieldRow(t.repos, t.reposHint, h('textarea', {
          key: 'repos',
          rows: 3,
          style: { ...inputStyle, height: 'auto', resize: 'vertical', lineHeight: 1.5 },
          value: draft.watchRepos || '',
          onChange: (e) => setDraftFromControl({ watchRepos: e.target.value }),
        }), 'repos'))
        issueFields.push(toggleRow(t.poll, undefined, draft.pollEnabled, (v) => setDraftFromControl({ pollEnabled: v }), 'poll'))
        issueFields.push(fieldRow(t.interval, undefined, h(Input || 'input', {
          key: 'interval',
          type: 'number',
          value: draft.pollIntervalMs,
          style: inputStyle,
          onChange: (e) => setDraftFromControl({ pollIntervalMs: e.target.value }),
        }), 'interval'))
        issueFields.push(toggleRow(t.merge, undefined, draft.autoMerge, (v) => setDraftFromControl({ autoMerge: v }), 'merge'))
        issueFields.push(toggleRow(t.close, undefined, draft.autoCloseIssue, (v) => setDraftFromControl({ autoCloseIssue: v }), 'close'))
        controls.push(innerCard('issueCard', '#3b82f6', issueFields))

        controls.push(sectionBlock(t.scan,
          '对「扫描仓库」里的仓库做静态安全审计（克隆到本地、按内置/自定义提示词检查），发现新漏洞去重后提交 [安全扫描] issue。全程只读审计，不会改代码、不会提 PR。',
          '只读审计 · 只提交漏洞 issue', '#10b981', 'scanBlock'))
        var scanFields = []
        scanFields.push(toggleRow(t.scanEnable, undefined, draft.scanEnabled, (v) => setDraftFromControl({ scanEnabled: v }), 'scanEnable'))
        scanFields.push(fieldRow(t.scanReposLabel, t.scanReposHint, h('textarea', {
          key: 'scanRepos', rows: 3,
          style: { ...inputStyle, height: 'auto', resize: 'vertical', lineHeight: 1.5 },
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
          style: { ...inputStyle, padding: '8px 12px' },
          value: draft.scanMinSeverity || 'medium',
          onChange: (e) => setDraftFromControl({ scanMinSeverity: e.target.value }),
        }, ['critical', 'high', 'medium', 'low', 'none'].map((s) => h('option', { key: s, value: s }, s))), 'scanSeverity'))
        scanFields.push(toggleRow(t.scanOneIssue, undefined, draft.scanOneIssuePerRun, (v) => setDraftFromControl({ scanOneIssuePerRun: v }), 'scanOneIssue'))
        scanFields.push(fieldRow(t.scanConcurrency, undefined, h(Input || 'input', {
          key: 'scanConcurrency', type: 'number', min: 1, max: 8,
          value: draft.scanConcurrency,
          style: inputStyle,
          onChange: (e) => setDraftFromControl({ scanConcurrency: e.target.value }),
        }), 'scanConcurrency'))
        scanFields.push(fieldRow(t.scanPromptsLabel, t.scanPromptsHint, h('textarea', {
          key: 'scanPrompts', rows: 4,
          style: { ...inputStyle, height: 'auto', resize: 'vertical', lineHeight: 1.4, fontFamily: 'Consolas,monospace', fontSize: '11px' },
          value: draft.scanPrompts || '',
          onChange: (e) => setDraftFromControl({ scanPrompts: e.target.value }),
        }), 'scanPrompts'))
        scanFields.push(fieldRow(t.scanInterval, undefined, h(Input || 'input', {
          key: 'scanInterval', type: 'number',
          value: draft.scanIntervalMs,
          style: inputStyle,
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

        return h('div', { 'data-gitee-ai-config': true, style: { display: 'flex', flexDirection: 'column' } },
          h('a', {
            href: '/gitee-ai/settings',
            target: '_blank',
            rel: 'noreferrer',
            style: { display: 'inline-block', margin: '12px 0 0', fontSize: '12px', color: 'var(--dsw-alias-label-secondary)', textDecoration: 'underline' },
          }, t.status + ' ↗'),
          controls,
          note
            ? h('p', {
                role: 'status',
                style: {
                  margin: '8px 0 0', fontSize: '12px', lineHeight: '1.5',
                  color: failed ? 'var(--dsw-alias-danger, #dc2626)' : 'var(--dsw-alias-label-secondary)',
                },
              }, note)
            : null,
          h('div', { style: { display: 'flex', justifyContent: 'flex-end', gap: '8px', margin: '14px 0 4px' } },
            h('button', {
              type: 'button',
              disabled: !dirty || busy,
              onClick: discard,
              style: {
                background: 'transparent', color: 'var(--dsw-alias-label-secondary)',
                border: '1px solid var(--dsw-alias-border-primary, rgba(127,127,127,0.3))',
                borderRadius: '8px', padding: '7px 14px', fontSize: '13px', cursor: !dirty || busy ? 'default' : 'pointer', opacity: !dirty || busy ? 0.5 : 1,
              },
            }, t.discard),
            h('button', {
              type: 'button',
              disabled: busy,
              onClick: save,
              style: {
                background: 'var(--dsw-alias-brand-primary, #2563eb)', color: '#fff', border: 0,
                borderRadius: '8px', padding: '7px 16px', fontSize: '13px', fontWeight: 600, cursor: busy ? 'default' : 'pointer', opacity: busy ? 0.7 : 1,
              },
            }, busy ? t.saving : t.save),
          ),
        )
      }
    }

    function registerCard(ctx) {
      if (typeof ctx.inject !== 'function') return
      // Mirror the shipped cards: mount only while the Host serves the
      // plugin's settings namespace, so a deployment without the host half
      // shows no trace of the card.
      ctx.inject(['slots'], (scope) => {
        fetch('/gitee-ai/config')
          .then((response) => {
            if (response.status === 404) return
            try {
              mountCard(scope)
            } catch (error) {
              console.error('[gitee-ai] plugins-page card skipped: ' + error)
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
        console.error('[gitee-ai] plugins-page card skipped: ' + error)
        return
      }
      var ui
      try {
        ui = require('@deepseek-ai/dsh-client-ui-primitives')
      } catch (error) {
        ui = {}
      }
      var Card = ConfigPage(react, ui)
      // The Plugins page declares `plugins.item` (list). It renders each
      // occupant twice: view 'summary' on the card, view 'page' (plus the
      // page's own form controls) on the plugin's detail page.
      ctx.slots.inject('plugins.item', function* () {
        yield ctx.slots.register({ name: 'plugins.item', id: 'gitee-ai-employee', order: 30, label: 'Gitee AI 员工' }, Card)
      })
    }

    function apply(ctx) {
      registerCard(ctx)
      if (typeof ctx.effect === 'function') {
        ctx.effect(() => () => {}, 'gitee-ai: plugins-page card')
      }
    }

    exports.apply = apply
    // `slots` is optional, so it is not listed here: registerCard checks for it.
    exports.inject = []
    return module.exports
  },
})
