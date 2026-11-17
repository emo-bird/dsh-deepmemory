/**
 * Settings: per-session overrides and per-preset defaults.
 *
 * Resolution order, most specific wins:
 *
 *   session override  >  preset default  >  built-in default
 *
 * Presets are the layer the user actually thinks in: "new conversations in this
 * preset start with write off", "children of sessions from that preset never
 * delete memory". A session that has never been touched inherits its preset, and
 * a preset that has never been touched inherits the built-in default. Presence
 * matters more than the value: a delta equal to the parent is deleted instead of
 * written, so "follow the parent" is the natural state of the file.
 *
 * @module @emo-bird/dsh-deepmemory/settings
 */

import { mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs'
import { dirname } from 'node:path'
import { DEFAULT_DAYCLOCK, normalizeDayclock } from './dayclock.js'

/** @typedef {{recall: boolean, write: boolean, diary: boolean, forget: boolean}} Flags */

/** The bottom of the stack: what a preset that was never configured gets. */
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

/** A preset entry with both of its two default sets. */
function presetEntry(raw) {
  const entry = raw !== null && typeof raw === 'object' ? raw : {}
  return {
    flags: entry.flags !== null && typeof entry.flags === 'object' ? entry.flags : {},
    subagent: entry.subagent !== null && typeof entry.subagent === 'object' ? entry.subagent : {},
  }
}

export class MemorySettings {
  /**
   * @param {string} path absolute path to settings.json
   * @param {{diary?: object, semantic?: object}} [seed]
   */
  constructor(path, seed = {}) {
    this.path = path
    this.state = {
      version: 2,
      presets: {},
      sessions: {},
      subagents: {},
      semantic: { enabled: false, modelPath: null, model: null, remoteHost: null, ...(seed.semantic ?? {}) },
      // The diary writer's own persona and model. Empty model means "whatever the
      // deployment default is", so the panel starts out inheriting it.
      diary: { persona: '', provider: '', model: '', ...(seed.diary ?? {}) },
      // Where a diary day ends. Stored as a plain little object rather than being
      // derived at read time, because the panel edits it and the values are what
      // the user chose, not a cache of anything.
      dayclock: normalizeDayclock(seed.dayclock ?? DEFAULT_DAYCLOCK),
    }
    this.load()
  }

  load() {
    try {
      const parsed = JSON.parse(readFileSync(this.path, 'utf8'))
      if (parsed !== null && typeof parsed === 'object') {
        /** @type {Record<string, {flags: object, subagent: object}>} */
        const presets = {}
        for (const [id, raw] of Object.entries(parsed.presets ?? {})) presets[id] = presetEntry(raw)
        this.state = {
          version: 2,
          presets,
          sessions: parsed.sessions ?? {},
          subagents: parsed.subagents ?? {},
          semantic: { enabled: false, modelPath: null, model: null, remoteHost: null, ...(parsed.semantic ?? {}) },
          diary: { persona: '', provider: '', model: '', ...(parsed.diary ?? {}) },
          dayclock: normalizeDayclock(parsed.dayclock ?? DEFAULT_DAYCLOCK),
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

  /** The built-in defaults, shown as the bottom row of the panel. */
  globalFlags() {
    return { ...GLOBAL_DEFAULTS }
  }

  /** What a new conversation in one preset starts with. */
  presetFlags(presetId) {
    return applyFlags(GLOBAL_DEFAULTS, presetEntry(this.state.presets[presetId ?? '']).flags)
  }

  /** What a subagent of one preset inherits before its own session override. */
  presetSubagentFlags(presetId) {
    return applyFlags(this.presetFlags(presetId), presetEntry(this.state.presets[presetId ?? '']).subagent)
  }

  /**
   * The four switches in force for one conversation.
   *
   * A session owns the values it was born with, so the only thing layered here
   * is its preset underneath: a session with no stored entry (or one that was
   * told to inherit) still has to get an answer.
   *
   * @param {string|undefined} sessionId
   * @param {string|undefined} presetId
   */
  sessionFlags(sessionId, presetId) {
    return applyFlags(this.presetFlags(presetId), this.state.sessions[sessionId ?? ''])
  }

  /**
   * The policy a child would get with no override of its own.
   *
   * The stack, bottom up: built-in defaults → the preset's new-conversation
   * switches → the preset's subagent switches → this conversation's own
   * overrides. A child therefore starts from what its parent actually runs
   * with, which is what "子代理跟着父会话" means in practice.
   */
  inheritedSubagentFlags(sessionId, presetId) {
    return applyFlags(this.presetSubagentFlags(presetId), this.state.sessions[sessionId ?? ''])
  }

  /** Flags handed to a subagent: its inherited policy, then its own overrides. */
  subagentFlags(sessionId, presetId) {
    return applyFlags(this.inheritedSubagentFlags(sessionId, presetId), this.state.subagents[sessionId ?? ''])
  }

  /**
   * Write one preset's defaults.
   *
   * @param {string} presetId
   * @param {'session'|'subagent'} kind `session` = new conversations,
   *   `subagent` = what their children inherit
   * @param {Partial<Flags>} patch
   */
  setPresetFlags(presetId, kind, patch) {
    const id = presetId ?? ''
    const entry = presetEntry(this.state.presets[id])
    const isChild = kind === 'subagent'
    const current = isChild ? this.presetSubagentFlags(id) : this.presetFlags(id)
    const parent = isChild ? this.presetFlags(id) : GLOBAL_DEFAULTS
    const next = applyFlags(current, patch)
    const delta = diffFlags(next, parent)
    if (isChild) entry.subagent = delta
    else entry.flags = delta
    if (Object.keys(entry.flags).length === 0 && Object.keys(entry.subagent).length === 0) delete this.state.presets[id]
    else this.state.presets[id] = entry
    this.save()
    return next
  }

  /**
   * Write flags at one session scope.
   *
   * @param {'session'|'subagent'} scope
   * @param {string|undefined} id session id
   * @param {Partial<Flags>} patch
   * @param {string|undefined} [presetId] the session's preset, for the parent row
   */
  setFlags(scope, id, patch, presetId) {
    const key = id ?? ''
    const bucket = scope === 'subagent' ? this.state.subagents : this.state.sessions
    const parent = scope === 'subagent' ? this.inheritedSubagentFlags(key, presetId) : this.presetFlags(presetId)
    const current = scope === 'subagent' ? this.subagentFlags(key, presetId) : this.sessionFlags(key, presetId)
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
   * Put a session back under its preset defaults.
   *
   * The key stays behind holding null rather than being deleted: a deleted key
   * is indistinguishable from "never seen", and the next listing would pin it
   * again with whatever the defaults are at that moment.
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
   * Called once, at creation, from whatever its preset says right then — that
   * snapshot is the whole point of the design: later edits to the preset are
   * future defaults, not retroactive ones.
   *
   * @param {string} sessionId
   * @param {{presetId?: string, force?: boolean}} [options] force pins the system
   *   defaults (read/write/diary on), which the scheduled diary session needs
   * @returns {boolean} true when a pin was written
   */
  pinSession(sessionId, options = {}) {
    const id = sessionId ?? ''
    if (id === '') return false
    const current = this.state.sessions[id]
    if (current === null || current !== undefined) return false
    const effective = options.force === true ? { recall: true, write: true, diary: true, forget: false } : this.presetFlags(options.presetId)
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
    /** @type {Record<string, {flags: Flags, subagent: Flags}>} */
    const presets = {}
    for (const id of Object.keys(this.state.presets)) {
      presets[id] = { flags: this.presetFlags(id), subagent: this.presetSubagentFlags(id) }
    }
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
      defaults: this.globalFlags(),
      presets,
      sessions,
      subagents,
      overrides: { sessions: pruned(this.state.sessions), subagents: pruned(this.state.subagents) },
      semantic: { ...this.state.semantic },
      diary: this.diaryConfig(),
      dayclock: this.dayclockConfig(),
    }
  }

  setSemantic(patch) {
    this.state.semantic = { ...this.state.semantic, ...patch }
    this.save()
    return { ...this.state.semantic }
  }

  /** Where a diary day ends: on/off, the gap that separates two nights, the ceiling. */
  dayclockConfig() {
    return normalizeDayclock(this.state.dayclock ?? DEFAULT_DAYCLOCK)
  }

  setDayclockConfig(patch = {}) {
    this.state.dayclock = normalizeDayclock(patch, this.dayclockConfig())
    this.save()
    return { ...this.state.dayclock }
  }

  /** The diary writer's persona and pinned model. */
  diaryConfig() {
    return { persona: '', provider: '', model: '', ...this.state.diary }
  }

  setDiaryConfig(patch) {
    const next = { ...this.diaryConfig() }
    if (typeof patch.persona === 'string') next.persona = patch.persona
    if (typeof patch.provider === 'string') next.provider = patch.provider.trim()
    if (typeof patch.model === 'string') next.model = patch.model.trim()
    this.state.diary = next
    this.save()
    return next
  }
}