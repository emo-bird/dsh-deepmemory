/**
 * Storage layer for deep memory.
 *
 * One SQLite file holds everything. The raw text is the source of truth; every
 * index (FTS trigram tables, the optional vector table) is derived and may be
 * rebuilt from it at any time.
 *
 * @module @emo-bird/dsh-deepmemory/store
 */

import { DatabaseSync } from 'node:sqlite'
import { mkdirSync } from 'node:fs'
import { dirname } from 'node:path'

/** @type {number} bump when the schema changes in a way that needs a rebuild */
export const SCHEMA_VERSION = 1

const DDL = `
CREATE TABLE IF NOT EXISTS meta (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS facts (
  id TEXT PRIMARY KEY,
  scope TEXT NOT NULL DEFAULT 'global',
  subject TEXT NOT NULL DEFAULT '',
  text TEXT NOT NULL,
  weight REAL NOT NULL DEFAULT 1,
  source_session TEXT NOT NULL DEFAULT '',
  source_preset TEXT NOT NULL DEFAULT '',
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  last_used_at INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS facts_scope ON facts(scope);
CREATE INDEX IF NOT EXISTS facts_updated ON facts(updated_at DESC);

CREATE TABLE IF NOT EXISTS episodes (
  id TEXT PRIMARY KEY,
  session_id TEXT NOT NULL DEFAULT '',
  preset_id TEXT NOT NULL DEFAULT '',
  workspace TEXT NOT NULL DEFAULT '',
  role TEXT NOT NULL,
  text TEXT NOT NULL,
  importance REAL NOT NULL DEFAULT 0.5,
  day TEXT NOT NULL,
  created_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS episodes_session ON episodes(session_id);
CREATE INDEX IF NOT EXISTS episodes_day ON episodes(day);

CREATE TABLE IF NOT EXISTS diary (
  day TEXT PRIMARY KEY,
  text TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS vec (
  kind TEXT NOT NULL,
  id TEXT NOT NULL,
  model TEXT NOT NULL,
  dim INTEGER NOT NULL,
  vector BLOB NOT NULL,
  PRIMARY KEY (kind, id)
);

CREATE VIRTUAL TABLE IF NOT EXISTS facts_fts USING fts5(
  text, tokenize='trigram'
);
CREATE VIRTUAL TABLE IF NOT EXISTS episodes_fts USING fts5(
  text, tokenize='trigram'
);
CREATE VIRTUAL TABLE IF NOT EXISTS diary_fts USING fts5(
  text, tokenize='trigram'
);
`

const dayOf = (ms) => new Date(ms).toISOString().slice(0, 10)

const newId = () => {
  const bytes = new Uint8Array(9)
  globalThis.crypto.getRandomValues(bytes)
  let out = ''
  for (const b of bytes) out += b.toString(36).padStart(2, '0')
  return out.slice(0, 14)
}

/** A single open database plus the statements the rest of the plugin uses. */
export class MemoryStore {
  /**
   * @param {string} path absolute file path, or ':memory:'
   */
  constructor(path) {
    if (path !== ':memory:') mkdirSync(dirname(path), { recursive: true })
    this.path = path
    this.db = new DatabaseSync(path)
    this.db.exec('PRAGMA journal_mode = WAL')
    this.db.exec('PRAGMA synchronous = NORMAL')
    this.db.exec(DDL)
  }

  close() {
    try {
      this.db.close()
    } catch {}
  }

  // ---- meta ---------------------------------------------------------------

  meta(key) {
    const row = this.db.prepare('SELECT value FROM meta WHERE key = ?').get(key)
    return row === undefined ? undefined : String(row.value)
  }

  setMeta(key, value) {
    this.db
      .prepare('INSERT INTO meta(key, value) VALUES(?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value')
      .run(key, String(value))
  }

  // ---- facts --------------------------------------------------------------

  /**
   * Insert or update one long-lived fact. Facts are addressed by their text so
   * repeating the same statement refreshes it instead of piling up duplicates.
   *
   * @param {{text: string, scope?: string, subject?: string, weight?: number, sessionId?: string, presetId?: string}} input
   */
  saveFact(input) {
    const text = String(input.text ?? '').trim()
    if (text === '') throw new Error('memory_save: text is empty')
    const now = Date.now()
    const existing = this.db
      .prepare('SELECT id, weight FROM facts WHERE text = ? AND scope = ?')
      .get(text, input.scope ?? 'global')
    if (existing !== undefined) {
      const weight = Math.max(Number(existing.weight) || 1, Number(input.weight) || 1)
      this.db
        .prepare('UPDATE facts SET weight = ?, updated_at = ?, subject = ? WHERE id = ?')
        .run(weight, now, input.subject ?? '', String(existing.id))
      this.reindexFact(String(existing.id), text)
      return { id: String(existing.id), updated: true }
    }
    const id = newId()
    this.db
      .prepare(
        `INSERT INTO facts(id, scope, subject, text, weight, source_session, source_preset, created_at, updated_at)
         VALUES(?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        id,
        input.scope ?? 'global',
        input.subject ?? '',
        text,
        Number(input.weight) || 1,
        input.sessionId ?? '',
        input.presetId ?? '',
        now,
        now,
      )
    this.reindexFact(id, text)
    return { id, updated: false }
  }

  reindexFact(id, text) {
    this.db.prepare('DELETE FROM facts_fts WHERE rowid = (SELECT rowid FROM facts WHERE id = ?)').run(id)
    const row = this.db.prepare('SELECT rowid AS rid FROM facts WHERE id = ?').get(id)
    if (row === undefined) return
    this.db.prepare('INSERT INTO facts_fts(rowid, text) VALUES(?, ?)').run(row.rid, text)
  }

  /** Rebuild every FTS index from the base tables. */
  rebuildFts() {
    for (const table of ['facts', 'episodes', 'diary']) {
      this.db.exec(`DELETE FROM ${table}_fts`)
    }
    const facts = this.db.prepare('SELECT rowid AS rid, text FROM facts').all()
    const ins = this.db.prepare('INSERT INTO facts_fts(rowid, text) VALUES(?, ?)')
    for (const row of facts) ins.run(row.rid, String(row.text))
    const eps = this.db.prepare('SELECT rowid AS rid, text FROM episodes').all()
    const insEp = this.db.prepare('INSERT INTO episodes_fts(rowid, text) VALUES(?, ?)')
    for (const row of eps) insEp.run(row.rid, String(row.text))
    const dly = this.db.prepare('SELECT rowid AS rid, text FROM diary').all()
    const insD = this.db.prepare('INSERT INTO diary_fts(rowid, text) VALUES(?, ?)')
    for (const row of dly) insD.run(row.rid, String(row.text))
    return { facts: facts.length, episodes: eps.length, diary: dly.length }
  }

  listFacts(limit = 200, offset = 0) {
    return this.db
      .prepare('SELECT id, scope, subject, text, weight, created_at, updated_at FROM facts ORDER BY updated_at DESC LIMIT ? OFFSET ?')
      .all(limit, offset)
      .map((row) => ({
        id: String(row.id),
        scope: String(row.scope),
        subject: String(row.subject),
        text: String(row.text),
        weight: Number(row.weight),
        createdAt: Number(row.created_at),
        updatedAt: Number(row.updated_at),
      }))
  }

  deleteFact(id) {
    const row = this.db.prepare('SELECT rowid AS rid FROM facts WHERE id = ?').get(id)
    if (row === undefined) return false
    this.db.prepare('DELETE FROM facts_fts WHERE rowid = ?').run(row.rid)
    this.db.prepare('DELETE FROM facts WHERE id = ?').run(id)
    this.db.prepare('DELETE FROM vec WHERE kind = ? AND id = ?').run('fact', id)
    return true
  }

  touchFacts(ids) {
    if (ids.length === 0) return
    const now = Date.now()
    const stmt = this.db.prepare('UPDATE facts SET last_used_at = ? WHERE id = ?')
    for (const id of ids) stmt.run(now, id)
  }

  // ---- episodes -----------------------------------------------------------

  /**
   * @param {{sessionId?: string, presetId?: string, workspace?: string, role: string, text: string, importance?: number}} input
   */
  saveEpisode(input) {
    const text = String(input.text ?? '').trim()
    if (text === '') throw new Error('saveEpisode: text is empty')
    const now = Date.now()
    const id = newId()
    this.db
      .prepare(
        `INSERT INTO episodes(id, session_id, preset_id, workspace, role, text, importance, day, created_at)
         VALUES(?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        id,
        input.sessionId ?? '',
        input.presetId ?? '',
        input.workspace ?? '',
        input.role,
        text,
        Number(input.importance) || 0.5,
        dayOf(now),
        now,
      )
    const row = this.db.prepare('SELECT rowid AS rid FROM episodes WHERE id = ?').get(id)
    if (row !== undefined) {
      this.db.prepare('INSERT INTO episodes_fts(rowid, text) VALUES(?, ?)').run(row.rid, text)
    }
    return id
  }

  listEpisodes({ limit = 100, offset = 0, day } = {}) {
    const stmt =
      day === undefined
        ? this.db.prepare('SELECT * FROM episodes ORDER BY created_at DESC LIMIT ? OFFSET ?')
        : this.db.prepare('SELECT * FROM episodes WHERE day = ? ORDER BY created_at DESC LIMIT ? OFFSET ?')
    const rows = day === undefined ? stmt.all(limit, offset) : stmt.all(day, limit, offset)
    return rows.map((row) => ({
      id: String(row.id),
      sessionId: String(row.session_id),
      presetId: String(row.preset_id),
      workspace: String(row.workspace),
      role: String(row.role),
      text: String(row.text),
      importance: Number(row.importance),
      day: String(row.day),
      createdAt: Number(row.created_at),
    }))
  }

  episodesOfDay(day) {
    return this.db.prepare('SELECT * FROM episodes WHERE day = ? ORDER BY created_at ASC').all(day)
  }

  /**
   * The first thing the user said in every recorded session.
   *
   * A session's title is generated by the host and can drift from what the
   * conversation is about, so the panel shows this line instead: it is the
   * literal opening and needs no extra query per row.
   *
   * @returns {Map<string, string>} session id -> opening line
   */
  firstUserLines() {
    // ROW_NUMBER rather than a MIN(created_at) join: two messages can share a
    // millisecond, and the join would then return both and silently pick
    // whichever the planner happened to order first.
    const rows = this.db
      .prepare(
        `SELECT session_id, text FROM (
           SELECT session_id, text,
                  ROW_NUMBER() OVER (
                    PARTITION BY session_id ORDER BY created_at ASC, rowid ASC
                  ) AS rn
           FROM episodes
           WHERE role = 'user'
         )
         WHERE rn = 1`,
      )
      .all()
    /** @type {Map<string, string>} */
    const out = new Map()
    for (const row of rows) {
      const sessionId = String(row.session_id)
      if (out.has(sessionId)) continue
      out.set(sessionId, String(row.text))
    }
    return out
  }

  deleteEpisode(id) {
    const row = this.db.prepare('SELECT rowid AS rid FROM episodes WHERE id = ?').get(id)
    if (row === undefined) return false
    this.db.prepare('DELETE FROM episodes_fts WHERE rowid = ?').run(row.rid)
    this.db.prepare('DELETE FROM episodes WHERE id = ?').run(id)
    this.db.prepare('DELETE FROM vec WHERE kind = ? AND id = ?').run('episode', id)
    return true
  }

  /**
   * Forget everything recorded for one session.
   *
   * Facts are left alone on purpose: they are not scoped to a session, they
   * were distilled out of it and now stand on their own. This only drops the
   * raw turns, which is what "this conversation should not be remembered" means.
   */
  deleteSession(sessionId) {
    const rows = this.db.prepare('SELECT id, rowid AS rid FROM episodes WHERE session_id = ?').all(sessionId)
    const dropFts = this.db.prepare('DELETE FROM episodes_fts WHERE rowid = ?')
    const dropEpisode = this.db.prepare('DELETE FROM episodes WHERE id = ?')
    const dropVec = this.db.prepare('DELETE FROM vec WHERE kind = ? AND id = ?')
    for (const row of rows) {
      dropFts.run(row.rid)
      dropEpisode.run(String(row.id))
      dropVec.run('episode', String(row.id))
    }
    return rows.length
  }

  // ---- diary --------------------------------------------------------------

  getDiary(day) {
    const row = this.db.prepare('SELECT * FROM diary WHERE day = ?').get(day)
    if (row === undefined) return undefined
    return { day: String(row.day), text: String(row.text), createdAt: Number(row.created_at), updatedAt: Number(row.updated_at) }
  }

  saveDiary(day, text) {
    const now = Date.now()
    const existed = this.getDiary(day)
    this.db
      .prepare(
        `INSERT INTO diary(day, text, created_at, updated_at) VALUES(?, ?, ?, ?)
         ON CONFLICT(day) DO UPDATE SET text = excluded.text, updated_at = excluded.updated_at`,
      )
      .run(day, String(text), existed?.createdAt ?? now, now)
    const row = this.db.prepare('SELECT rowid AS rid FROM diary WHERE day = ?').get(day)
    if (row !== undefined) {
      this.db.prepare('DELETE FROM diary_fts WHERE rowid = ?').run(row.rid)
      this.db.prepare('INSERT INTO diary_fts(rowid, text) VALUES(?, ?)').run(row.rid, String(text))
    }
    return existed !== undefined
  }

  listDiary(limit = 30, offset = 0) {
    return this.db
      .prepare('SELECT day, text, created_at, updated_at FROM diary ORDER BY day DESC LIMIT ? OFFSET ?')
      .all(limit, offset)
      .map((row) => ({
        day: String(row.day),
        text: String(row.text),
        createdAt: Number(row.created_at),
        updatedAt: Number(row.updated_at),
      }))
  }

  deleteDiary(day) {
    const row = this.db.prepare('SELECT rowid AS rid FROM diary WHERE day = ?').get(day)
    if (row !== undefined) {
      this.db.prepare('DELETE FROM diary_fts WHERE rowid = ?').run(row.rid)
      this.db.prepare('DELETE FROM diary WHERE day = ?').run(day)
    }
  }

  // ---- counts -------------------------------------------------------------

  stats() {
    const one = (sql) => Number(this.db.prepare(sql).get()?.n ?? 0)
    return {
      facts: one('SELECT count(*) AS n FROM facts'),
      episodes: one('SELECT count(*) AS n FROM episodes'),
      diary: one('SELECT count(*) AS n FROM diary'),
      vectors: one('SELECT count(*) AS n FROM vec'),
      days: one('SELECT count(DISTINCT day) AS n FROM episodes'),
      newestDay: this.db.prepare('SELECT day FROM episodes GROUP BY day ORDER BY day DESC LIMIT 1').get()?.day ?? null,
    }
  }
}

/** Day key used by episodes and diary rows. */
export const dayKey = dayOf
