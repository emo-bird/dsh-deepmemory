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
      // Preset defaults are gone: the only defaults are global, read once when a
      // session is created, so editing them never moves an existing session.
      sessions: {},
      subagents: {},
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
          sessions: parsed.sessions ?? {},
          subagents: parsed.subagents ?? {},
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

  /**
   * The four switches in force for one conversation.
   *
   * A session owns the values it was born with, so the only thing layered here
   * is the global card underneath: a session with no stored entry (or one that
   * was told to inherit) still has to get an answer.
   *
   * @param {string|undefined} sessionId
   */
  sessionFlags(sessionId) {
    return applyFlags(this.globalFlags(), this.state.sessions[sessionId ?? ''])
  }

  /** Flags handed to a subagent, which fall back to its parent session. */
  subagentFlags(sessionId) {
    const own = this.state.subagents[sessionId ?? '']
    if (own !== undefined && own !== null) return applyFlags(this.globalFlags(), own)
    return this.sessionFlags(sessionId)
  }

  /**
   * Write flags at one scope.
   *
   * There is no preset layer any more: a session reads the global defaults once
   * at creation and then owns its four values, so editing global never reaches
   * back into a session the user already has. Subagent defaults are their own
   * layer because a delegated child is often the one that should not write.
   *
   * @param {'global'|'session'|'subagent'} scope
   * @param {string|undefined} id session id for the two session scopes
   * @param {Partial<Flags>} patch
   */
  setFlags(scope, id, patch) {
    if (scope === 'global') {
      const next = applyFlags(this.globalFlags(), patch)
      this.state.global = diffFlags(next, GLOBAL_DEFAULTS)
      this.save()
      return next
    }
    const key = id ?? ''
    const bucket = scope === 'subagent' ? this.state.subagents : this.state.sessions
    const parent = scope === 'subagent' ? this.subagentFlags(key) : this.globalFlags()
    const current = scope === 'subagent' ? this.subagentFlags(key) : this.sessionFlags(key)
    const next = applyFlags(current, patch)
    const delta = diffFlags(next, parent)
    // A key holding null means "explicitly inheriting": it is neither an
    // override the panel should show, nor something pinning may overwrite.
    if (Object.keys(delta).length === 0) bucket[key] = null
    else bucket[key] = delta
    this.save()
    return next
  }

  /**
   * Put a session back under the global defaults.
   *
   * The key stays behind holding null rather than being deleted: a deleted key
   * is indistinguishable from "never seen", and the next listing would pin it
   * again with whatever the globals are at that moment.
   */
  clearSession(sessionId, scope = 'session') {
    if (sessionId === undefined || sessionId === '') return
    const bucket = scope === 'subagent' ? this.state.subagents : this.state.sessions
    bucket[sessionId] = null
    this.save()
  }

  /**
   * Freeze the flags a brand-new session resolves to.
   *
   * Called once, at creation, from whatever the global defaults say right then —
   * that snapshot is the whole point of the design: later edits to the globals
   * are future defaults, not retroactive ones.
   *
   * @param {string} sessionId
   * @param {{force?: boolean}} [options] force pins the system defaults
   *   (read/write/diary on), which the scheduled diary session needs
   * @returns {boolean} true when a pin was written
   */
  pinSession(sessionId, options = {}) {
    const id = sessionId ?? ''
    if (id === '') return false
    const current = this.state.sessions[id]
    if (current === null || current !== undefined) return false
    const effective = options.force === true ? { recall: true, write: true, diary: true, forget: false } : this.globalFlags()
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
  snapshot() {
    /** @type {Record<string, Flags>} */
    const sessions = {}
    for (const [id, own] of Object.entries(this.state.sessions)) {
      if (own === null) continue
      sessions[id] = this.sessionFlags(id)
    }
    /** @type {Record<string, Flags>} */
    const subagents = {}
    for (const [id, own] of Object.entries(this.state.subagents)) {
      if (own === null) continue
      subagents[id] = this.subagentFlags(id)
    }
    const pruned = (map) => Object.fromEntries(Object.entries(map).filter(([, own]) => own !== null))
    return {
      global: this.globalFlags(),
      sessions,
      subagents,
      overrides: { sessions: pruned(this.state.sessions), subagents: pruned(this.state.subagents) },
      semantic: { ...this.state.semantic },
    }
  }

  setSemantic(patch) {
    this.state.semantic = { ...this.state.semantic, ...patch }
    this.save()
    return { ...this.state.semantic }
  }
}
