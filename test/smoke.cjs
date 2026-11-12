/**
 * A load-and-render smoke test for the client half.
 *
 * `node --check` cannot see an undefined identifier, and the panel is far too
 * large to eyeball: this loads `lib/client.js` through the module loader it
 * expects, registers the slots against a fake `ctx`, and renders every one of
 * them once. A missing constant or a typo'd component name throws here instead of
 * blanking a slot in the real UI.
 *
 * Rendering is deliberately single-pass with no effect flushing: enough to run
 * every component body, not enough to depend on async data.
 */
const fs = require('node:fs')
const path = require('node:path')

const source = fs.readFileSync(path.join(__dirname, '..', 'lib', 'client.js'), 'utf8')

let loaded = null
const slots = []

const h = (type, props, ...children) => ({ type, props, children, key: props?.key ?? null })

/** One shared hook slot per call site: every pass returns the initial value. */
const React = {
  createElement: h,
  useState: (initial) => {
    const value = typeof initial === 'function' ? initial() : initial
    return [value, () => {}]
  },
  useEffect: () => {},
  useMemo: (fn) => fn(),
  useCallback: (fn) => fn,
  useRef: (initial) => ({ current: initial }),
  Fragment: 'fragment',
}

const ReactDOM = { createPortal: (node) => node }

globalThis.window = {
  __ModuleLoader__: {
    load(module) {
      loaded = module
    },
  },
  addEventListener: () => {},
  removeEventListener: () => {},
  setTimeout: () => 0,
  clearTimeout: () => {},
  innerWidth: 1280,
  innerHeight: 800,
}

// The panel fetches on mount; a stub keeps the smoke test about rendering.
globalThis.fetch = async () => ({ ok: true, status: 200, json: async () => ({}) })

const head = { appendChild: () => {} }
globalThis.document = {
  head,
  body: head,
  createElement: () => ({ dataset: {}, style: {}, setAttribute: () => {}, appendChild: () => {}, remove: () => {} }),
  querySelector: () => null,
  addEventListener: () => {},
  removeEventListener: () => {},
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
      slots.push(label)
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

console.log('slots:', slots.join(' | '))

/** Count rendered nodes, so an empty render is visible rather than silent. */
function count(node) {
  if (node === null || node === undefined || typeof node === 'boolean') return 0
  if (typeof node !== 'object') return 1
  return 1 + (node.children ?? []).reduce((total, child) => total + count(child), 0)
}

let total = 0
for (const entry of registered) {
  // Session-scoped cells need a session; anything else renders as the panel does.
  const props = entry.label.includes('conversation.') ? { sessionId: 'smoke-session' } : {}
  const tree = entry.component(props)
  const size = count(tree)
  // The composer cell renders null until its flags arrive, which a single pass
  // never does. Everything else must produce something.
  if (size === 0 && !entry.label.startsWith('conversation.input.right')) {
    throw new Error(`slot ${entry.label} rendered nothing`)
  }
  total += size
  console.log(`${entry.label} nodes=${size}`)
}
console.log(`rendered ${registered.length} slots, ${total} nodes`)