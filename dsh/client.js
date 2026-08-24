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
            hint
              ? h('span', { className: 'At1oFq_badgeMuted', style: { fontSize: '11px', lineHeight: '17px', color: 'var(--dsw-alias-label-tertiary)' } }, hint)
              : null,
          ),
          control,
        )

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
          busyState[1](true)
          failedState[1](false)
          noteState[1]('')
          var payload = {
            botName: draft.botName,
            workRoot: draft.workRoot,
            watchRepos: (draft.watchRepos || '').split(/\r?\n/).map((s) => s.trim()).filter(Boolean),
            pollEnabled: draft.pollEnabled,
            pollIntervalMs: Number(draft.pollIntervalMs) || 60000,
            autoMerge: draft.autoMerge,
            autoCloseIssue: draft.autoCloseIssue,
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

        // ── 头部（大标题 + 描述 + 展开箭头）──
        var statusLine = summary
          ? '轮询' + (summary.pollEnabled ? ' 开 · ' + Math.round((summary.pollIntervalMs || 0) / 1000) + 's' : ' 关')
            + ' · 仓库 ' + ((summary.watchRepos || []).length) + ' 个'
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
            controls.push(fieldRow(t.token, draft.tokenConfigured ? t.tokenHint : undefined, h(Input, {
              key: 'token',
              type: 'password',
              placeholder: draft.tokenConfigured ? '••••••••' : '输入 Gitee 私人令牌',
              value: (draft.token !== undefined ? draft.token : ''),
              onChange: (e) => setDraftFromControl({ token: e.target.value }),
            }), 'token'))
            controls.push(fieldRow(t.bot, t.botHint, h(Input, {
              key: 'bot',
              value: draft.botName || '',
              onChange: (e) => setDraftFromControl({ botName: e.target.value }),
            }), 'bot'))
            controls.push(fieldRow(t.workRoot, undefined, h(Input, {
              key: 'workRoot',
              value: draft.workRoot || '',
              onChange: (e) => setDraftFromControl({ workRoot: e.target.value }),
            }), 'workRoot'))
            controls.push(fieldRow(t.repos, t.reposHint, h('textarea', {
              key: 'repos',
              rows: 3,
              className: 'At1oFq_input',
              style: { height: 'auto', padding: '8px 12px', resize: 'vertical', lineHeight: 1.5 },
              value: draft.watchRepos || '',
              onChange: (e) => setDraftFromControl({ watchRepos: e.target.value }),
            }), 'repos'))
            controls.push(toggleRow(t.poll, undefined, draft.pollEnabled, (v) => setDraftFromControl({ pollEnabled: v }), 'poll'))
            controls.push(fieldRow(t.interval, undefined, h(Input, {
              key: 'interval',
              type: 'number',
              value: draft.pollIntervalMs,
              onChange: (e) => setDraftFromControl({ pollIntervalMs: e.target.value }),
            }), 'interval'))
            controls.push(toggleRow(t.merge, undefined, draft.autoMerge, (v) => setDraftFromControl({ autoMerge: v }), 'merge'))
            controls.push(toggleRow(t.close, undefined, draft.autoCloseIssue, (v) => setDraftFromControl({ autoCloseIssue: v }), 'close'))

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
