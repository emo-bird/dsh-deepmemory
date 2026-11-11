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
import { copyFileSync, mkdirSync } from 'node:fs'
import { dirname } from 'node:path'

/**
 * Bump when the on-disk shape changes.
 *
 * The meta row `schemaVersion` records what this file was last written as; a
 * file at an older version is migrated in place, once, before anything reads it.
 *
 * @type {number}
 */
export const SCHEMA_VERSION = 2

/**
 * Diary pages are keyed by their own id, not by the day.
 *
 * A day can hold more than one page: each scheduled delivery writes its own, and
 * a delivery that runs twice (a retry, a lunch-break time change) must amend
 * *its* page rather than overwrite someone else's. `origin` is the session that
 * wrote the page, which is exactly the per-delivery identity the schedule
 * service gives us — every delivery creates a fresh session.
 */
const DIARY_DDL = `
CREATE TABLE IF NOT EXISTS diary (
  id TEXT PRIMARY KEY,
  day TEXT NOT NULL,
  text TEXT NOT NULL,
  origin TEXT NOT NULL DEFAULT '',
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS diary_day ON diary(day, created_at);
CREATE INDEX IF NOT EXISTS diary_origin ON diary(day, origin);
`

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

/**
 * Local-time day key.
 *
 * Diary days are human days: a message at 00:10 belongs to the day that just
 * started, not to the UTC day it happens to fall in. `toISOString()` would put
 * it on the previous page for anyone east of Greenwich, which is exactly where
 * the evening diary run looks.
 */
const dayOf = (ms) => {
  const date = new Date(ms)
  const y = date.getFullYear()
  const m = String(date.getMonth() + 1).padStart(2, '0')
  const d = String(date.getDate()).padStart(2, '0')
  return `${y}-${m}-${d}`
}

const newId = () => {
  const bytes = new Uint8Array(9)
  globalThis.crypto.getRandomValues(bytes)
  let out = ''
  for (const b of bytes) out += b.toString(36).padStart(2, '0')
  return out.slice(0, 14)
}

/**
 * Copy the database file aside before a shape change.
 *
 * The suffix is the moment the copy was taken, so a second migration on the same
 * day does not overwrite the first one. Returns the copy's path.
 */
const backupFile = (path) => {
  const stamp = new Date().toISOString().replace(/[:.]/g, '-')
  const target = `${path}.bak-${stamp}`
  copyFileSync(path, target)
  return target
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
    // `diary` is created here rather than in DDL because a file written by
    // version 1 already has the old shape under that name.
    this.db.exec(DDL)
    this.migrate()
    this.db.exec(DIARY_DDL)
  }

  /**
   * Bring a file from an older on-disk shape up to the current one.
   *
   * Only the diary table has ever changed shape: it used to be keyed by day,
   * which silently made a second page for the same day impossible — the upsert
   * overwrote the first one. The rows are copied verbatim into the new table
   * (keeping their text and timestamps; only a new id is minted) so the existing
   * page survives untouched, and the old table is dropped only after the copy
   * has been committed.
   *
   * A backup of the database file is taken first and its path is kept on the
   * instance. A migration that throws leaves the file exactly as it was: the
   * transaction rolls back and the backup is on disk either way.
   */
  migrate() {
    const columns = this.db.prepare('PRAGMA table_info(diary)').all()
    const exists = columns.length > 0
    const current = exists && columns.some((column) => String(column.name) === 'id')
    const version = Number(this.meta('schemaVersion') ?? 0)
    if (current && version >= SCHEMA_VERSION) return
    if (!exists) {
      this.setMeta('schemaVersion', SCHEMA_VERSION)
      return
    }

    if (!current) {
      // Checkpoint first: in WAL mode the newest rows may still live in the -wal
      // file, and a copy of the .db alone would silently lose them.
      if (this.path !== ':memory:') {
        try {
          this.db.exec('PRAGMA wal_checkpoint(TRUNCATE)')
        } catch {
          // A checkpoint that cannot run still leaves a usable backup policy
          // below; the migration itself reads from the live connection.
        }
        this.backup = backupFile(this.path)
      }
      const rows = this.db.prepare('SELECT day, text, created_at, updated_at FROM diary ORDER BY day ASC').all()
      this.db.exec('BEGIN IMMEDIATE')
      try {
        this.db.exec('DROP TABLE diary')
        this.db.exec(DIARY_DDL)
        const insert = this.db.prepare(
          'INSERT INTO diary(id, day, text, origin, created_at, updated_at) VALUES(?, ?, ?, ?, ?, ?)',
        )
        for (const row of rows) {
          insert.run(
            newId(),
            String(row.day),
            String(row.text),
            '',
            Number(row.created_at) || Date.now(),
            Number(row.updated_at) || Number(row.created_at) || Date.now(),
          )
        }
        this.db.exec('DELETE FROM diary_fts')
        const dropped = this.db.prepare('SELECT rowid AS rid, text FROM diary').all()
        const index = this.db.prepare('INSERT INTO diary_fts(rowid, text) VALUES(?, ?)')
        for (const row of dropped) index.run(row.rid, String(row.text))
        this.setMeta('schemaVersion', SCHEMA_VERSION)
        this.db.exec('COMMIT')
      } catch (error) {
        this.db.exec('ROLLBACK')
        throw error
      }
      return
    }

    // Already the current shape, only the version stamp was missing.
    this.setMeta('schemaVersion', SCHEMA_VERSION)
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

  /**
   * Every turn recorded for one day, oldest first.
   *
   * The conversation-memory view asks the same question restricted to one
   * session, so the session id is an optional second filter rather than a
   * separate method: the day key is already stored on every row.
   */
  episodesOfDay(day, sessionId) {
    const rows =
      sessionId === undefined
        ? this.db.prepare('SELECT * FROM episodes WHERE day = ? ORDER BY created_at ASC').all(day)
        : this.db
            .prepare('SELECT * FROM episodes WHERE day = ? AND session_id = ? ORDER BY created_at ASC')
            .all(day, sessionId)
    return rows
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

  /** One page by its own id. */
  getDiaryPage(id) {
    return this.toDiaryRow(this.db.prepare('SELECT * FROM diary WHERE id = ?').get(id))
  }

  /**
   * Every page written about one day, oldest first.
   *
   * A day can hold several pages, and the panel shows them all rather than
   * hiding the extras behind the newest one.
   */
  pagesOfDay(day) {
    return this.db
      .prepare('SELECT * FROM diary WHERE day = ? ORDER BY created_at ASC, rowid ASC')
      .all(day)
      .map((row) => this.toDiaryRow(row))
      .filter((page) => page !== undefined)
  }

  /** The newest page, optionally restricted to one day. */
  latestDiary(day) {
    const rows =
      day === undefined
        ? this.db.prepare('SELECT * FROM diary ORDER BY day DESC, created_at DESC LIMIT 1').all()
        : this.db.prepare('SELECT * FROM diary WHERE day = ? ORDER BY created_at DESC LIMIT 1').all(day)
    return rows.length === 0 ? undefined : this.toDiaryRow(rows[0])
  }

  toDiaryRow(row) {
    if (row === undefined || row === null) return undefined
    return {
      id: String(row.id),
      day: String(row.day),
      text: String(row.text),
      origin: String(row.origin ?? ''),
      createdAt: Number(row.created_at),
      updatedAt: Number(row.updated_at),
    }
  }

  /**
   * Write one page, amending `origin`'s page for that day when it already exists.
   *
   * `origin` is the delivery's session id. One delivery writes one page, and a
   * retry of the same delivery amends it instead of leaving two near-identical
   * pages behind; two different deliveries both get their own page, which is what
   * "同日多份" means. An empty origin is a page written by hand and always gets a
   * fresh row.
   *
   * @returns {{id: string, created: boolean}}
   */
  saveDiary(input) {
    const day = String(input.day)
    const text = String(input.text)
    const origin = String(input.origin ?? '')
    const now = Date.now()
    const existing =
      origin === ''
        ? undefined
        : this.db.prepare('SELECT * FROM diary WHERE day = ? AND origin = ? ORDER BY created_at ASC LIMIT 1').get(day, origin)
    const id = existing === undefined ? newId() : String(existing.id)
    if (existing === undefined) {
      this.db
        .prepare('INSERT INTO diary(id, day, text, origin, created_at, updated_at) VALUES(?, ?, ?, ?, ?, ?)')
        .run(id, day, text, origin, now, now)
    } else {
      this.db.prepare('UPDATE diary SET text = ?, updated_at = ? WHERE id = ?').run(text, now, id)
    }
    const row = this.db.prepare('SELECT rowid AS rid FROM diary WHERE id = ?').get(id)
    if (row !== undefined) {
      this.db.prepare('DELETE FROM diary_fts WHERE rowid = ?').run(row.rid)
      this.db.prepare('INSERT INTO diary_fts(rowid, text) VALUES(?, ?)').run(row.rid, text)
    }
    return { id, created: existing === undefined }
  }

  listDiary(limit = 30, offset = 0, day) {
    const rows =
      day === undefined
        ? this.db.prepare('SELECT * FROM diary ORDER BY day DESC, created_at DESC LIMIT ? OFFSET ?').all(limit, offset)
        : this.db.prepare('SELECT * FROM diary WHERE day = ? ORDER BY created_at ASC LIMIT ? OFFSET ?').all(day, limit, offset)
    return rows.map((row) => this.toDiaryRow(row)).filter((page) => page !== undefined)
  }

  /** How many pages exist per day, for the calendar's "has a diary" marks. */
  diaryCountsByDay() {
    /** @type {Map<string, number>} */
    const out = new Map()
    for (const row of this.db.prepare('SELECT day, count(*) AS n FROM diary GROUP BY day').all()) {
      out.set(String(row.day), Number(row.n))
    }
    return out
  }

  /** Episode counts per day, for the calendar's activity shading. */
  episodeCounts(fromDay, toDay, sessionId) {
    /** @type {Map<string, number>} */
    const out = new Map()
    const rows =
      sessionId === undefined
        ? this.db
            .prepare('SELECT day, count(*) AS n FROM episodes WHERE day >= ? AND day <= ? GROUP BY day')
            .all(fromDay, toDay)
        : this.db
            .prepare(
              'SELECT day, count(*) AS n FROM episodes WHERE day >= ? AND day <= ? AND session_id = ? GROUP BY day',
            )
            .all(fromDay, toDay, sessionId)
    for (const row of rows) out.set(String(row.day), Number(row.n))
    return out
  }

  /** Facts created on one local day, optionally only those one session taught. */
  factsOfDay(day, sessionId) {
    // `created_at` is a millisecond stamp, so the day is matched by range rather
    // than by string: the caller passes a human day, the row stores an instant.
    const start = startOfLocalDay(day)
    if (start === undefined) return []
    return this.listFactsBetween(start, start + 86_400_000 - 1, sessionId)
  }

  listFactsBetween(fromMs, toMs, sessionId) {
    const rows =
      sessionId === undefined
        ? this.db
            .prepare(
              'SELECT id, scope, subject, text, weight, created_at, updated_at FROM facts WHERE created_at >= ? AND created_at <= ? ORDER BY created_at ASC',
            )
            .all(fromMs, toMs)
        : this.db
            .prepare(
              'SELECT id, scope, subject, text, weight, created_at, updated_at FROM facts WHERE created_at >= ? AND created_at <= ? AND source_session = ? ORDER BY created_at ASC',
            )
            .all(fromMs, toMs, sessionId)
    return rows.map((row) => ({
      id: String(row.id),
      scope: String(row.scope),
      subject: String(row.subject),
      text: String(row.text),
      weight: Number(row.weight),
      createdAt: Number(row.created_at),
      updatedAt: Number(row.updated_at),
    }))
  }

  deleteDiary(id) {
    const row = this.db.prepare('SELECT rowid AS rid FROM diary WHERE id = ?').get(id)
    if (row === undefined) return false
    this.db.prepare('DELETE FROM diary_fts WHERE rowid = ?').run(row.rid)
    this.db.prepare('DELETE FROM diary WHERE id = ?').run(id)
    this.db.prepare('DELETE FROM vec WHERE kind = ? AND id = ?').run('diary', id)
    return true
  }

  /** Drop every page about one day. Returns how many were removed. */
  deleteDiaryDay(day) {
    const rows = this.db.prepare('SELECT id, rowid AS rid FROM diary WHERE day = ?').all(day)
    for (const row of rows) {
      this.db.prepare('DELETE FROM diary_fts WHERE rowid = ?').run(row.rid)
      this.db.prepare('DELETE FROM diary WHERE id = ?').run(String(row.id))
      this.db.prepare('DELETE FROM vec WHERE kind = ? AND id = ?').run('diary', String(row.id))
    }
    return rows.length
  }

  // ---- counts -------------------------------------------------------------

  stats() {
    const one = (sql) => Number(this.db.prepare(sql).get()?.n ?? 0)
    return {
      facts: one('SELECT count(*) AS n FROM facts'),
      episodes: one('SELECT count(*) AS n FROM episodes'),
      diary: one('SELECT count(*) AS n FROM diary'),
      diaryDays: one('SELECT count(DISTINCT day) AS n FROM diary'),
      vectors: one('SELECT count(*) AS n FROM vec'),
      days: one('SELECT count(DISTINCT day) AS n FROM episodes'),
      newestDay: this.db.prepare('SELECT day FROM episodes GROUP BY day ORDER BY day DESC LIMIT 1').get()?.day ?? null,
      newestDiaryDay: this.db.prepare('SELECT day FROM diary ORDER BY day DESC LIMIT 1').get()?.day ?? null,
    }
  }
}

/** Midnight of a local YYYY-MM-DD as a millisecond stamp, or undefined. */
export function startOfLocalDay(day) {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(day ?? ''))
  if (match === null) return undefined
  const date = new Date(Number(match[1]), Number(match[2]) - 1, Number(match[3]), 0, 0, 0, 0)
  return Number.isNaN(date.getTime()) ? undefined : date.getTime()
}

/** Day key used by episodes and diary rows. */
export const dayKey = dayOf
