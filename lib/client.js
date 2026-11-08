/**
 * Client half: the DeepMemory console.
 *
 * Registered in three slots — `sidebar.panellist` owns the icon and resolves its
 * label from list metadata, `main` renders under that same key when the entry is
 * selected, and `conversation.session.header.actions` adds the three per-session
 * chips. The first two must share one id.
 *
 * Two rules shaped the styling:
 *
 * 1. Every colour is a `--dsw-alias-*` token, never a literal. The theme package
 *    declares the light palette on `body` and the dark one on
 *    `body[data-ds-dark-theme]`, so referencing the alias is all it takes for a
 *    control to follow the active theme — a media query would be wrong here,
 *    because the user can pick light/dark independently of the OS.
 * 2. The rules live in a real stylesheet injected into `document.head`, not in
 *    inline `style` props. Hover, focus rings, transitions and scrollbar styling
 *    are not expressible inline, and the rule text stays readable.
 *
 * No host data is imported: everything comes from `/api/deepmemory/*` on the
 * same origin, which carries the browser's authority-bound cookie. Only React
 * is required; every control is built here so the bundle stays independent of
 * the host's client packages.
 */
window.__ModuleLoader__.load({
  id: '@emo-bird/dsh-deepmemory',
  factory(require) {
    const React = require('react')
    const h = React.createElement
    const { useCallback, useEffect, useMemo, useState } = React

    const PANEL_ID = 'deepmemory'
    const API = '/api/deepmemory'
    const STYLE_MARK = 'deepmemory/console.css'

    const TABS = [
      { id: 'overview', label: '概览' },
      { id: 'facts', label: '事实' },
      { id: 'episodes', label: '片段' },
      { id: 'diary', label: '日记' },
      { id: 'settings', label: '设置' },
    ]

    // ------------------------------------------------------------------ style

    /**
     * Token cheat-sheet, because three families are easy to confuse:
     * - `brand-primary` is monochrome (near-black in light, near-white in dark).
     *   It is a contrast fill, NOT an accent colour.
     * - `button-primary-fill` and `label-primary-foreground` are a pair: fill
     *   with the former, paint text with the latter, and contrast survives the
     *   palette flip.
     * - `link` is the one real blue, legible on both backgrounds.
     */
    const CSS = `
.dm-page {
  display: flex;
  flex-direction: column;
  height: 100%;
  min-height: 0;
  box-sizing: border-box;
  background: var(--dsw-alias-bg-base);
  color: var(--dsw-alias-label-primary);
  font-family: inherit;
  font-size: 13px;
  line-height: 1.5;
}
.dm-scroll { flex: 1; min-height: 0; overflow-y: auto; scrollbar-gutter: stable; padding: 0 18px 24px; }
.dm-head {
  display: flex;
  align-items: baseline;
  gap: 10px;
  padding: 16px 18px 12px;
  flex-wrap: wrap;
}
.dm-title { font-size: 15px; font-weight: 600; }
.dm-sub { font-size: 11px; color: var(--dsw-alias-label-tertiary); }
.dm-spacer { flex: 1; }
.dm-tabs {
  display: flex;
  gap: 2px;
  padding: 0 18px;
  border-bottom: 1px solid var(--dsw-alias-border-l1);
  margin-bottom: 14px;
}
.dm-tab {
  cursor: pointer;
  padding: 6px 10px;
  font-size: 12px;
  color: var(--dsw-alias-label-secondary);
  border-bottom: 2px solid transparent;
  margin-bottom: -1px;
  transition: color var(--ds-transition-duration-fast, .1s) var(--ds-ease-in-out, ease-in-out),
              border-color var(--ds-transition-duration-fast, .1s) var(--ds-ease-in-out, ease-in-out);
}
.dm-tab:hover { color: var(--dsw-alias-label-primary); }
.dm-tab[data-active='true'] {
  color: var(--dsw-alias-label-primary);
  font-weight: 600;
  border-bottom-color: var(--dsw-alias-label-primary);
}
.dm-btn {
  font: inherit;
  font-size: 12px;
  cursor: pointer;
  padding: 4px 10px;
  border-radius: var(--dsw-radius-sm, 8px);
  border: 1px solid var(--dsw-alias-border-l2);
  background: transparent;
  color: var(--dsw-alias-label-primary);
  transition: background var(--ds-transition-duration-fast, .1s) var(--ds-ease-in-out, ease-in-out);
}
.dm-btn:hover:not(:disabled) { background: var(--dsw-alias-interactive-bg-hover); }
.dm-btn[data-kind='primary'] {
  border-color: transparent;
  background: var(--dsw-alias-button-primary-fill);
  color: var(--dsw-alias-label-primary-foreground);
}
.dm-btn[data-kind='primary']:hover:not(:disabled) {
  background: var(--dsw-alias-button-primary-hover, var(--dsw-alias-button-primary-fill));
}
.dm-btn:disabled { opacity: .5; cursor: default; }
.dm-card {
  border: 1px solid var(--dsw-alias-settings-card-stroke, var(--dsw-alias-border-l2));
  border-radius: var(--dsw-radius-md, 12px);
  background: var(--dsw-alias-settings-card-fill, var(--dsw-alias-bg-layer-2));
  padding: 12px 14px;
  margin-bottom: 10px;
}
.dm-card-title { font-size: 13px; font-weight: 600; margin-bottom: 6px; }
.dm-hint { font-size: 11px; color: var(--dsw-alias-label-tertiary); margin-bottom: 6px; }
.dm-meta {
  font-size: 11px;
  color: var(--dsw-alias-label-tertiary);
  margin-top: 6px;
  display: flex;
  gap: 10px;
  align-items: center;
  flex-wrap: wrap;
}
.dm-body { font-size: 13px; white-space: pre-wrap; overflow-wrap: anywhere; }
.dm-body-sm { font-size: 12px; white-space: pre-wrap; overflow-wrap: anywhere; }
.dm-empty { font-size: 12px; color: var(--dsw-alias-label-tertiary); padding: 28px 0; text-align: center; }
.dm-error {
  font-size: 12px;
  color: var(--dsw-alias-state-error-primary);
  border: 1px solid var(--dsw-alias-state-error-primary);
  border-radius: var(--dsw-radius-sm, 8px);
  padding: 6px 10px;
  margin: 0 18px 10px;
}
.dm-toolbar { display: flex; gap: 8px; align-items: center; margin-bottom: 12px; flex-wrap: wrap; }
.dm-input {
  font: inherit;
  font-size: 12px;
  border: 1px solid var(--dsw-alias-border-l2);
  border-radius: var(--dsw-radius-sm, 8px);
  padding: 5px 8px;
  background: var(--dsw-alias-bg-layer-1);
  color: var(--dsw-alias-label-primary);
  outline: none;
  transition: border-color var(--ds-transition-duration-fast, .1s) var(--ds-ease-in-out, ease-in-out);
}
.dm-input:focus { border-color: var(--dsw-alias-label-tertiary); }
.dm-input::placeholder { color: var(--dsw-alias-label-tertiary); }
.dm-stats { display: flex; gap: 10px; flex-wrap: wrap; margin-bottom: 14px; }
.dm-stat {
  flex: 1 1 90px;
  border: 1px solid var(--dsw-alias-settings-card-stroke, var(--dsw-alias-border-l2));
  border-radius: var(--dsw-radius-md, 12px);
  background: var(--dsw-alias-settings-card-fill, var(--dsw-alias-bg-layer-2));
  padding: 12px 14px;
}
.dm-stat-label { font-size: 11px; color: var(--dsw-alias-label-secondary); }
.dm-stat-value { font-size: 20px; font-weight: 600; font-variant-numeric: tabular-nums; }
.dm-row { border-top: 1px solid var(--dsw-alias-border-l1); padding-top: 8px; margin-top: 8px; }
.dm-id-label { font-size: 11px; color: var(--dsw-alias-label-tertiary); margin-bottom: 4px; font-variant-numeric: tabular-nums; }
.dm-preset-id { font-size: 12px; font-weight: 600; color: var(--dsw-alias-link); margin-bottom: 4px; }
.dm-flag-title { font-size: 13px; font-weight: 600; margin-bottom: 2px; }
.dm-flag-hint { font-size: 11px; color: var(--dsw-alias-label-tertiary); margin-bottom: 4px; }
.dm-toggle { display: flex; align-items: flex-start; gap: 8px; padding: 6px 0; cursor: pointer; }
.dm-toggle input { margin-top: 3px; cursor: pointer; accent-color: var(--dsw-alias-link); }
.dm-toggle-text { display: flex; flex-direction: column; }
.dm-toggle-label { font-size: 13px; }
.dm-toggle-hint { font-size: 11px; color: var(--dsw-alias-label-tertiary); }
.dm-inline { display: flex; align-items: center; gap: 8px; margin-bottom: 6px; flex-wrap: wrap; }
.dm-diary-head { cursor: pointer; display: flex; gap: 10px; align-items: center; }
.dm-diary-day { font-size: 13px; font-weight: 600; }
.dm-diary-toggle { font-size: 11px; color: var(--dsw-alias-label-secondary); }
.dm-diary-body { font-size: 13px; white-space: pre-wrap; overflow-wrap: anywhere; margin-top: 10px; }
.dm-chips { display: inline-flex; align-items: center; gap: 3px; margin-right: 4px; }
.dm-chip {
  cursor: pointer;
  user-select: none;
  box-sizing: border-box;
  width: 16px;
  height: 16px;
  line-height: 14px;
  text-align: center;
  border-radius: var(--dsw-radius-xs, 4px);
  border: 1px solid var(--dsw-alias-border-l2);
  background: transparent;
  color: var(--dsw-alias-label-tertiary);
  font-size: 10px;
  font-weight: 600;
  transition: background var(--ds-transition-duration-fast, .1s) var(--ds-ease-in-out, ease-in-out),
              color var(--ds-transition-duration-fast, .1s) var(--ds-ease-in-out, ease-in-out),
              border-color var(--ds-transition-duration-fast, .1s) var(--ds-ease-in-out, ease-in-out),
              opacity var(--ds-transition-duration-fast, .1s) var(--ds-ease-in-out, ease-in-out);
}
.dm-chip:hover { border-color: var(--dsw-alias-label-tertiary); }
.dm-chip[data-on='true'] {
  border-color: transparent;
  background: var(--dsw-alias-button-primary-fill);
  color: var(--dsw-alias-label-primary-foreground);
}
.dm-chip[data-busy='true'] { opacity: .5; cursor: default; }
`

    /**
     * Injects the stylesheet once. The host loads each bundle's client module
     * in its own `__ModuleLoader__` call, so a re-activation (HMR, plugin
     * reload) would otherwise stack duplicates; the marker attribute makes the
     * second install a no-op.
     */
    function installStyle() {
      if (typeof document === 'undefined') return
      if (document.querySelector(`style[data-plugin-css="${STYLE_MARK}"]`) !== null) return
      const style = document.createElement('style')
      style.dataset.plugin = '@emo-bird/dsh-deepmemory'
      style.dataset.pluginCss = STYLE_MARK
      style.textContent = CSS
      document.head.appendChild(style)
    }

    // ------------------------------------------------------------------- data

    async function apiGet(path, params) {
      const query = params === undefined ? '' : `?${new URLSearchParams(params).toString()}`
      const response = await fetch(`${API}${path}${query}`, { headers: { accept: 'application/json' } })
      if (!response.ok) throw new Error(`${path} ${response.status}`)
      return response.json()
    }

    async function apiPost(path, body) {
      const response = await fetch(`${API}${path}`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(body),
      })
      if (!response.ok) throw new Error(`${path} ${response.status}`)
      return response.json()
    }

    const fmtTime = (ms) => {
      const d = new Date(Number(ms))
      const pad = (n) => String(n).padStart(2, '0')
      return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`
    }

    // -------------------------------------------------------------- primitives

    function Button({ children, onClick, kind, disabled, title }) {
      return h(
        'button',
        {
          type: 'button',
          className: 'dm-btn',
          'data-kind': kind ?? 'ghost',
          onClick: disabled ? undefined : onClick,
          disabled: disabled === true,
          title,
        },
        children,
      )
    }

    function Toggle({ checked, onChange, label, hint }) {
      return h(
        'label',
        { className: 'dm-toggle' },
        h('input', { type: 'checkbox', checked, onChange: (event) => onChange(event.target.checked) }),
        h(
          'span',
          { className: 'dm-toggle-text' },
          h('span', { className: 'dm-toggle-label' }, label),
          hint === undefined ? null : h('span', { className: 'dm-toggle-hint' }, hint),
        ),
      )
    }

    const Card = ({ children, title }) =>
      h(
        'div',
        { className: 'dm-card' },
        title === undefined ? null : h('div', { className: 'dm-card-title' }, title),
        children,
      )

    const Empty = ({ children }) => h('div', { className: 'dm-empty' }, children)

    const Toolbar = ({ children }) => h('div', { className: 'dm-toolbar' }, children)

    const ErrorBar = ({ error }) => (error === null ? null : h('div', { className: 'dm-error' }, error))

    // ------------------------------------------------------------------ views

    function Overview({ stats, onReload }) {
      const rows = [
        ['事实', stats?.facts ?? 0],
        ['片段', stats?.episodes ?? 0],
        ['日记', stats?.diary ?? 0],
        ['覆盖天数', stats?.days ?? 0],
        ['向量', stats?.vectors ?? 0],
      ]
      return h(
        'div',
        null,
        h(
          'div',
          { className: 'dm-stats' },
          rows.map(([label, value]) =>
            h(
              'div',
              { key: label, className: 'dm-stat' },
              h('div', { className: 'dm-stat-label' }, label),
              h('div', { className: 'dm-stat-value' }, String(value)),
            ),
          ),
        ),
        h(
          'div',
          { className: 'dm-hint' },
          '记忆是本地 sqlite 里的一层缓存；会话日志才是真源。换嵌入模型、改表结构后重建一次即可。',
        ),
        h(
          Toolbar,
          null,
          h(Button, { onClick: onReload }, '刷新'),
          h(
            Button,
            {
              onClick: async () => {
                await apiPost('/rebuild', {})
                onReload()
              },
            },
            '重建检索索引',
          ),
        ),
      )
    }

    function Facts({ items, onReload }) {
      const [query, setQuery] = useState('')
      const shown = useMemo(() => {
        const needle = query.trim().toLowerCase()
        if (needle === '') return items
        return items.filter((item) => `${item.text} ${item.subject}`.toLowerCase().includes(needle))
      }, [items, query])

      return h(
        'div',
        null,
        h(
          Toolbar,
          null,
          h('input', {
            className: 'dm-input',
            value: query,
            placeholder: '过滤…',
            onChange: (event) => setQuery(event.target.value),
            style: { flex: 1, minWidth: 160 },
          }),
          h(Button, { onClick: onReload }, '刷新'),
        ),
        shown.length === 0
          ? h(Empty, null, '还没有事实。让 agent 说「记住…」，或在对话里主动记一条。')
          : shown.map((item) =>
              h(
                Card,
                { key: item.id },
                h('div', { className: 'dm-body' }, item.text),
                h(
                  'div',
                  { className: 'dm-meta' },
                  h('span', null, `权重 ${item.weight}`),
                  item.subject === '' ? null : h('span', null, `对象 ${item.subject}`),
                  h('span', null, fmtTime(item.createdAt)),
                  h('span', { className: 'dm-spacer' }),
                  h(
                    Button,
                    {
                      onClick: async () => {
                        await apiPost('/forget', { kind: 'fact', id: item.id })
                        onReload()
                      },
                    },
                    '删除',
                  ),
                ),
              ),
            ),
      )
    }

    function Episodes({ items, onReload }) {
      return h(
        'div',
        null,
        h(Toolbar, null, h(Button, { onClick: onReload }, '刷新')),
        items.length === 0
          ? h(Empty, null, '还没有录到片段。开启「写入」后，用户在任意会话里说的话都会进来。')
          : items.map((item) =>
              h(
                Card,
                { key: item.id },
                h('div', { className: 'dm-body-sm' }, item.text),
                h(
                  'div',
                  { className: 'dm-meta' },
                  h('span', null, item.day),
                  h('span', null, fmtTime(item.createdAt)),
                  item.presetId === '' ? null : h('span', null, item.presetId),
                  h('span', null, item.sessionId.slice(0, 12)),
                ),
              ),
            ),
      )
    }

    function Diary({ items, onReload }) {
      const [open, setOpen] = useState(null)
      return h(
        'div',
        null,
        h(
          Toolbar,
          null,
          h(Button, { onClick: onReload }, '刷新'),
          h('span', { className: 'dm-hint', style: { marginBottom: 0 } }, '日记由定时任务每天写一篇，覆盖当天所有会话。'),
        ),
        items.length === 0
          ? h(Empty, null, '还没有日记。')
          : items.map((page) => {
              const expanded = open === page.day
              return h(
                Card,
                { key: page.day },
                h(
                  'div',
                  {
                    className: 'dm-diary-head',
                    onClick: () => setOpen(expanded ? null : page.day),
                  },
                  h('span', { className: 'dm-diary-day' }, page.day),
                  h('span', { className: 'dm-hint', style: { marginBottom: 0 } }, `${page.text.length} 字`),
                  h('span', { className: 'dm-spacer' }),
                  h('span', { className: 'dm-diary-toggle' }, expanded ? '收起' : '展开'),
                ),
                expanded ? h('div', { className: 'dm-diary-body' }, page.text) : null,
              )
            }),
      )
    }

    function FlagRow({ title, hint, flags, onChange }) {
      return h(
        'div',
        { style: { marginBottom: 8 } },
        h('div', { className: 'dm-flag-title' }, title),
        hint === undefined ? null : h('div', { className: 'dm-flag-hint' }, hint),
        h(Toggle, { checked: flags.recall, onChange: (value) => onChange({ recall: value }), label: '读记忆' }),
        h(Toggle, { checked: flags.write, onChange: (value) => onChange({ write: value }), label: '写记忆' }),
        h(Toggle, { checked: flags.diary, onChange: (value) => onChange({ diary: value }), label: '计入日记' }),
      )
    }

    function Settings({ snapshot, onReload }) {
      const [busy, setBusy] = useState(false)
      const [dependency, setDependency] = useState(null)
      const [installing, setInstalling] = useState(false)
      const [diaryTask, setDiaryTask] = useState(null)
      const [diaryTime, setDiaryTime] = useState('23:40')
      const presets = Object.keys(snapshot.presets).sort()
      const sessions = Object.keys(snapshot.sessions).sort()

      useEffect(() => {
        apiGet('/dependency')
          .then(setDependency)
          .catch(() => setDependency({ installed: false }))
        apiGet('/diary-task')
          .then((body) => {
            setDiaryTask(body)
            if (typeof body?.time === 'string') setDiaryTime(body.time)
          })
          .catch(() => setDiaryTask({ scheduled: false }))
      }, [])

      const save = useCallback(
        async (scope, id, flags, presetId) => {
          setBusy(true)
          try {
            await apiPost('/settings', { scope, id, flags, presetId })
            onReload()
          } finally {
            setBusy(false)
          }
        },
        [onReload],
      )

      return h(
        'div',
        null,
        h(ErrorBar, { error: busy ? '保存中…' : null }),
        h(
          Card,
          { title: '全局默认' },
          h(FlagRow, {
            title: '所有会话',
            hint: '没有被下面两层覆盖的会话都用这套。',
            flags: snapshot.global,
            onChange: (patch) => save('global', undefined, patch),
          }),
        ),
        h(
          Card,
          { title: '按 preset 默认' },
          presets.length === 0
            ? h(Empty, null, '还没有 preset 覆盖。')
            : presets.map((id) =>
                h(
                  'div',
                  { key: id, className: 'dm-row' },
                  h('div', { className: 'dm-preset-id' }, id),
                  h(FlagRow, {
                    title: '继承全局，可单独覆盖',
                    flags: snapshot.presets[id],
                    onChange: (patch) => save('preset', id, patch),
                  }),
                ),
              ),
        ),
        h(
          Card,
          { title: '按会话覆盖' },
          sessions.length === 0
            ? h(Empty, null, '还没有会话级覆盖。在会话标题栏点那三个小方块，就会为那个会话建一条。')
            : sessions.map((id) =>
                h(
                  'div',
                  { key: id, className: 'dm-row' },
                  h('div', { className: 'dm-id-label' }, id),
                  h(FlagRow, {
                    title: '本会话',
                    flags: snapshot.sessions[id],
                    onChange: (patch) => save('session', id, patch),
                  }),
                  h(
                    Button,
                    {
                      onClick: async () => {
                        await apiPost('/settings', { scope: 'clear-session', id })
                        onReload()
                      },
                    },
                    '恢复继承',
                  ),
                ),
              ),
        ),
        h(
          Card,
          { title: '每天写日记' },
          h(
            'div',
            { className: 'dm-hint' },
            '由 DSH 定时任务在固定时间开一个新会话，把当天所有会话的片段汇总成一篇日记。没有对话的日子不写。',
          ),
          h(
            'div',
            { className: 'dm-inline' },
            h('input', {
              className: 'dm-input',
              type: 'time',
              value: diaryTime,
              onChange: (event) => setDiaryTime(event.target.value),
            }),
            h(
              Button,
              {
                kind: diaryTask?.scheduled === true ? 'ghost' : 'primary',
                onClick: async () => {
                  setBusy(true)
                  try {
                    setDiaryTask(await apiPost('/diary-task', { action: 'enable', time: diaryTime }))
                  } finally {
                    setBusy(false)
                  }
                },
              },
              diaryTask?.scheduled === true ? '更新时间' : '开启',
            ),
            diaryTask?.scheduled === true
              ? h(
                  Button,
                  {
                    onClick: async () => {
                      setBusy(true)
                      try {
                        setDiaryTask(await apiPost('/diary-task', { action: 'disable' }))
                      } finally {
                        setBusy(false)
                      }
                    },
                  },
                  '关闭',
                )
              : null,
          ),
          h(
            'div',
            { className: 'dm-meta', style: { marginTop: 0 } },
            diaryTask?.scheduled === true
              ? `已开启：每天 ${diaryTask.time ?? diaryTime}（${diaryTask.zone ?? ''}），状态 ${diaryTask.status ?? 'active'}`
              : '当前没有定时任务。',
          ),
        ),
        h(
          Card,
          { title: '语义检索（第三档）' },
          h(
            'div',
            { className: 'dm-hint' },
            '默认只跑 FTS5 与中文 bigram 重排。开启嵌入重排需要先安装依赖与模型，未安装时请保持关闭。',
          ),
          h(
            'div',
            {
              className: 'dm-hint',
              style: { color: dependency?.installed === true ? 'var(--dsw-alias-label-secondary)' : 'var(--dsw-alias-state-error-primary)' },
            },
            dependency?.installed === true
              ? `依赖已安装：${dependency.name}（模型缓存 ${dependency.models?.length ?? 0} 个）`
              : `依赖未安装：${dependency?.name ?? '@huggingface/transformers'}（约 300 MB，只装进插件自己的 vendor 目录）`,
          ),
          h(
            Button,
            {
              disabled: installing,
              onClick: async () => {
                setInstalling(true)
                try {
                  const result = await apiPost('/dependency', { action: 'install' })
                  setDependency(result)
                } finally {
                  setInstalling(false)
                }
              },
            },
            installing ? '安装中…（几分钟）' : dependency?.installed === true ? '重新安装依赖' : '安装依赖',
          ),
          h(Toggle, {
            checked: snapshot.semantic?.enabled === true,
            onChange: async (value) => {
              await apiPost('/settings', { scope: 'semantic', semantic: { enabled: value } })
              onReload()
            },
            label: '启用嵌入重排',
            hint:
              dependency?.installed === true
                ? (snapshot.semantic?.modelPath ?? '使用默认模型 bge-small-zh-v1.5')
                : '依赖未安装时开启不会生效，第三档只会保持关闭。',
          }),
        ),
      )
    }

    // -------------------------------------------------- session header chips

    /**
     * Three one-letter chips in the session title bar.
     *
     * The header clips overflow and has no room for labels, so each chip is a
     * single glyph whose fill carries the state. Fill and foreground come from
     * the paired tokens, so "on" stays legible in both palettes.
     */
    const CHIPS = [
      { key: 'recall', glyph: '读', title: '本会话读取记忆' },
      { key: 'write', glyph: '写', title: '本会话写入记忆' },
      { key: 'diary', glyph: '日', title: '本会话计入日记' },
    ]

    function HeaderFlags({ sessionId }) {
      const [flags, setFlags] = useState(null)
      const [busy, setBusy] = useState(false)

      const load = useCallback(async () => {
        if (sessionId === undefined) return
        try {
          const body = await apiGet('/session-flags', { sessionId })
          setFlags(body.effective)
        } catch {
          setFlags(null)
        }
      }, [sessionId])

      useEffect(() => {
        load()
      }, [load])

      if (sessionId === undefined || flags === null) return null

      const flip = async (key) => {
        if (busy) return
        setBusy(true)
        try {
          const body = await apiPost('/session-flags', {
            sessionId,
            flags: { [key]: flags[key] !== true },
          })
          setFlags(body.effective)
        } catch {
          // Leave the chips as they were; the click simply did not take.
        } finally {
          setBusy(false)
        }
      }

      return h(
        'div',
        { className: 'dm-chips' },
        CHIPS.map((chip) => {
          const on = flags[chip.key] === true
          return h(
            'span',
            {
              key: chip.key,
              className: 'dm-chip',
              'data-on': on ? 'true' : 'false',
              'data-busy': busy ? 'true' : 'false',
              title: `${chip.title}：${on ? '开' : '关'}（点击切换）`,
              onClick: () => flip(chip.key),
            },
            chip.glyph,
          )
        }),
      )
    }

    // ------------------------------------------------------------------ shell

    function Panel() {
      const [tab, setTab] = useState('overview')
      const [error, setError] = useState(null)
      const [loading, setLoading] = useState(false)
      const [stats, setStats] = useState(null)
      const [facts, setFacts] = useState([])
      const [episodes, setEpisodes] = useState([])
      const [diaryPages, setDiaryPages] = useState([])
      const [settings, setSettings] = useState({ global: { recall: true, write: true, diary: true }, presets: {}, sessions: {}, semantic: {} })

      const reload = useCallback(async () => {
        setLoading(true)
        setError(null)
        try {
          const [statsBody, factsBody, episodesBody, diaryBody, settingsBody] = await Promise.all([
            apiGet('/stats'),
            apiGet('/facts'),
            apiGet('/episodes'),
            apiGet('/diary'),
            apiGet('/settings'),
          ])
          setStats(statsBody)
          setFacts(factsBody.items ?? [])
          setEpisodes(episodesBody.items ?? [])
          setDiaryPages(diaryBody.items ?? [])
          setSettings(settingsBody)
        } catch (cause) {
          setError(`读取失败：${String(cause?.message ?? cause)}`)
        } finally {
          setLoading(false)
        }
      }, [])

      useEffect(() => {
        reload()
      }, [reload])

      const body =
        tab === 'overview'
          ? h(Overview, { stats, onReload: reload })
          : tab === 'facts'
            ? h(Facts, { items: facts, onReload: reload })
            : tab === 'episodes'
              ? h(Episodes, { items: episodes, onReload: reload })
              : tab === 'diary'
                ? h(Diary, { items: diaryPages, onReload: reload })
                : h(Settings, { snapshot: settings, onReload: reload })

      return h(
        'div',
        { className: 'dm-page' },
        h(
          'div',
          { className: 'dm-head' },
          h('div', { className: 'dm-title' }, '深度记忆'),
          h('div', { className: 'dm-sub' }, loading ? '读取中…' : '本地 sqlite · 三档检索'),
          h('span', { className: 'dm-spacer' }),
          h(Button, { onClick: reload, disabled: loading }, '刷新'),
        ),
        h(
          'div',
          { className: 'dm-tabs' },
          TABS.map((item) =>
            h(
              'div',
              {
                key: item.id,
                className: 'dm-tab',
                'data-active': tab === item.id ? 'true' : 'false',
                onClick: () => setTab(item.id),
              },
              item.label,
            ),
          ),
        ),
        h(ErrorBar, { error }),
        h('div', { className: 'dm-scroll' }, body),
      )
    }

    /**
     * The sidebar owns the button and its tint, so the glyph inherits colour via
     * `currentColor` instead of picking one: the same icon then reads correctly
     * on a light and a dark sidebar, active or not.
     */
    function SidebarIcon({ size }) {
      const edge = typeof size === 'number' ? size : 18
      return h(
        'svg',
        {
          width: edge,
          height: edge,
          viewBox: '0 0 24 24',
          fill: 'none',
          stroke: 'currentColor',
          strokeWidth: 1.7,
          strokeLinecap: 'round',
          strokeLinejoin: 'round',
          'aria-hidden': true,
        },
        h('path', { d: 'M12 3a5 5 0 0 1 5 5c1.7.6 3 2.2 3 4.2 0 1.6-.8 3-2 3.9V19a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2v-2.9c-1.2-.9-2-2.3-2-3.9 0-2 1.3-3.6 3-4.2a5 5 0 0 1 5-5z' }),
        h('path', { d: 'M9 21v-3M15 21v-3' }),
      )
    }

    return {
      inject: ['slots', 'locale'],
      apply(ctx) {
        installStyle()
        ctx.slots.inject('sidebar.panellist', () =>
          ctx.slots.register(
            {
              name: 'sidebar.panellist',
              id: PANEL_ID,
              order: 25,
              label: '深度记忆',
            },
            SidebarIcon,
          ),
        )
        ctx.slots.inject('main', () =>
          ctx.slots.register({ name: 'main', key: PANEL_ID }, Panel),
        )
        // The session-scoped slot hands the component a `sessionId` prop, so one
        // registration serves every conversation.
        ctx.slots.inject('conversation.session.header.actions', () =>
          ctx.slots.register(
            { name: 'conversation.session.header.actions', id: 'deepmemory-flags', order: 15 },
            HeaderFlags,
          ),
        )
      },
    }
  },
})
