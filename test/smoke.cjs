/**
 * A load-and-render smoke test for the client half.
 *
 * `node --check` cannot see an undefined identifier, and the panel is far too
 * large to eyeball: this loads `lib/client.js` through the module loader it
 * expects, registers the slots against a fake `ctx`, and renders every one of
 * them. A missing constant or a typo'd component name throws here instead of
 * blanking a slot in the real UI — which is exactly how a `KIND_LABEL` deletion
 * was caught once.
 *
 * The renderer is deliberately small but real: function components are called
 * with their props, hooks keep state per call site, and effects are flushed
 * between passes until nothing changes. That is enough for the async loaders to
 * fill in, which is what makes the rendered text worth asserting on.
 *
 * Environment:
 *   SMOKE_TAB=facts|memory|search|overview|sessions|settings  pick the panel tab
 *   SMOKE_NEEDLES="a;;b"                                every needle must appear
 */
const fs = require('node:fs')
const path = require('node:path')

const target = path.join(__dirname, '..', 'lib', 'client.js')
let source = fs.readFileSync(target, 'utf8')
if (process.env.SMOKE_TAB) {
  source = source.replace("useState('overview')", `useState(${JSON.stringify(process.env.SMOKE_TAB)})`)
}

/**
 * `React.createElement` puts the children on `props.children`; our stub keeps
 * them beside it as well so the walker can count host nodes. Components that
 * destructure `{ children }` — `Card`, `Toolbar`, every wrapper here — only see
 * them through props, so both have to be filled.
 */
const h = (type, props, ...children) => {
  const flat = children.flat(Infinity)
  const merged = { ...(props ?? {}) }
  if (flat.length === 1) merged.children = flat[0]
  else if (flat.length > 1) merged.children = flat
  return { type, props: merged, children: flat, key: merged.key ?? null }
}

/** Hook state, keyed by component path + call index so two panels never collide. */
const states = new Map()
let effects = []
let dirty = false
let currentKey = ''
let hookIndex = 0

const depsEqual = (a, b) => {
  if (a === undefined || b === undefined) return false
  if (a.length !== b.length) return false
  return a.every((value, index) => Object.is(value, b[index]))
}

const React = {
  createElement: h,
  Fragment: 'fragment',
  useState(initial) {
    const key = `${currentKey}#${hookIndex++}`
    if (!states.has(key)) states.set(key, typeof initial === 'function' ? initial() : initial)
    const set = (next) => {
      const value = typeof next === 'function' ? next(states.get(key)) : next
      if (Object.is(value, states.get(key))) return
      states.set(key, value)
      dirty = true
    }
    return [states.get(key), set]
  },
  useMemo(fn, deps) {
    const key = `${currentKey}#memo#${hookIndex++}`
    const previous = states.get(key)
    if (previous !== undefined && depsEqual(previous.deps, deps)) return previous.value
    const value = fn()
    states.set(key, { value, deps: deps === undefined ? undefined : [...deps] })
    return value
  },
  useCallback(fn, deps) {
    // Stable identity matters: an effect keyed on a callback would otherwise run
    // on every pass and the panel would never settle.
    const key = `${currentKey}#cb#${hookIndex++}`
    const previous = states.get(key)
    if (previous !== undefined && depsEqual(previous.deps, deps)) return previous.fn
    states.set(key, { fn, deps: deps === undefined ? undefined : [...deps] })
    return fn
  },
  useRef(initial) {
    const key = `${currentKey}#ref#${hookIndex++}`
    if (!states.has(key)) states.set(key, { current: initial })
    return states.get(key)
  },
  useEffect(fn, deps) {
    const key = `${currentKey}#effect#${hookIndex++}`
    const previous = states.get(key)
    if (previous !== undefined && depsEqual(previous, deps)) return
    states.set(key, deps === undefined ? undefined : [...deps])
    effects.push(fn)
  },
}

const ReactDOM = { createPortal: (node) => node }

globalThis.window = {
  __ModuleLoader__: { load(module) { loaded = module } },
  addEventListener: () => {},
  removeEventListener: () => {},
  setTimeout: () => 0,
  clearTimeout: () => {},
  innerWidth: 1280,
  innerHeight: 800,
}

let loaded = null
const head = { appendChild: () => {} }
globalThis.document = {
  head,
  body: head,
  createElement: () => ({ dataset: {}, style: {}, setAttribute: () => {}, appendChild: () => {}, remove: () => {} }),
  querySelector: () => null,
  addEventListener: () => {},
  removeEventListener: () => {},
}

/** Fixtures for every route the panel reads; values are what the route answers. */
const fixtures = {
  '/api/deepmemory/stats': { facts: 3, episodes: 42, diary: 3, diaryDays: 3, vectors: 0, days: 5, newestDay: '2026-11-11' },
  '/api/deepmemory/activity': {
    days: [
      { day: '2026-11-05', episodes: 2, facts: 0, diary: 0 },
      { day: '2026-11-06', episodes: 0, facts: 0, diary: 0 },
      { day: '2026-11-07', episodes: 9, facts: 1, diary: 0 },
      { day: '2026-11-08', episodes: 4, facts: 0, diary: 1 },
      { day: '2026-11-09', episodes: 6, facts: 1, diary: 1 },
      { day: '2026-11-10', episodes: 12, facts: 1, diary: 1 },
      { day: '2026-11-11', episodes: 8, facts: 0, diary: 0 },
    ],
  },
  '/api/deepmemory/diary': {
    items: [
      { id: 'p1', day: '2026-11-10', text: '今天把小车的跟踪环调稳了，最后是增益太高。', origin: '', createdAt: Date.now() },
    ],
    latest: { id: 'p1', day: '2026-11-10', text: '今天把小车的跟踪环调稳了，最后是增益太高。', origin: '', createdAt: Date.now() },
  },
  '/api/deepmemory/facts': {
    items: [{ id: 'f1', scope: 'global', text: '小车用 PID 跟踪黑线', weight: 4, subject: '小车', createdAt: Date.now(), updatedAt: Date.now() }],
  },
  '/api/deepmemory/episodes': {
    items: [
      { id: 'e1', sessionId: 'sess-1', presetId: 'standard', role: 'user', text: '把面板的日历换成两列', createdAt: Date.now() },
    ],
  },
  '/api/deepmemory/settings': {
    defaults: { recall: true, write: true, diary: true, forget: false },
    presets: { standard: { flags: {}, subagent: {} }, 'deepmemory-diary': { flags: {}, subagent: {} } },
    sessions: {},
    subagents: {},
    overrides: { sessions: {}, subagents: {} },
    semantic: { enabled: false },
    diary: { persona: '你是「爱吃白饭的大肥鱼」，一条住在鸽鸽电脑里的鱼。', provider: '', model: '' },
    diaryDefault: '你是「爱吃白饭的大肥鱼」，一条住在鸽鸽电脑里的鱼。',
    dayclock: { enabled: true, gapMinutes: 90, latestHour: 4 },
    roster: [
      { id: 'standard', name: '标准' },
      { id: 'deepmemory-diary', name: '深度记忆 · 写日记' },
    ],
    presetLabels: ['标准', '深度记忆 · 写日记'],
    presetBroken: [],
    diaryPreset: { id: 'deepmemory-diary', mounted: true, stale: false },
  },
  '/api/deepmemory/sessions': {
    items: [
      { sessionId: 'sess-1', title: '重做深度记忆面板', firstLine: '把面板的日历换成两列', presetId: 'standard', cwd: 'C:/Project/dsh-deepmemory', effective: { recall: true, write: true, diary: true, forget: false }, subagent: { recall: true, write: true, diary: true, forget: false }, own: null, subagentOwn: null },
    ],
  },
  '/api/deepmemory/calendar': {
    from: '2026-11-01',
    to: '2026-11-30',
    days: [
      { day: '2026-11-09', episodes: 6, facts: 1, diary: 1, missing: false },
      { day: '2026-11-10', episodes: 12, facts: 1, diary: 1, missing: false },
      { day: '2026-11-11', episodes: 8, facts: 0, diary: 0, missing: true },
    ],
  },
  '/api/deepmemory/day': {
    day: '2026-11-10',
    diary: [{ id: 'p1', day: '2026-11-10', text: '今天把小车的跟踪环调稳了，最后是增益太高。', origin: '', createdAt: Date.now() }],
    facts: [],
    episodes: [{ id: 'e1', sessionId: 'sess-1', presetId: 'standard', role: 'user', text: '把面板的日历换成两列', createdAt: Date.now() }],
    counts: { diary: 1, facts: 0, episodes: 1 },
    missing: false,
  },
  '/api/deepmemory/missed': {
    items: [{ day: '2026-11-10', scheduledAt: Date.now(), deliveredAt: Date.now(), pages: 0 }],
  },
  '/api/deepmemory/session-flags': {
    effective: { recall: true, write: true, diary: true, forget: false },
    own: null,
    subagent: null,
  },
  '/api/deepmemory/diary-task': { scheduled: true, status: 'active', time: '23:55', zone: 'Asia/Shanghai', nextAt: null },
  '/api/deepmemory/dependency': { state: 'ready', installed: true },
  '/api/deepmemory/models': { items: [], state: 'idle' },
  '/api/deepmemory/model-catalog': {
    providers: [
      { id: 'deepseek', name: 'DeepSeek', models: [{ id: 'deepseek-v4-flash', name: 'V4 Flash' }] },
      { id: 'openai', name: 'OpenAI', models: [{ id: 'gpt-5-mini', name: 'GPT-5 mini' }] },
    ],
    default: { provider: 'deepseek', model: 'deepseek-v4-flash' },
  },
  '/api/deepmemory/daycut': {
    config: { enabled: true, gapMinutes: 90, latestHour: 4 },
    today: '2026-11-11',
    days: [
      { day: '2026-11-09', from: '00:00', to: '02:00', cutHour: 0, nextCutHour: 2, count: 6, tailCount: 1, pages: 1 },
      { day: '2026-11-10', from: '02:00', to: '04:00', cutHour: 2, nextCutHour: 4, count: 12, tailCount: 0, pages: 1 },
      { day: '2026-11-11', from: '04:00', to: '03:00', cutHour: 4, nextCutHour: 3, count: 8, tailCount: 2, pages: 0 },
    ],
  },
  '/api/deepmemory/search': { hits: [], tiers: {} },
}

const fetched = []
globalThis.fetch = async (url) => {
  const route = String(url).split('?')[0]
  fetched.push(route)
  const body = fixtures[route] ?? {}
  return { ok: true, status: 200, json: async () => body }
}

// eslint-disable-next-line no-new-func
new Function('require', 'window', source)(
  (name) => {
    if (name === 'react') return React
    if (name === 'react-dom') return ReactDOM
    throw new Error(`unexpected require: ${name}`)
  },
  globalThis.window,
)

if (loaded === null) throw new Error('the client module did not call __ModuleLoader__.load')
console.log('module id:', loaded.id)

const registered = []
const ctx = {
  slots: {
    inject(key, callback) {
      callback()
    },
    register(target, component) {
      const label = `${target.name}${target.key === undefined ? '' : `:${target.key}`}${target.id === undefined ? '' : `#${target.id}`}`
      if (typeof component !== 'function' && typeof component !== 'object') {
        throw new Error(`slot ${label} has no component`)
      }
      registered.push({ label, component })
    },
  },
}

loaded
  .factory((name) => {
    if (name === 'react') return React
    if (name === 'react-dom') return ReactDOM
    throw new Error(`factory required ${name}`)
  })
  .apply(ctx)

console.log('slots:', registered.map((entry) => entry.label).join(' | '))

/** Text and class names collected while rendering, for the assertions below. */
let text = []
let classes = new Set()

/**
 * Render one element tree to host nodes, calling every function component.
 *
 * This is the whole trick: a component is only invoked here, so its hooks land in
 * `states` under a path key and its effect can be flushed before the next pass.
 * Text and class names are collected on the way down.
 */
function render(node, where) {
  if (node === null || node === undefined || typeof node === 'boolean') return null
  if (typeof node === 'string' || typeof node === 'number') {
    text.push(String(node))
    return String(node)
  }
  if (Array.isArray(node)) return node.map((child) => render(child, where)).filter((child) => child !== null)
  if (typeof node !== 'object') return null
  const { type, props, children } = node
  if (typeof type === 'function') {
    const key = `${where}<${type.name === '' ? 'anon' : type.name}>`
    const previous = currentKey
    const previousIndex = hookIndex
    currentKey = key
    hookIndex = 0
    const rendered = render(type(props), key)
    currentKey = previous
    hookIndex = previousIndex
    return rendered
  }
  const own = typeof props.className === 'string' ? props.className : ''
  if (own !== '') for (const name of own.split(/\s+/)) if (name !== '') classes.add(name)
  return { type, props, children: children.map((child) => render(child, where)).filter((child) => child !== null) }
}

/** Count host nodes, so an empty render is visible rather than silent. */
function count(node) {
  if (node === null || node === undefined || typeof node === 'boolean') return 0
  if (typeof node !== 'object') return 1
  if (Array.isArray(node)) return node.reduce((total, child) => total + count(child), 0)
  return 1 + (node.children ?? []).reduce((total, child) => total + count(child), 0)
}

async function settle(entry) {
  // `text` is per slot (the needles belong to one), `classes` accumulates across
  // every slot so the CSS audit compares the whole panel against the stylesheet.
  text = []
  let tree = null
  for (let pass = 0; pass < 10; pass += 1) {
    dirty = false
    effects = []
    const previous = currentKey
    currentKey = `entry:${entry.label}`
    hookIndex = 0
    tree = render(entry.component(entry.label.includes('conversation.') ? { sessionId: 'smoke-session' } : {}), entry.label)
    currentKey = previous
    if (process.env.SMOKE_DEBUG) console.log(`pass ${pass} ${entry.label} effects=${effects.length} dirty=${dirty} fetched=${fetched.length}`)
    for (const fn of effects) {
      const result = fn()
      if (result !== undefined && typeof result.then === 'function') await result
    }
    await new Promise((resolve) => setImmediate(resolve))
    if (!dirty) break
  }
  return tree
}

const needles = (process.env.SMOKE_NEEDLES ?? '').split(';;').filter((part) => part !== '')

/** Every tab the panel can show; the CSS audit wants all of them rendered. */
const TAB_NAMES = ['overview', 'search', 'memory', 'facts', 'sessions', 'settings']

async function main() {
  let total = 0
  /** The panel's own tab state, so each tab can be rendered without a remount. */
  let panelTabKey
  for (const entry of registered) {
    const tabs = entry.label.startsWith('main') ? (process.env.SMOKE_TAB ? [process.env.SMOKE_TAB] : TAB_NAMES) : [null]
    const bodies = []
    let size = 0
    for (const tab of tabs) {
      if (panelTabKey !== undefined && tab !== null) states.set(panelTabKey, tab)
      const tree = await settle(entry)
      if (panelTabKey === undefined) {
        // The panel's tab hook is the first state of the first component rendered,
        // and it starts as 'overview' — that key drives every later tab switch.
        panelTabKey = [...states.keys()].find((key) => states.get(key) === 'overview')
      }
      size = count(tree)
      bodies.push(text.join(' '))
    }
    // The composer cell renders null until its flags arrive, which no pass in this
    // environment reaches; everything else must produce something.
    if (size === 0 && !entry.label.startsWith('conversation.input.right')) {
      throw new Error(`slot ${entry.label} rendered nothing`)
    }
    total += size
    // The needles describe the panel's contents, so they only apply to the panel
    // itself; the sidebar cell is an icon, the composer cell a chip, and the
    // conversation tab is a different view of the same data.
    const body = bodies.join(' ')
    const applies = entry.label.startsWith('main')
    const missing = applies ? needles.filter((needle) => !body.includes(needle)) : []
    if (missing.length > 0) {
      throw new Error(`slot ${entry.label} is missing: ${JSON.stringify(missing)}\n${body.slice(0, 2000)}`)
    }
    console.log(`${entry.label} nodes=${size}`)
  }
  console.log(`rendered ${registered.length} slots, ${total} nodes`)
  if (needles.length > 0) console.log(`needles found: ${needles.length}`)

  /**
   * Every class the panel renders must exist in the stylesheet — a typo there is
   * invisible in the DOM but real. The reverse check cannot be strict: menus,
   * tooltips, notices and empty states only render after a click, a hover or a
   * route the probe never triggers, so an unused class is reported, not raised.
   */
  const css = source.slice(source.indexOf('const CSS = `') + 13, source.indexOf('`\n\nfunction installStyle'))
  const defined = new Set([...css.matchAll(/\.(dm-[a-z0-9-]+)/g)].map((match) => match[1]))
  const used = [...classes].filter((name) => name.startsWith('dm-'))
  const unused = [...defined].filter((name) => !classes.has(name))
  const unknown = used.filter((name) => !defined.has(name))
  if (unknown.length > 0) throw new Error(`css classes missing: ${unknown.join(', ')}`)
  const literals = css.match(/#[0-9a-fA-F]{3,8}\b|rgba?\(|hsla?\(/g)
  if (literals !== null) throw new Error(`css has literal colours: ${[...new Set(literals)].join(', ')}`)
  console.log(`css classes used: ${used.length} defined: ${defined.size}, no literals`)
  if (unused.length > 0) console.log(`css classes not rendered in this pass: ${unused.join(', ')}`)
  console.log(`routes fetched: ${[...new Set(fetched)].join(', ')}`)
}

main().catch((error) => {
  console.error(error)
  process.exitCode = 1
})