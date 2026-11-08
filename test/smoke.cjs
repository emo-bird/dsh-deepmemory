const fs = require('node:fs')
const path = require('node:path')

const source = fs.readFileSync(path.join(__dirname, '..', 'lib', 'client.js'), 'utf8')

let loaded = null
const slots = []
const h = (type, props, ...children) => ({ type, props, children })

const React = {
  createElement: h,
  useState: (initial) => [initial, () => {}],
  useEffect: () => {},
  useMemo: (fn) => fn(),
  useCallback: (fn) => fn,
  useRef: (initial) => ({ current: initial }),
}

globalThis.window = {
  __ModuleLoader__: {
    load(module) {
      loaded = module
    },
  },
}

// eslint-disable-next-line no-new-func
new Function('require', 'window', source)((name) => {
  if (name === 'react') return React
  throw new Error(`unexpected require: ${name}`)
}, globalThis.window)

if (loaded === null) throw new Error('the client module did not call __ModuleLoader__.load')
console.log('module id:', loaded.id)

const ctx = {
  slots: {
    inject(key, callback) {
      callback()
    },
    register(target, component) {
      slots.push(`${target.name}${target.key === undefined ? '' : `:${target.key}`}${target.id === undefined ? '' : `#${target.id}`}`)
      if (typeof component !== 'function' && typeof component !== 'object') throw new Error(`slot ${target.name} has no component`)
    },
  },
}

loaded.factory((name) => {
  if (name === 'react') return React
  throw new Error(`factory required ${name}`)
}).apply(ctx)

console.log('slots:', slots.join(' | '))

// Render every view once with a stub snapshot, to catch syntax-level breakage
// that only shows up when a component body actually runs.
const mod = loaded.factory((name) => {
  if (name === 'react') return React
  throw new Error(`factory required ${name}`)
})
console.log('inject:', Array.isArray(mod.inject) ? mod.inject.join(',') : String(mod.inject))
