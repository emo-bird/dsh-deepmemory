/**
 * Settings: per-session overrides and per-preset defaults.
 *
 * Resolution order, most specific wins:
 *   session override  >  preset default  >  global default
 *
 * Presence matters more than the value: a session that has never been touched
 * inherits its preset's default, and a preset that has never been touched
 * inherits the global default. Storing a key is how an override is expressed,
 * so a delta equal to the parent is deleted instead of written — that keeps
 * "follow the parent" as the natural state of the file.
 *
 * @module @emo-bird/dsh-deepmemory/settings
 */

import { mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs'
import { dirname } from 'node:path'

/** @typedef {{recall: boolean, write: boolean, diary: boolean, forget: boolean}} Flags */

/** @type {Flags} */
export const GLOBAL_DEFAULTS = Object.freeze({ recall: true, write: true, diary: true, forget: false })

const FLAG_KEYS = /** @type {const} */ (['recall', 'write', 'diary', 'forget'])

/** Keep only known boolean flags. */
export function sanitizeFlags(input) {
  /** @type {Flags} */
  const out = { recall: true, write: true, diary: true, forget: false }
  if (input === null || typeof input !== 'object') return out
  for (const key of FLAG_KEYS) {
    if (typeof input[key] === 'boolean') out[key] = input[key]
  }
  return out
}

function diffFlags(flags, parent) {
  /** @type {Partial<Flags>} */
  const out = {}
  for (const key of FLAG_KEYS) {
    if (flags[key] !== parent[key]) out[key] = flags[key]
  }
  return out
}

function applyFlags(parent, delta) {
  /** @type {Flags} */
  const out = { recall: parent.recall, write: parent.write, diary: parent.diary, forget: parent.forget }
  if (delta !== null && typeof delta === 'object') {
    for (const key of FLAG_KEYS) {
      if (typeof delta[key] === 'boolean') out[key] = delta[key]
    }
  }
  return out
}

export class MemorySettings {
  /**
   * @param {string} path absolute path to settings.json
   * @param {{global?: Partial<Flags>, semantic?: object}} [seed]
   */
  constructor(path, seed = {}) {
    this.path = path
    this.state = {
      version: 1,
      global: diffFlags(sanitizeFlags({ ...GLOBAL_DEFAULTS, ...seed.global }), GLOBAL_DEFAULTS),
      presets: {},
      sessions: {},
      semantic: { enabled: false, modelPath: null, model: null, remoteHost: null, ...(seed.semantic ?? {}) },
    }
    this.load()
  }

  load() {
    try {
      const parsed = JSON.parse(readFileSync(this.path, 'utf8'))
      if (parsed !== null && typeof parsed === 'object') {
        this.state = {
          version: 1,
          global: parsed.global ?? {},
          presets: parsed.presets ?? {},
          sessions: parsed.sessions ?? {},
          semantic: { enabled: false, modelPath: null, model: null, remoteHost: null, ...(parsed.semantic ?? {}) },
        }
      }
    } catch {
      // A missing or corrupt file is not an error: defaults are a valid state.
    }
    return this
  }

  save() {
    mkdirSync(dirname(this.path), { recursive: true })
    const tmp = `${this.path}.tmp`
    writeFileSync(tmp, `${JSON.stringify(this.state, null, 2)}\n`, 'utf8')
    renameSync(tmp, this.path)
  }

  globalFlags() {
    return applyFlags(GLOBAL_DEFAULTS, this.state.global)
  }

  presetFlags(presetId) {
    return applyFlags(this.globalFlags(), this.state.presets[presetId ?? ''])
  }

  /**
   * @param {string|undefined} sessionId
   * @param {string|undefined} presetId preset the session currently runs, used
   *   as the parent when no preset-specific default exists
   */
  sessionFlags(sessionId, presetId) {
    return applyFlags(this.presetFlags(presetId), this.state.sessions[sessionId ?? ''])
  }

  /**
   * Write flags at one scope.
   * @param {'global'|'preset'|'session'} scope
   * @param {string|undefined} id preset id or session id
   * @param {Partial<Flags>} patch
   * @param {{presetId?: string}} [context] parent preset when scope is 'session'
   */
  setFlags(scope, id, patch, context = {}) {
    if (scope === 'global') {
      const next = applyFlags(this.globalFlags(), patch)
      this.state.global = diffFlags(next, GLOBAL_DEFAULTS)
      this.save()
      return next
    }
    if (scope === 'preset') {
      const parent = this.globalFlags()
      const next = applyFlags(this.presetFlags(id), patch)
      const delta = diffFlags(next, parent)
      if (Object.keys(delta).length === 0) delete this.state.presets[id ?? '']
      else this.state.presets[id ?? ''] = delta
      this.save()
      return next
    }
    const parent = this.presetFlags(context.presetId)
    const next = applyFlags(this.sessionFlags(id, context.presetId), patch)
    const delta = diffFlags(next, parent)
    // A key holding null means "explicitly inheriting": it is neither an
    // override the panel should show, nor something pinning may overwrite.
    if (Object.keys(delta).length === 0) this.state.sessions[id ?? ''] = null
    else this.state.sessions[id ?? ''] = delta
    this.save()
    return next
  }

  /**
   * Put a session back under its parent.
   *
   * The key stays behind holding null rather than being deleted: a deleted key
   * is indistinguishable from "never seen", and the next session listing would
   * pin it again — which is exactly why "restore inheritance" used to bounce
   * straight back to "已覆盖".
   */
  clearSession(sessionId) {
    if (sessionId === undefined || sessionId === '') return
    this.state.sessions[sessionId] = null
    this.save()
  }

  /**
   * Freeze the flags a session currently resolves to, so later edits to the
   * preset or the global defaults no longer move it.
   *
   * Without this the preset table reads as "the default for new sessions" but
   * behaves as "the default for everyone", which is a different promise. All
   * four keys are written as the session's own, so the row shows as overridden
   * and `clearSession` is what puts it back under the parent again.
   *
   * @param {string} sessionId
   * @param {string|undefined} presetId
   * @returns {boolean} true when a pin was written
   */
  pinSession(sessionId, presetId) {
    const id = sessionId ?? ''
    if (id === '') return false
    const current = this.state.sessions[id]
    if (current === null || current !== undefined) return false
    const effective = this.sessionFlags(id, presetId)
    this.state.sessions[id] = {
      recall: effective.recall === true,
      write: effective.write === true,
      diary: effective.diary === true,
      forget: effective.forget === true,
    }
    this.save()
    return true
  }

  /** Panel snapshot: every known scope with its effective flags. */
  snapshot(knownPresets = []) {
    /** @type {Record<string, Flags>} */
    const presets = {}
    for (const id of [...knownPresets, ...Object.keys(this.state.presets)]) {
      presets[id] = this.presetFlags(id)
    }
    /** @type {Record<string, Flags>} */
    const sessions = {}
    for (const id of Object.keys(this.state.sessions)) {
      sessions[id] = this.sessionFlags(id, undefined)
    }
    return {
      global: this.globalFlags(),
      presets,
      sessions,
      overrides: {
        presets: this.state.presets,
        sessions: Object.fromEntries(Object.entries(this.state.sessions).filter(([, own]) => own !== null)),
      },
      semantic: { ...this.state.semantic },
    }
  }

  setSemantic(patch) {
    this.state.semantic = { ...this.state.semantic, ...patch }
    this.save()
    return { ...this.state.semantic }
  }
}
