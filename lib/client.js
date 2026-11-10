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
      { id: 'search', label: '搜索' },
      { id: 'diary', label: '日记' },
      { id: 'sessions', label: '会话' },
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
.dm-table { width: 100%; border-collapse: collapse; font-size: 13px; }
.dm-th {
  text-align: left;
  font-size: 11px;
  font-weight: 600;
  color: var(--dsw-alias-label-secondary);
  padding: 6px 8px;
  border-bottom: 1px solid var(--dsw-alias-border-l2);
  white-space: nowrap;
}
.dm-th-flag { width: 40px; text-align: center; }
.dm-table tbody tr { border-bottom: 1px solid var(--dsw-alias-border-l1); }
.dm-table tbody tr:last-child { border-bottom: 0; }
.dm-table tbody tr:hover { background: var(--dsw-alias-interactive-bg-hover); }
.dm-table td { padding: 7px 8px; vertical-align: top; }
.dm-cell-name { max-width: 420px; }
.dm-cell-title { font-weight: 600; overflow-wrap: anywhere; }
.dm-cell-first {
  color: var(--dsw-alias-label-secondary);
  max-width: 360px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.dm-cell-flag { text-align: center; }
.dm-cell-flag input { cursor: pointer; accent-color: var(--dsw-alias-link); }
.dm-link { color: var(--dsw-alias-link); text-decoration: none; cursor: pointer; }
/* Destructive links need more weight than the error colour alone gives in the
   light palette, where it sits at roughly 4:1 against the card. */
.dm-link-danger { color: var(--dsw-alias-state-error-primary); font-weight: 600; text-decoration: underline; text-underline-offset: 2px; }
.dm-link-danger:hover { text-decoration-thickness: 2px; }
.dm-link:hover { text-decoration: underline; }
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
.dm-role {
  font-size: 10px;
  font-weight: 600;
  padding: 0 5px;
  border-radius: var(--dsw-radius-xs, 4px);
  border: 1px solid var(--dsw-alias-border-l2);
  color: var(--dsw-alias-label-secondary);
}
.dm-role[data-role='assistant'] {
  border-color: transparent;
  background: var(--dsw-alias-button-primary-fill);
  color: var(--dsw-alias-label-primary-foreground);
}
.dm-search {
  display: flex;
  align-items: center;
  gap: 6px;
  flex: 1;
  max-width: 380px;
}
.dm-hit {
  display: flex;
  gap: 8px;
  align-items: baseline;
  padding: 6px 0;
  border-bottom: 1px solid var(--dsw-alias-border-l1);
}
.dm-hit:last-child { border-bottom: 0; }
.dm-hit-kind {
  flex: none;
  min-width: 34px;
  text-align: center;
  font-size: 10px;
  font-weight: 600;
  padding: 1px 5px;
  border-radius: var(--dsw-radius-xs, 4px);
  border: 1px solid var(--dsw-alias-border-l2);
  color: var(--dsw-alias-label-secondary);
}
.dm-hit-body { flex: 1; min-width: 0; word-break: break-word; }
.dm-sid {
  font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
  font-size: 10px;
  word-break: break-all;
  color: var(--dsw-alias-label-tertiary);
}
.dm-progress {
  height: 6px;
  border-radius: 3px;
  background: var(--dsw-alias-bg-layer-3);
  overflow: hidden;
  margin: 6px 0 4px;
}
.dm-progress-fill {
  height: 100%;
  background: var(--dsw-alias-link);
  transition: width var(--ds-transition-duration-fast, .1s) var(--ds-ease-in-out, ease);
}
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

    const MB = 1024 * 1024
    const megabytes = (bytes) => (Math.max(0, Number(bytes) || 0) / MB).toFixed(1)

    /**
     * "12.4 MB / 320.0 MB (4%)" with a bar underneath.
     *
     * The denominator is the host's estimate, not a measured total, so the bar
     * is a progress hint rather than a countdown. When the install finishes the
     * number shown is the real size on disk.
     */
    function renderProgress(progress, installing) {
      if (progress === null || progress === undefined) return null
      if (progress.phase === 'idle') return null
      const bytes = Number(progress.bytes) || 0
      const total = Number(progress.totalBytes) || 0
      const pct = total > 0 ? Math.min(100, Math.round((bytes / total) * 100)) : 0
      const label = `${megabytes(bytes)} MB / ${total > 0 ? `${megabytes(total)} MB` : '—'}${total > 0 ? `（${pct}%）` : ''}`
      const note =
        progress.phase === 'error'
          ? `安装失败：${progress.error ?? '未知错误'}`
          : installing || progress.phase === 'installing'
            ? `正在写入 ${label}`
            : `已落盘 ${label}`
      return h(
        'div',
        null,
        h(
          'div',
          { className: 'dm-progress' },
          h('div', {
            className: 'dm-progress-fill',
            style: { width: `${installing || progress.phase === 'installing' ? Math.max(2, pct) : 100}%` },
          }),
        ),
        h('div', { className: 'dm-meta', style: { marginTop: 0 } }, note),
      )
    }

    // ------------------------------------------------------------------ views

    function Overview({ stats, onReload }) {
      const rows = [
        ['事实', stats?.facts ?? 0],
        ['片段', stats?.episodes ?? 0],
        ['日记', stats?.diary ?? 0],
        ['覆盖天数', stats?.days ?? 0],
        ['向量', stats?.vectors ?? 0],
      ]
      const [note, setNote] = useState('')
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
                setNote('重建中…')
                try {
                  const body = await apiPost('/rebuild', {})
                  setNote(
                    `已重建：事实 ${body?.facts ?? 0} 条、片段 ${body?.episodes ?? 0} 条、日记 ${body?.diary ?? 0} 篇。`,
                  )
                } catch (cause) {
                  setNote(`重建失败：${String(cause?.message ?? cause)}`)
                }
                onReload()
              },
            },
            '重建检索索引',
          ),
          note === '' ? null : h('div', { className: 'dm-note' }, note),
        ),
      )
    }

    function Facts({ items, onReload }) {
      const [query, setQuery] = useState('')
      const rows = Array.isArray(items) ? items : []
      const shown = useMemo(() => {
        const needle = query.trim().toLowerCase()
        if (needle === '') return rows
        return rows.filter((item) => `${item.text} ${item.subject}`.toLowerCase().includes(needle))
      }, [rows, query])

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

    const ROLE_LABEL = { user: '你', assistant: '它' }

    /** "小肥鱼 (xiaofeiyu)" when the roster carries a name, else the bare id. */
    const presetLabel = (snapshot, id) => {
      const name = snapshot?.presetLabels?.[id] ?? ''
      if (name === '' || name === id) return id
      return `${name}（${id}）`
    }

    function Episodes({ items, onReload, filter, onClearFilter }) {
      const [busy, setBusy] = useState(false)
      const remove = async (item) => {
        if (!window.confirm('删掉这条片段？删了就找不回来。')) return
        setBusy(true)
        try {
          await apiPost('/forget', { kind: 'episode', id: item.id })
          onReload()
        } finally {
          setBusy(false)
        }
      }

      const shown = useMemo(() => {
        if (filter === undefined || filter === '') return items
        return items.filter((item) => item.sessionId === filter)
      }, [items, filter])

      return h(
        'div',
        null,
        h(
          Toolbar,
          null,
          h(Button, { onClick: onReload }, '刷新'),
          filter === undefined || filter === ''
            ? h('span', { className: 'dm-hint', style: { marginBottom: 0 } }, '双方的发言都记：你说的话，和它回的话。')
            : h(
                'span',
                { className: 'dm-hint', style: { marginBottom: 0 } },
                `只看这个会话：${filter}`,
                ' ',
                h('a', { className: 'dm-link', href: '#', onClick: (event) => { event.preventDefault(); onClearFilter?.() } }, '看全部'),
              ),
        ),
        shown.length === 0
          ? h(Empty, null, '还没有录到片段。开启「写入」后，任意会话里的对话都会进来。')
          : items.map((item) => {
              const who = ROLE_LABEL[item.role] ?? item.role
              return h(
                Card,
                { key: item.id },
                h(
                  'div',
                  { className: 'dm-meta', style: { marginTop: 0, marginBottom: 4 } },
                  h('span', { className: 'dm-role', 'data-role': item.role }, who),
                  h('span', null, item.day),
                  h('span', null, fmtTime(item.createdAt)),
                  item.presetId === '' ? null : h('span', null, item.presetId),
                  h('span', { className: 'dm-spacer' }),
                  h(Button, { disabled: busy, title: item.sessionId, onClick: () => remove(item) }, '删除'),
                ),
                h('div', { className: 'dm-body-sm' }, item.text),
                h('div', { className: 'dm-sid', title: item.sessionId }, item.sessionId),
              )
            }),
      )
    }

    function Diary({ items, onReload }) {
      const [open, setOpen] = useState(null)
      const [busy, setBusy] = useState(false)
      const remove = async (page) => {
        if (!window.confirm(`删掉 ${page.day} 的日记？删了就找不回来。`)) return
        setBusy(true)
        try {
          await apiPost('/forget', { kind: 'diary', day: page.day })
          onReload()
        } finally {
          setBusy(false)
        }
      }

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
                  h(Button, {
                    disabled: busy,
                    onClick: (event) => {
                      // The whole header toggles the page open; deleting is not a toggle.
                      event?.stopPropagation?.()
                      remove(page)
                    },
                  }, '删除'),
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
        h(Toggle, {
          checked: flags.forget,
          onChange: (value) => onChange({ forget: value }),
          label: '删除记忆',
          hint: '允许清空这个会话已记下的全部片段',
        }),
      )
    }

    const FLAG_COLUMNS = [
      { key: 'recall', label: '读', title: '读取记忆' },
      { key: 'write', label: '写', title: '写入记忆' },
      { key: 'diary', label: '日', title: '计入日记' },
      { key: 'forget', label: '删', title: '允许删除记忆' },
    ]

    /**
     * Which cells of a row are inherited rather than its own override.
     *
     * Both tables store only differences from their parent, so a cell with no
     * stored key is *following* the layer above. Drawing it exactly like an
     * explicit setting hides which switches this row actually owns.
     */
    const inheritedMap = (own) => {
      const stored = own === undefined || own === null ? {} : own
      const out = {}
      for (const column of FLAG_COLUMNS) out[column.key] = stored[column.key] === undefined
      return out
    }

    /** One checkbox per flag, sized for a table cell. */
    function FlagCells({ flags, disabled, onToggle, inherited }) {
      const followed = inherited === undefined ? {} : inherited
      return FLAG_COLUMNS.map((column) =>
        h(
          'td',
          { key: column.key, className: 'dm-cell-flag' },
          h('input', {
            type: 'checkbox',
            checked: flags[column.key] === true,
            disabled: disabled === true,
            'data-inherited': followed[column.key] === true ? 'true' : 'false',
            title: followed[column.key] === true ? `${column.title}（继承上层）` : column.title,
            'aria-label': column.title,
            onChange: (event) => onToggle({ [column.key]: event.target.checked }),
          }),
        ),
      )
    }

    const FlagHead = () =>
      h(
        'tr',
        null,
        h('th', { className: 'dm-th' }, '会话'),
        h('th', { className: 'dm-th' }, '首句'),
        FLAG_COLUMNS.map((column) => h('th', { key: column.key, className: 'dm-th dm-th-flag', title: column.title }, column.label)),
      )

    /**
     * Per-session and per-preset control, as one table per scope.
     *
     * A row is one conversation, and the four switches are its memory policy:
     * read, write, count toward the diary, and allow deletion. The preset table
     * sets what a *new* session starts from; the session table overrides it for
     * one conversation. Sessions come from the host's stored-session list, so
     * untouched conversations are listed too — the first line identifies them
     * better than the generated title does.
     */
    function SessionsView({ snapshot, sessions, onReload, onOpenSession }) {
      const [busy, setBusy] = useState(false)
      const [query, setQuery] = useState('')
      const presets = Object.keys(snapshot.presets).sort()

      const save = useCallback(
        async (scope, id, flags, presetId) => {
          setBusy(true)
          try {
            await apiPost('/settings', { scope, id, flags, presetId })
            announceFlags()
            onReload()
          } finally {
            setBusy(false)
          }
        },
        [onReload],
      )

      const shown = useMemo(() => {
        const needle = query.trim().toLowerCase()
        if (needle === '') return sessions
        return sessions.filter((row) =>
          `${row.title} ${row.firstLine ?? ''} ${row.sessionId} ${row.presetId ?? ''}`.toLowerCase().includes(needle),
        )
      }, [sessions, query])

      return h(
        'div',
        null,
        h(ErrorBar, { error: busy ? '保存中…' : null }),
        h(
          Card,
          { title: '新会话的默认值（按 preset）' },
          h(
            'div',
            { className: 'dm-hint' },
            '这里设的是默认值：用该 preset 新开的会话，没被单独覆盖过，就按这套走。改它不会影响已经存在的会话。',
          ),
          presets.length === 0
            ? h(Empty, null, '没有读到已挂载的 preset。')
            : h(
                'table',
                { className: 'dm-table' },
                h('thead', null, h(FlagHead, null)),
                h(
                  'tbody',
                  null,
                  presets.map((id) =>
                    h(
                      'tr',
                      { key: id },
                      h(
                        'td',
                        { className: 'dm-cell-name' },
                        h('div', { className: 'dm-cell-title' }, presetLabel(snapshot, id)),
                        h('div', { className: 'dm-sid' }, id),
                      ),
                      h('td', { className: 'dm-cell-first' }, '—'),
                      h(FlagCells, {
                        flags: snapshot.presets[id],
                        disabled: busy,
                        onToggle: (patch) => save('preset', id, patch),
                      }),
                    ),
                  ),
                ),
              ),
        ),
        h(
          Card,
          { title: `会话（${sessions.length}）` },
          h(
            Toolbar,
            null,
            h('input', {
              className: 'dm-input',
              value: query,
              placeholder: '按标题、首句、id 或 preset 过滤…',
              onChange: (event) => setQuery(event.target.value),
              style: { flex: 1, minWidth: 180 },
            }),
          ),
          shown.length === 0
            ? h(Empty, null, sessions.length === 0 ? '没有读到已存储的会话。' : '没有匹配的会话。')
            : h(
                'table',
                { className: 'dm-table' },
                h('thead', null, h(FlagHead, null)),
                h(
                  'tbody',
                  null,
                  shown.map((row) =>
                    h(
                      'tr',
                      { key: row.sessionId },
                      h(
                        'td',
                        { className: 'dm-cell-name' },
                        h('div', { className: 'dm-cell-title' }, row.title === '' ? row.sessionId : row.title),
                        h(
                          'div',
                          { className: 'dm-meta', style: { marginTop: 2 } },
                          h('span', { className: 'dm-sid' }, row.sessionId),
                          row.presetId === null ? null : h('span', null, row.presetId),
                          h(
                            'a',
                            {
                              className: 'dm-link',
                              href: '#',
                              onClick: (event) => {
                                event.preventDefault()
                                onOpenSession?.(row.sessionId)
                              },
                            },
                            '看片段',
                          ),
                          row.own === null ? null : h('span', { className: 'dm-preset-id' }, '已覆盖'),
                          row.own === null
                            ? null
                            : h(
                                'a',
                                {
                                  className: 'dm-link',
                                  href: '#',
                                  onClick: async (event) => {
                                    event.preventDefault()
                                    setBusy(true)
                                    try {
                                      await apiPost('/settings', { scope: 'clear-session', id: row.sessionId })
                                      onReload()
                                    } finally {
                                      setBusy(false)
                                    }
                                  },
                                },
                                '恢复继承',
                              ),
                          row.effective.forget === true
                            ? h(
                                'a',
                                {
                                  href: '#',
                                  className: 'dm-link dm-link-danger',
                                  onClick: async (event) => {
                                    event.preventDefault()
                                    setBusy(true)
                                    try {
                                      await apiPost('/forget', { kind: 'session', sessionId: row.sessionId })
                                      onReload()
                                    } finally {
                                      setBusy(false)
                                    }
                                  },
                                },
                                '清空本会话记忆',
                              )
                            : null,
                        ),
                      ),
                      h('td', { className: 'dm-cell-first' }, row.firstLine === '' ? '—' : row.firstLine),
                      h(FlagCells, {
                        flags: row.effective,
                        disabled: busy,
                        onToggle: (patch) => save('session', row.sessionId, patch, row.presetId ?? undefined),
                      }),
                    ),
                  ),
                ),
              ),
        ),
      )
    }

    function Settings({ snapshot, onReload }) {
      const [busy, setBusy] = useState(false)
      const [dependency, setDependency] = useState(null)
      const [installing, setInstalling] = useState(false)
      const [progress, setProgress] = useState(null)
      const [diaryTask, setDiaryTask] = useState(null)
      const [diaryTime, setDiaryTime] = useState('23:40')
      const [modelPath, setModelPath] = useState(snapshot?.semantic?.modelPath ?? '')
      const [remoteHost, setRemoteHost] = useState(snapshot?.semantic?.remoteHost ?? '')
      const [models, setModels] = useState(null)
      const [modelBusy, setModelBusy] = useState('')
      const [modelError, setModelError] = useState('')
      const [taskError, setTaskError] = useState('')
      const [taskBusy, setTaskBusy] = useState(false)

      const saveSemantic = useCallback(async (patch) => {
        await apiPost('/settings', { scope: 'semantic', semantic: patch })
      }, [])

      // npm reports no bytes, so the host measures the vendor directory while it
      // runs; polling that is what turns "安装中…" into a moving number.
      useEffect(() => {
        if (!installing) return undefined
        let alive = true
        const tick = async () => {
          try {
            const body = await apiGet('/dependency')
            if (alive) setProgress(body.progress ?? null)
          } catch {
            // A single failed poll is not worth interrupting the install.
          }
        }
        tick()
        const timer = setInterval(tick, 900)
        return () => {
          alive = false
          clearInterval(timer)
        }
      }, [installing])

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
        apiGet('/models')
          .then(setModels)
          .catch(() => setModels({ items: [], directory: '' }))
      }, [])

      const runModel = async (action, id) => {
        setModelBusy(`${action}:${id}`)
        setModelError('')
        try {
          if (action === 'reveal') {
            const body = await apiPost('/models', { action: 'reveal' })
            setModels((current) => (current === null ? current : { ...current, directory: body.directory ?? current.directory }))
            if (body.opened === false) setModelError(`打不开文件管理器，目录是：${body.directory ?? ''}`)
            return
          }
          const body = await apiPost('/models', { action, model: id })
          // Installing answers 202: the transfer runs in the host, and the
          // panel polls until it finishes so closing the page cannot cancel it.
          if (body?.started === true) {
            setModels((current) => (current === null ? current : { ...current, jobs: { ...(current.jobs ?? {}), [id]: body.job } }))
            pollModels()
            return
          }
          setModels(body)
        } catch (cause) {
          setModelError(String(cause?.message ?? cause))
        } finally {
          setModelBusy('')
        }
      }

      const pollModels = useCallback(() => {
        let alive = true
        const tick = async () => {
          if (!alive) return
          try {
            const body = await apiGet('/models')
            if (!alive) return
            setModels(body)
            const busy = Object.values(body?.jobs ?? {}).some((job) => job?.phase === 'downloading')
            if (busy) setTimeout(tick, 1000)
            else onReload?.()
          } catch {
            if (alive) setTimeout(tick, 3000)
          }
        }
        tick()
        return () => {
          alive = false
        }
      }, [onReload])

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
        h(ErrorBar, { error: taskBusy ? '保存中…' : null }),
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
                  setTaskBusy(true)
                  setTaskError('')
                  try {
                    const next = await apiPost('/diary-task', { action: 'enable', time: diaryTime })
                    setDiaryTask(next)
                  } catch (cause) {
                    setTaskError(`创建定时任务失败：${String(cause?.message ?? cause)}`)
                  } finally {
                    setTaskBusy(false)
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
                      setTaskBusy(true)
                      setTaskError('')
                      try {
                        const next = await apiPost('/diary-task', { action: 'disable' })
                        setDiaryTask(next)
                      } catch (cause) {
                        setTaskError(`关闭定时任务失败：${String(cause?.message ?? cause)}`)
                      } finally {
                        setTaskBusy(false)
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
          taskError === '' ? null : h('div', { className: 'dm-error' }, taskError),
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
              : `依赖未安装：${dependency?.name ?? '@huggingface/transformers'}（约 570 MB，只装进插件自己的 vendor 目录）`,
          ),
          h(
            'div',
            { className: 'dm-hint' },
            '模型默认从 huggingface.co 下载，国内常常连不上。可以在下面换镜像，或者自己把 ONNX 目录放进 vendor/models 再把路径指过去。',
          ),
          h('input', {
            className: 'dm-input',
            value: remoteHost,
            placeholder: '下载镜像，例如 https://hf-mirror.com（留空用默认）',
            onChange: (event) => setRemoteHost(event.target.value),
            onBlur: () => saveSemantic({ remoteHost: remoteHost.trim() === '' ? null : remoteHost.trim() }),
          }),
          h('input', {
            className: 'dm-input',
            value: modelPath,
            placeholder: '本地模型目录（留空用内置模型名）',
            onChange: (event) => setModelPath(event.target.value),
            onBlur: () => saveSemantic({ modelPath: modelPath.trim() === '' ? null : modelPath.trim() }),
          }),
          h(
            Button,
            {
              disabled: installing,
              onClick: async () => {
                setInstalling(true)
                setProgress({ phase: 'installing', bytes: 0, totalBytes: 0 })
                try {
                  const result = await apiPost('/dependency', { action: 'install' })
                  setDependency(result)
                  onReload()
                } catch (cause) {
                  setDependency({ installed: false, error: String(cause?.message ?? cause) })
                } finally {
                  setInstalling(false)
                }
              },
            },
            installing ? '安装中…（几分钟）' : dependency?.installed === true ? '重新安装依赖' : '安装依赖',
          ),
          renderProgress(progress, installing),
          dependency?.error === undefined || dependency.error === null
            ? null
            : h('div', { className: 'dm-error' }, dependency.error),
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
        h(
          Card,
          { title: '推荐嵌入模型' },
          h(
            'div',
            { className: 'dm-hint' },
            '装哪个模型就会切成哪个。模型文件落在插件的 vendor/models，不进 profile，删掉也不影响别的东西。',
          ),
          models === null
            ? h(Empty, null, '读取模型列表…')
            : h(
                'table',
                { className: 'dm-table' },
                h(
                  'thead',
                  null,
                  h(
                    'tr',
                    null,
                    h('th', { className: 'dm-th' }, '模型'),
                    h('th', { className: 'dm-th' }, '大小'),
                    h('th', { className: 'dm-th' }, '维度'),
                    h('th', { className: 'dm-th' }, '说明'),
                    h('th', { className: 'dm-th-flag' }, '状态'),
                    h('th', { className: 'dm-th-flag' }, '操作'),
                  ),
                ),
                h(
                  'tbody',
                  null,
                  (models.items ?? []).map((model) =>
                    h(
                      'tr',
                      { key: model.id },
                      h(
                        'td',
                        { className: 'dm-cell-name' },
                        h('div', { className: 'dm-cell-title' }, model.label),
                        h('div', { className: 'dm-sid' }, model.id),
                      ),
                      h('td', { className: 'dm-cell-first' }, model.size),
                      h('td', { className: 'dm-cell-first' }, String(model.dim)),
                      h('td', { className: 'dm-cell-first' }, model.note),
                      h(
                        'td',
                        { className: 'dm-cell-flag' },
                        (() => {
                          const job = models.jobs?.[model.id]
                          if (job?.phase === 'downloading') {
                            const done = megabytes(job.bytes)
                            const total = job.total > 0 ? megabytes(job.total) : '?'
                            return h('span', { className: 'dm-meta', style: { marginTop: 0 } }, `${done} / ${total} MB`)
                          }
                          if (job?.phase === 'error') return h('span', { className: 'dm-error' }, '失败')
                          return model.installed === true
                            ? h('span', { className: 'dm-role', 'data-role': 'assistant' }, '已装')
                            : h('span', { className: 'dm-meta', style: { marginTop: 0 } }, '未装')
                        })(),
                      ),
                      h(
                        'td',
                        { className: 'dm-cell-flag' },
                        model.installed === true
                          ? h(
                              Button,
                              {
                                disabled: modelBusy !== '',
                                onClick: () => runModel('remove', model.id),
                              },
                              modelBusy === `remove:${model.id}` ? '删除中' : '卸载',
                            )
                          : h(
                              Button,
                              {
                                disabled: modelBusy !== '',
                                onClick: () => runModel('install', model.id),
                              },
                              modelBusy === `install:${model.id}` ? '下载中' : '安装',
                            ),
                      ),
                    ),
                  ),
                ),
              ),
          h(
            Toolbar,
            null,
            h(Button, { onClick: () => runModel('reveal', '') }, '打开模型目录'),
            models?.directory === undefined || models.directory === ''
              ? null
              : h('span', { className: 'dm-sid' }, models.directory),
          ),
          modelError === '' ? null : h('div', { className: 'dm-error' }, modelError),
        ),
      )
    }

    // -------------------------------------------------- session header chips

    /**
     * Four one-letter chips in the session title bar.
     *
     * The header clips overflow and has no room for labels, so each chip is a
     * single glyph whose fill carries the state. Fill and foreground come from
     * the paired tokens, so "on" stays legible in both palettes.
     */
    /**
     * The chips and the panel read the same flags from different places, so a
     * write in one has to wake the other. There is no shared store in the
     * browser half, so this is the smallest thing that works: a set of
     * callbacks, pinged after any successful write.
     */
    const flagWatchers = new Set()

    function announceFlags() {
      for (const watcher of [...flagWatchers]) {
        try {
          watcher()
        } catch {
          // A unmounted watcher must not stop the rest.
        }
      }
    }

    const CHIPS = [
      { key: 'recall', glyph: '读', title: '本会话读取记忆' },
      { key: 'write', glyph: '写', title: '本会话写入记忆' },
      { key: 'diary', glyph: '日', title: '本会话计入日记' },
      { key: 'forget', glyph: '删', title: '本会话允许删除记忆' },
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
        flagWatchers.add(load)
        const onFocus = () => load()
        window.addEventListener('focus', onFocus)
        return () => {
          flagWatchers.delete(load)
          window.removeEventListener('focus', onFocus)
        }
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
          announceFlags()
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

    /** Kind labels for the search hits, which mix all three tables. */
    const KIND_LABEL = { fact: '事实', episode: '片段', diary: '日记' }

    /**
     * Results of one query, across facts, episodes and diary pages.
     *
     * This is the same pipeline the tools use (FTS5 → bigram rerank → optional
     * embeddings), so what the panel finds here is what the agent would find.
     */
    const SPLIT_TERMS = /[\s,，。、;；:：!！?？'"“”‘’()（）\[\]【】]+/u

    /** Terms the backend was asked for, so the hit can show *why* it matched. */
    function splitTerms(query) {
      return String(query)
        .split(SPLIT_TERMS)
        .map((term) => term.trim())
        .filter((term) => term !== '')
    }

    function highlight(text, query) {
      const body = String(text)
      const terms = splitTerms(query)
      if (terms.length === 0) return body
      const pattern = terms
        .map((term) => term.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'))
        .join('|')
      if (pattern === '') return body
      const re = new RegExp(`(${pattern})`, 'gi')
      return body
        .split(re)
        .map((part, index) =>
          terms.some((term) => term.toLowerCase() === part.toLowerCase())
            ? h('mark', { key: index, className: 'dm-mark' }, part)
            : part,
        )
    }

    function SearchResults({ query, hits, searching, onClear, onReload }) {
      const [busy, setBusy] = useState(false)
      // Clicking the tab lands here before any search ran, so `hits` is null.
      const list = Array.isArray(hits) ? hits : []
      const remove = async (hit) => {
        if (!window.confirm('删掉这条记录？删了就找不回来。')) return
        setBusy(true)
        try {
          if (hit.kind === 'fact') await apiPost('/forget', { kind: 'fact', id: hit.id })
          else if (hit.kind === 'episode') await apiPost('/forget', { kind: 'episode', id: hit.id })
          else await apiPost('/forget', { kind: 'diary', day: hit.day ?? hit.id })
          onReload()
        } finally {
          setBusy(false)
        }
      }

      return h(
        'div',
        null,
        h(
          Toolbar,
          null,
          h('span', { className: 'dm-hint', style: { marginBottom: 0 } }, searching ? '搜索中…' : query === '' ? '在事实、片段、日记里搜' : `「${query}」的结果 ${list.length} 条`),
          h('span', { className: 'dm-spacer' }),
          h(Button, { onClick: onClear }, '清除搜索'),
        ),
        list.length === 0
          ? h(Empty, null, query === '' ? '在上面输入关键词，回车。' : '没有命中。换几个词试试，或者确认对应开关是开着的。')
          : h(
              Card,
              null,
              list.map((hit) =>
                h(
                  'div',
                  { key: `${hit.kind}:${hit.id}`, className: 'dm-hit' },
                  h('span', { className: 'dm-hit-kind' }, KIND_LABEL[hit.kind] ?? hit.kind),
                  h(
                    'div',
                    { className: 'dm-hit-body' },
                    h('div', null, highlight(hit.text, query)),
                    h(
                      'div',
                      { className: 'dm-meta', style: { marginTop: 2 } },
                      h('span', null, hit.day ?? fmtTime(hit.createdAt)),
                      hit.sessionId === undefined ? null : h('span', { className: 'dm-sid' }, hit.sessionId),
                    ),
                  ),
                  h(Button, { disabled: busy, onClick: () => remove(hit) }, '删除'),
                ),
              ),
            ),
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
      const [sessions, setSessions] = useState([])
      const [query, setQuery] = useState('')
      const [hits, setHits] = useState(null)
      const [searching, setSearching] = useState(false)
      const [sessionFilter, setSessionFilter] = useState('')
      const [settings, setSettings] = useState({ global: { recall: true, write: true, diary: true }, presets: {}, sessions: {}, semantic: {} })

      const runSearch = useCallback(async (text) => {
        const trimmed = text.trim()
        if (trimmed === '') {
          setHits(null)
          return
        }
        setSearching(true)
        try {
          const body = await apiGet('/search', { q: trimmed, limit: 30 })
          setHits(body.hits ?? [])
        } catch (cause) {
          setError(`搜索失败：${String(cause?.message ?? cause)}`)
          setHits([])
        } finally {
          setSearching(false)
        }
      }, [])

      const reload = useCallback(async () => {
        setLoading(true)
        setError(null)
        try {
          const [statsBody, factsBody, episodesBody, diaryBody, settingsBody, sessionsBody] = await Promise.all([
            apiGet('/stats'),
            apiGet('/facts'),
            apiGet('/episodes'),
            apiGet('/diary'),
            apiGet('/settings'),
            // The stored-session list is the expensive one: it walks every
            // session the backend can see. A failure there must not blank the
            // rest of the panel, so it degrades to an empty list.
            apiGet('/sessions').catch(() => ({ items: [] })),
          ])
          setStats(statsBody)
          setFacts(factsBody.items ?? [])
          setEpisodes(episodesBody.items ?? [])
          setDiaryPages(diaryBody.items ?? [])
          setSettings(settingsBody)
          setSessions(sessionsBody.items ?? [])
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
              ? h(Episodes, {
                  items: episodes,
                  onReload: reload,
                  filter: sessionFilter,
                  onClearFilter: () => setSessionFilter(''),
                })
              : tab === 'search'
                ? h(SearchResults, {
                    query,
                    hits,
                    searching,
                    onClear: () => {
                      setHits(null)
                      setQuery('')
                    },
                    onReload: () => runSearch(query),
                  })
                : tab === 'diary'
                  ? h(Diary, { items: diaryPages, onReload: reload })
                  : tab === 'sessions'
                    ? h(SessionsView, {
                        snapshot: settings,
                        sessions,
                        onReload: reload,
                        onOpenSession: (id) => {
                          setSessionFilter(id)
                          setTab('episodes')
                        },
                      })
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
          h(
            'div',
            { className: 'dm-search' },
            h('input', {
              className: 'dm-input',
              value: query,
              placeholder: '搜索记忆（回车）',
              onChange: (event) => setQuery(event.target.value),
              onKeyDown: (event) => {
                if (event.key !== 'Enter') return
                setTab('search')
                runSearch(event.currentTarget.value)
              },
            }),
            h(
              Button,
              {
                onClick: () => {
                  setTab('search')
                  runSearch(query)
                },
                disabled: searching,
              },
              searching ? '搜索中' : '搜索',
            ),
          ),
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
     *
     * Identical geometry to `icon.svg` - the jellyfish body, its four legs and
     * the highlight are one path, and the highlight is a hole rather than a
     * second colour, so it works on any background. Only the paint differs: the
     * bundle icon uses the brand pink, this one uses currentColor.
     */
    function SidebarIcon({ size }) {
      const edge = typeof size === 'number' ? size : 18
      return h(
        'svg',
        {
          width: edge,
          height: edge,
          viewBox: '0 0 512 512',
          role: 'img',
          'aria-hidden': true,
        },
        h('path', {
          fill: 'currentColor',
          fillRule: 'evenodd',
          clipRule: 'evenodd',
          d: 'M 256 42.667 C 155.85 42.667 74.667 127.45 74.667 232 C 76.02 250.55 87.95 266.35 105.8 271.8 L 138.667 281.6 L 138.667 330.667 C 138.667 344.889 117.333 344.889 117.333 330.667 C 117.333 302.222 74.667 302.222 74.667 330.667 C 74.667 401.778 181.333 401.778 181.333 330.667 L 181.333 292.4 L 202.667 292.4 L 202.667 416 C 202.667 430.222 181.333 430.222 181.333 416 L 181.333 413.333 C 181.333 385.6 138.667 385.6 138.667 413.333 L 138.667 416 C 138.667 487.111 245.333 487.111 245.333 416 L 245.333 298.5 L 266.667 298.5 L 266.667 416 C 266.667 487.111 373.333 487.111 373.333 416 C 373.333 387.556 330.667 387.556 330.667 416 C 330.667 430.222 309.333 430.222 309.333 416 L 309.333 294.4 L 330.667 294.4 L 330.667 330.667 C 330.667 401.778 437.333 401.778 437.333 330.667 C 437.333 302.222 394.667 302.222 394.667 330.667 C 394.667 344.889 373.333 344.889 373.333 330.667 L 373.333 281.6 L 406.2 271.8 C 424.05 266.35 435.98 250.55 437.333 232 C 437.333 127.45 356.15 42.667 256 42.667 Z M 221.1 79.25 C 227.1 77.65 232.9 81.25 234.45 86.95 C 236 92.65 232.5 98.55 226.8 100.1 C 194.9 108.55 167.2 127.45 149.9 154.5 C 146.7 159.5 140.1 161 135.1 157.8 C 130.1 154.6 128.6 148 131.8 143 C 151.9 111.45 183.9 89.15 221.1 79.25 Z',
        }),
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
