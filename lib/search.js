/**
 * Retrieval: one search, three independent stages.
 *
 *  Tier 1  FTS5 trigram + BM25. Always on, microseconds, and it never misses a
 *          literal substring — including Chinese, where word segmentation would
 *          otherwise lose recall.
 *  Tier 2  Chinese bigram cosine rerank over the top candidates. Pure JS, no
 *          dependency; it promotes paraphrases that share characters.
 *  Tier 3  Optional embedding rerank. Off unless the panel installs a model
 *          AND the user switches it on; any failure degrades silently to tier 2.
 *
 * The stages are cumulative, not alternatives: 3 refines what 1 and 2 found.
 *
 * @module @emo-bird/dsh-deepmemory/search
 */

const CJK = /[\u3400-\u4dbf\u4e00-\u9fff\uf900-\ufaff]/
const PUNCT = /[\s，。！？、；：""''（）【】《》…—·,.!?;:"'()\[\]{}<>/\\|`~@#$%^&*+=\-_]+/

/** Everything that is not a CJK char and not a letter/digit is a separator. */
function splitTokens(text) {
  const out = []
  let latin = ''
  for (const ch of text) {
    if (CJK.test(ch)) {
      if (latin !== '') {
        out.push(latin.toLowerCase())
        latin = ''
      }
      out.push(ch)
    } else if (PUNCT.test(ch)) {
      if (latin !== '') {
        out.push(latin.toLowerCase())
        latin = ''
      }
    } else {
      latin += ch
    }
  }
  if (latin !== '') out.push(latin.toLowerCase())
  return out
}

/**
 * Character n-grams over the token stream. Chinese text has no spaces, so a
 * bigram of adjacent CJK chars is the cheapest useful "word" surrogate; Latin
 * words stay whole.
 */
export function bigrams(text) {
  const tokens = splitTokens(text)
  const grams = []
  for (let i = 0; i < tokens.length; i += 1) {
    const a = tokens[i]
    if (!CJK.test(a)) {
      grams.push(a)
      continue
    }
    const b = tokens[i + 1]
    if (b !== undefined && CJK.test(b)) {
      grams.push(a + b)
      i += 0
    } else {
      grams.push(a)
    }
  }
  return grams
}

function termFrequency(text) {
  const map = new Map()
  for (const g of bigrams(text)) map.set(g, (map.get(g) ?? 0) + 1)
  return map
}

/** Cosine over sparse bigram vectors. Returns 0 when either side is empty. */
export function bigramSimilarity(query, text) {
  const a = termFrequency(query)
  const b = termFrequency(text)
  if (a.size === 0 || b.size === 0) return 0
  let dot = 0
  let na = 0
  let nb = 0
  for (const [k, v] of a) {
    na += v * v
    const w = b.get(k)
    if (w !== undefined) dot += v * w
  }
  for (const v of b.values()) nb += v * v
  if (na === 0 || nb === 0) return 0
  return dot / (Math.sqrt(na) * Math.sqrt(nb))
}

/** FTS5 MATCH needs its own quoting; a bare query with `"` or `*` is a syntax error. */
function matchExpression(query) {
  const cleaned = query.replace(/["']/g, ' ').trim()
  if (cleaned === '') return undefined
  // A trigram table cannot answer a query shorter than one trigram, so those
  // fall back to LIKE in `searchFts`.
  return `"${cleaned}"`
}

const KINDS = new Set(['fact', 'episode', 'diary'])

export class MemorySearch {
  /**
   * @param {import('./store.js').MemoryStore} store
   * @param {{embedder?: {model: string, dim: number, embed: (texts: string[]) => Promise<Float32Array[]>}}} [options]
   */
  constructor(store, options = {}) {
    this.store = store
    this.embedder = options.embedder
  }

  /** Whether tier 3 can run at all right now. */
  get semanticAvailable() {
    return this.embedder !== undefined && this.embedder !== null
  }

  /**
   * @param {string} query
   * @param {{kinds?: string[], limit?: number, semantic?: boolean, minScore?: number}} [options]
   * @returns {Promise<{hits: Array<object>, tiers: {fts: number, bigram: number, semantic: number}}>}
   */
  async search(query, options = {}) {
    const text = String(query ?? '').trim()
    const limit = Math.max(1, Math.min(50, options.limit ?? 8))
    const kinds = (options.kinds ?? ['fact', 'episode', 'diary']).filter((k) => KINDS.has(k))
    if (text === '' || kinds.length === 0) {
      return { hits: [], tiers: { fts: 0, bigram: 0, semantic: 0 } }
    }

    let pool = this.searchFts(text, kinds)
    // Trigram FTS only fires on runs of three or more characters, so a two
    // character Chinese query looked like an exact-match-only search. Top the
    // pool up with substring candidates (one LIKE per term) before reranking:
    // tier 1 promises recall, and it has to keep that promise for short queries.
    if (pool.length < limit) {
      const seen = new Set(pool.map((hit) => `${hit.kind}:${hit.id}`))
      for (const hit of this.searchLike(text, kinds)) {
        const key = `${hit.kind}:${hit.id}`
        if (seen.has(key)) continue
        seen.add(key)
        pool.push(hit)
      }
    }
    const reranked = this.rerankBigrams(text, pool)
    let final = reranked
    let semanticRan = 0
    if (options.semantic === true && this.semanticAvailable) {
      try {
        final = await this.rerankSemantic(text, reranked)
        semanticRan = final.length
      } catch {
        final = reranked
      }
    }

    const minScore = options.minScore ?? 0
    const hits = final
      .filter((hit) => hit.score >= minScore)
      .slice(0, limit)
      .map((hit) => ({ ...hit, score: Number(hit.score.toFixed(4)) }))
    return { hits, tiers: { fts: pool.length, bigram: reranked.length, semantic: semanticRan } }
  }

  /** Tier 1: literal substring recall in BM25 order. */
  searchFts(query, kinds) {
    const expr = matchExpression(query)
    const out = []
    for (const kind of kinds) {
      const table = kind === 'fact' ? 'facts_fts' : kind === 'episode' ? 'episodes_fts' : 'diary_fts'
      const base = kind === 'fact' ? 'facts' : kind === 'episode' ? 'episodes' : 'diary'
      const rows =
        expr !== undefined && [...query].length >= 3
          ? this.store.db
              .prepare(`SELECT rowid AS rid, bm25(${table}) AS rank FROM ${table} WHERE ${table} MATCH ? ORDER BY rank LIMIT 200`)
              .all(expr)
          : this.store.db
              .prepare(`SELECT rowid AS rid, 0 AS rank FROM ${base} WHERE text LIKE ? LIMIT 200`)
              .all(`%${query}%`)
      for (const row of rows) {
        const record = this.loadRow(kind, Number(row.rid))
        if (record === undefined) continue
        // bm25() is a positive-cost metric: lower is better. Map to a 0..1 score
        // so later stages can blend with cosine in the same units.
        const raw = Number(row.rank) || 0
        const score = 1 / (1 + Math.max(0, raw))
        out.push({ ...record, score, ftsRank: raw })
      }
    }
    return out
  }

  /**
   * Substring recall for queries the trigram index cannot answer - anything
   * shorter than three characters, and words that only appear as a fragment
   * inside a longer run. Every term contributes a LIKE; rows matching more
   * terms score higher, which is what makes a loose query behave like a fuzzy
   * one instead of returning nothing.
   */
  searchLike(query, kinds) {
    const terms = String(query)
      .split(/[\s,，。、;；:：!！?？'"“”‘’()（）\[\]【】<>《》]+/u)
      .map((term) => term.trim())
      .filter((term) => term !== '')
    const needles = terms.length === 0 ? [String(query)] : terms
    const out = []
    for (const kind of kinds) {
      const base = kind === 'fact' ? 'facts' : kind === 'episode' ? 'episodes' : 'diary'
      const clause = needles.map(() => 'text LIKE ?').join(' OR ')
      const queryOnce = (list) => {
        const where = list.map(() => 'text LIKE ?').join(' OR ')
        return this.store.db
          .prepare(`SELECT rowid AS rid FROM ${base} WHERE ${where} LIMIT 200`)
          .all(...list.map((term) => `%${term}%`))
      }
      let used = needles
      let rows = queryOnce(needles)
      // "水母粉色" is not a substring of anything, but the sentence does contain
      // both 水母 and 粉色. Fall back to character bigrams so a run-together
      // query still lands, ranked by how many of those bigrams it contains.
      if (rows.length === 0 && needles.length === 1 && [...needles[0]].length >= 3) {
        const chars = [...needles[0]]
        const grams = []
        for (let index = 0; index + 1 < chars.length; index += 1) {
          const gram = chars[index] + chars[index + 1]
          if (!grams.includes(gram)) grams.push(gram)
        }
        used = grams
        rows = queryOnce(grams)
      }
      for (const row of rows) {
        const record = this.loadRow(kind, Number(row.rid))
        if (record === undefined) continue
        const hitCount = used.filter((term) => String(record.text).includes(term)).length
        const score = 0.35 + 0.5 * (hitCount / used.length)
        out.push({ ...record, score, ftsRank: 0 })
      }
    }
    return out
  }

  loadRow(kind, rowid) {
    if (kind === 'fact') {
      const row = this.store.db.prepare('SELECT * FROM facts WHERE rowid = ?').get(rowid)
      if (row === undefined) return undefined
      return {
        kind: 'fact',
        id: String(row.id),
        text: String(row.text),
        scope: String(row.scope),
        subject: String(row.subject),
        weight: Number(row.weight),
        createdAt: Number(row.created_at),
        sessionId: String(row.source_session),
        presetId: String(row.source_preset),
      }
    }
    if (kind === 'episode') {
      const row = this.store.db.prepare('SELECT * FROM episodes WHERE rowid = ?').get(rowid)
      if (row === undefined) return undefined
      return {
        kind: 'episode',
        id: String(row.id),
        text: String(row.text),
        role: String(row.role),
        day: String(row.day),
        importance: Number(row.importance),
        createdAt: Number(row.created_at),
        sessionId: String(row.session_id),
        presetId: String(row.preset_id),
      }
    }
    const row = this.store.db.prepare('SELECT * FROM diary WHERE rowid = ?').get(rowid)
    if (row === undefined) return undefined
    return {
      kind: 'diary',
      id: String(row.day),
      text: String(row.text),
      day: String(row.day),
      createdAt: Number(row.created_at),
    }
  }

  /** Tier 2: blend BM25 with bigram cosine, then sort. */
  rerankBigrams(query, pool) {
    return pool
      .map((hit) => {
        const cos = bigramSimilarity(query, hit.text)
        const boost = hit.kind === 'fact' ? Math.min(0.2, (hit.weight - 1) * 0.05) : 0
        const fresh = hit.kind === 'diary' ? 0.05 : 0
        return { ...hit, score: 0.5 * hit.score + 0.5 * cos + boost + fresh }
      })
      .sort((a, b) => b.score - a.score)
  }

  /** Tier 3: embedding cosine over the head of the pool. */
  async rerankSemantic(query, pool) {
    const head = pool.slice(0, 50)
    if (head.length === 0) return pool
    const [qvec] = await this.embedder.embed([query])
    const vecs = await this.embedder.embed(head.map((hit) => hit.text))
    const blended = head.map((hit, index) => {
      const cos = cosine(qvec, vecs[index])
      return { ...hit, score: 0.35 * hit.score + 0.65 * cos, semanticScore: cos }
    })
    return [...blended, ...pool.slice(head.length)].sort((a, b) => b.score - a.score)
  }
}

export function cosine(a, b) {
  if (!a || !b || a.length !== b.length || a.length === 0) return 0
  let dot = 0
  let na = 0
  let nb = 0
  for (let i = 0; i < a.length; i += 1) {
    dot += a[i] * b[i]
    na += a[i] * a[i]
    nb += b[i] * b[i]
  }
  if (na === 0 || nb === 0) return 0
  return dot / (Math.sqrt(na) * Math.sqrt(nb))
}
