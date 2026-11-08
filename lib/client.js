/**
 * Client half: the DeepMemory console.
 *
 * Registered in two slots, which must share one id — `sidebar.panellist` owns
 * the icon and resolves its label from list metadata, and `main` renders under
 * that same key when the entry is selected.
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

    const TABS = [
      { id: 'overview', label: '概览' },
      { id: 'facts', label: '事实' },
      { id: 'episodes', label: '片段' },
      { id: 'diary', label: '日记' },
      { id: 'settings', label: '设置' },
    ]

    const COLOR = {
      text: 'var(--dsw-alias-text-primary, #1f2329)',
      muted: 'var(--dsw-alias-text-secondary, #646a73)',
      faint: 'var(--dsw-alias-text-tertiary, #8f959e)',
      border: 'var(--dsw-alias-border-subtle, #dee0e3)',
      surface: 'var(--dsw-alias-surface-secondary, #f7f8fa)',
      accent: 'var(--dsw-alias-brand-primary, #3370ff)',
      danger: 'var(--dsw-alias-danger-primary, #f54a45)',
    }

    const font = (size, weight) => ({
      fontSize: size,
      fontWeight: weight ?? 400,
      lineHeight: 1.5,
    })

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

    // ------------------------------------------------------------- primitives

    function Button({ children, onClick, kind, disabled, title }) {
      const [hover, setHover] = useState(false)
      const base = {
        cursor: disabled ? 'default' : 'pointer',
        border: `1px solid ${kind === 'primary' ? 'transparent' : COLOR.border}`,
        background: disabled ? COLOR.surface : kind === 'primary' ? COLOR.accent : hover ? COLOR.surface : 'transparent',
        color: disabled ? COLOR.faint : kind === 'primary' ? '#fff' : COLOR.text,
        borderRadius: 6,
        padding: '4px 10px',
        ...font(12),
      }
      return h(
        'button',
        {
          type: 'button',
          onClick: disabled ? undefined : onClick,
          onMouseEnter: () => setHover(true),
          onMouseLeave: () => setHover(false),
          title,
          style: base,
        },
        children,
      )
    }

    function Toggle({ checked, onChange, label, hint }) {
      return h(
        'label',
        { style: { display: 'flex', alignItems: 'flex-start', gap: 8, padding: '6px 0', cursor: 'pointer' } },
        h('input', {
          type: 'checkbox',
          checked,
          onChange: (event) => onChange(event.target.checked),
          style: { marginTop: 3 },
        }),
        h(
          'span',
          { style: { display: 'flex', flexDirection: 'column' } },
          h('span', { style: { ...font(13), color: COLOR.text } }, label),
          hint === undefined ? null : h('span', { style: { ...font(11), color: COLOR.faint } }, hint),
        ),
      )
    }

    const Card = ({ children, style }) =>
      h(
        'div',
        {
          style: {
            border: `1px solid ${COLOR.border}`,
            borderRadius: 8,
            padding: '10px 12px',
            marginBottom: 10,
            background: 'transparent',
            ...style,
          },
        },
        children,
      )

    const Empty = ({ children }) =>
      h('div', { style: { ...font(12), color: COLOR.faint, padding: '24px 0', textAlign: 'center' } }, children)

    function Toolbar({ children }) {
      return h('div', { style: { display: 'flex', gap: 8, alignItems: 'center', marginBottom: 12, flexWrap: 'wrap' } }, children)
    }

    const ErrorBar = ({ error }) =>
      error === null
        ? null
        : h(
            'div',
            {
              style: {
                ...font(12),
                color: COLOR.danger,
                border: `1px solid ${COLOR.danger}`,
                borderRadius: 6,
                padding: '6px 10px',
                marginBottom: 10,
              },
            },
            error,
          )

    // ------------------------------------------------------------- overview

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
          { style: { display: 'flex', gap: 10, flexWrap: 'wrap', marginBottom: 14 } },
          rows.map(([label, value]) =>
            h(
              'div',
              {
                key: label,
                style: {
                  flex: '1 1 90px',
                  border: `1px solid ${COLOR.border}`,
                  borderRadius: 8,
                  padding: '10px 12px',
                },
              },
              h('div', { style: { ...font(11), color: COLOR.muted } }, label),
              h('div', { style: { ...font(20, 600), color: COLOR.text } }, String(value)),
            ),
          ),
        ),
        h(
          'div',
          { style: { ...font(12), color: COLOR.muted, marginBottom: 10 } },
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

    // ------------------------------------------------------------- facts

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
            value: query,
            placeholder: '过滤…',
            onChange: (event) => setQuery(event.target.value),
            style: {
              flex: 1,
              minWidth: 160,
              border: `1px solid ${COLOR.border}`,
              borderRadius: 6,
              padding: '4px 8px',
              background: 'transparent',
              color: COLOR.text,
              ...font(12),
            },
          }),
          h(Button, { onClick: onReload }, '刷新'),
        ),
        shown.length === 0
          ? h(Empty, null, '还没有事实。让 agent 说「记住…」，或在对话里主动记一条。')
          : shown.map((item) =>
              h(
                Card,
                { key: item.id },
                h('div', { style: { ...font(13), color: COLOR.text, whiteSpace: 'pre-wrap' } }, item.text),
                h(
                  'div',
                  { style: { ...font(11), color: COLOR.faint, marginTop: 6, display: 'flex', gap: 10, alignItems: 'center' } },
                  h('span', null, `权重 ${item.weight}`),
                  item.subject === '' ? null : h('span', null, `对象 ${item.subject}`),
                  h('span', null, fmtTime(item.createdAt)),
                  h('span', { style: { flex: 1 } }),
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

    // ------------------------------------------------------------- episodes

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
                h('div', { style: { ...font(12), color: COLOR.text, whiteSpace: 'pre-wrap' } }, item.text),
                h(
                  'div',
                  { style: { ...font(11), color: COLOR.faint, marginTop: 6, display: 'flex', gap: 10, flexWrap: 'wrap' } },
                  h('span', null, item.day),
                  h('span', null, fmtTime(item.createdAt)),
                  item.presetId === '' ? null : h('span', null, item.presetId),
                  h('span', null, item.sessionId.slice(0, 12)),
                ),
              ),
            ),
      )
    }

    // ------------------------------------------------------------- diary

    function Diary({ items, onReload }) {
      const [open, setOpen] = useState(null)
      return h(
        'div',
        null,
        h(
          Toolbar,
          null,
          h(Button, { onClick: onReload }, '刷新'),
          h('span', { style: { ...font(11), color: COLOR.faint } }, '日记由定时任务每天写一篇，覆盖当天所有会话。'),
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
                    onClick: () => setOpen(expanded ? null : page.day),
                    style: { cursor: 'pointer', display: 'flex', gap: 10, alignItems: 'center' },
                  },
                  h('span', { style: { ...font(13, 600), color: COLOR.text } }, page.day),
                  h('span', { style: { ...font(11), color: COLOR.faint } }, `${page.text.length} 字`),
                  h('span', { style: { flex: 1 } }),
                  h('span', { style: { ...font(11), color: COLOR.muted } }, expanded ? '收起' : '展开'),
                ),
                expanded
                  ? h(
                      'div',
                      { style: { ...font(13), color: COLOR.text, whiteSpace: 'pre-wrap', marginTop: 10 } },
                      page.text,
                    )
                  : null,
              )
            }),
      )
    }

    // ------------------------------------------------------------- settings

    function FlagRow({ title, hint, flags, onChange }) {
      return h(
        'div',
        { style: { marginBottom: 8 } },
        h('div', { style: { ...font(13, 600), color: COLOR.text, marginBottom: 2 } }, title),
        hint === undefined ? null : h('div', { style: { ...font(11), color: COLOR.faint, marginBottom: 4 } }, hint),
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
          null,
          h('div', { style: { ...font(13, 600, ), color: COLOR.text, marginBottom: 6 } }, '全局默认'),
          h(FlagRow, {
            title: '所有会话',
            hint: '没有被下面两层覆盖的会话都用这套。',
            flags: snapshot.global,
            onChange: (patch) => save('global', undefined, patch),
          }),
        ),
        h(
          Card,
          null,
          h('div', { style: { ...font(13, 600), color: COLOR.text, marginBottom: 6 } }, '按 preset 默认'),
          presets.length === 0
            ? h(Empty, null, '还没有 preset 覆盖。')
            : presets.map((id) =>
                h(
                  'div',
                  { key: id, style: { borderTop: `1px solid ${COLOR.border}`, paddingTop: 8, marginTop: 8 } },
                  h('div', { style: { ...font(12, 600), color: COLOR.accent, marginBottom: 4 } }, id),
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
          null,
          h('div', { style: { ...font(13, 600), color: COLOR.text, marginBottom: 6 } }, '按会话覆盖'),
          sessions.length === 0
            ? h(Empty, null, '还没有会话级覆盖。在会话页里改这一层的开关后就会出现。')
            : sessions.map((id) =>
                h(
                  'div',
                  { key: id, style: { borderTop: `1px solid ${COLOR.border}`, paddingTop: 8, marginTop: 8 } },
                  h('div', { style: { ...font(11), color: COLOR.faint, marginBottom: 4 } }, id),
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
          null,
          h('div', { style: { ...font(13, 600), color: COLOR.text, marginBottom: 6 } }, '每天写日记'),
          h(
            'div',
            { style: { ...font(11), color: COLOR.faint, marginBottom: 6 } },
            '由 DSH 定时任务在固定时间开一个新会话，把当天所有会话的片段汇总成一篇日记。没有对话的日子不写。',
          ),
          h(
            'div',
            { style: { display: 'flex', alignItems: 'center', gap: 8, marginBottom: 6 } },
            h('input', {
              type: 'time',
              value: diaryTime,
              onChange: (event) => setDiaryTime(event.target.value),
              style: {
                ...font(12),
                padding: '3px 6px',
                borderRadius: 6,
                border: `1px solid ${COLOR.border}`,
                background: 'transparent',
                color: COLOR.text,
              },
            }),
            h(
              Button,
              {
                kind: diaryTask?.scheduled === true ? undefined : 'primary',
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
            { style: { ...font(11), color: COLOR.muted } },
            diaryTask?.scheduled === true
              ? `已开启：每天 ${diaryTask.time ?? diaryTime}（${diaryTask.zone ?? ''}），状态 ${diaryTask.status ?? 'active'}`
              : '当前没有定时任务。',
          ),
        ),
        h(
          Card,
          null,
          h('div', { style: { ...font(13, 600), color: COLOR.text, marginBottom: 6 } }, '语义检索（第三档）'),
          h(
            'div',
            { style: { ...font(11), color: COLOR.faint, marginBottom: 6 } },
            '默认只跑 FTS5 与中文 bigram 重排。开启嵌入重排需要先安装依赖与模型，未安装时请保持关闭。',
          ),
          h(
            'div',
            { style: { ...font(11), color: dependency?.installed === true ? COLOR.muted : COLOR.danger, marginBottom: 6 } },
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
                : '依赖未安装时开启不会生效，只会是第三档保持关闭。',
          }),
        ),
      )
    }

    // -------------------------------------------------- session header chips

    /**
     * Three one-letter chips in the session title bar.
     *
     * The header clips overflow and has no room for labels, so each chip is a
     * single glyph whose *fill* carries the state: solid = on, outline = off.
     * The tooltip spells it out, and a click flips that one flag for this
     * session only — the preset and global layers stay untouched.
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
        {
          style: {
            display: 'inline-flex',
            alignItems: 'center',
            gap: 2,
            marginRight: 4,
            padding: '1px 3px',
            borderRadius: 5,
            border: `1px solid ${COLOR.border}`,
          },
        },
        CHIPS.map((chip) => {
          const on = flags[chip.key] === true
          return h(
            'span',
            {
              key: chip.key,
              title: `${chip.title}：${on ? '开' : '关'}（点击切换）`,
              onClick: () => flip(chip.key),
              style: {
                cursor: busy ? 'default' : 'pointer',
                userSelect: 'none',
                width: 15,
                height: 15,
                lineHeight: '15px',
                textAlign: 'center',
                borderRadius: 3,
                ...font(10, 600),
                color: on ? '#fff' : COLOR.faint,
                background: on ? COLOR.accent : 'transparent',
                opacity: busy ? 0.5 : 1,
              },
            },
            chip.glyph,
          )
        }),
      )
    }

    // ------------------------------------------------------------- shell

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
        {
          style: {
            display: 'flex',
            flexDirection: 'column',
            height: '100%',
            minHeight: 0,
            padding: '14px 16px',
            boxSizing: 'border-box',
            color: COLOR.text,
          },
        },
        h(
          'div',
          { style: { display: 'flex', alignItems: 'baseline', gap: 10, marginBottom: 12 } },
          h('div', { style: { ...font(15, 600) } }, '深度记忆'),
          h('div', { style: { ...font(11), color: COLOR.faint } }, loading ? '读取中…' : '本地 sqlite · 三档检索'),
          h('span', { style: { flex: 1 } }),
          h(Button, { onClick: reload, disabled: loading }, '刷新'),
        ),
        h(
          'div',
          { style: { display: 'flex', gap: 4, marginBottom: 12, borderBottom: `1px solid ${COLOR.border}` } },
          TABS.map((item) =>
            h(
              'div',
              {
                key: item.id,
                onClick: () => setTab(item.id),
                style: {
                  cursor: 'pointer',
                  padding: '6px 10px',
                  ...font(12, tab === item.id ? 600 : 400),
                  color: tab === item.id ? COLOR.accent : COLOR.muted,
                  borderBottom: `2px solid ${tab === item.id ? COLOR.accent : 'transparent'}`,
                  marginBottom: -1,
                },
              },
              item.label,
            ),
          ),
        ),
        h(ErrorBar, { error }),
        h('div', { style: { flex: 1, minHeight: 0, overflowY: 'auto' } }, body),
      )
    }

    function SidebarIcon({ active }) {
      const color = active ? COLOR.accent : COLOR.muted
      return h(
        'svg',
        { width: 18, height: 18, viewBox: '0 0 24 24', fill: 'none', stroke: color, strokeWidth: 1.7, strokeLinecap: 'round', strokeLinejoin: 'round' },
        h('path', { d: 'M12 3a5 5 0 0 1 5 5c1.7.6 3 2.2 3 4.2 0 1.6-.8 3-2 3.9V19a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2v-2.9c-1.2-.9-2-2.3-2-3.9 0-2 1.3-3.6 3-4.2a5 5 0 0 1 5-5z' }),
        h('path', { d: 'M9 21v-3M15 21v-3' }),
      )
    }

    return {
      inject: ['slots', 'locale'],
      apply(ctx) {
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
