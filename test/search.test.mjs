import { test } from 'node:test'
import assert from 'node:assert/strict'
import { MemoryStore } from '../lib/store.js'
import { MemorySearch, bigrams, bigramSimilarity, cosine, matchMarks } from '../lib/search.js'

const seeded = () => {
  const store = new MemoryStore(':memory:')
  const search = new MemorySearch(store)
  store.saveFact({ text: '鸽鸽在做 DeepSeek Harness 的记忆插件', subject: 'project' })
  store.saveFact({ text: '小肥鱼喜欢吃白米饭和 Token', subject: 'companion' })
  store.saveEpisode({ role: 'user', text: '今天讨论了记忆系统要用 sqlite 存', sessionId: 'session-a' })
  store.saveDiary({ day: '2026-11-08', text: '今天把存储层写完了，FTS5 中文检索可用。', origin: 'run-a' })
  return { store, search }
}

test('bigrams keeps latin words whole and pairs CJK neighbours', () => {
  const grams = bigrams('记忆系统 sqlite 很好')
  assert.ok(grams.includes('记忆'))
  assert.ok(grams.includes('sqlite'))
  assert.ok(grams.includes('很好'))
})

test('bigramSimilarity is 1 for identical text and 0 without overlap', () => {
  assert.equal(bigramSimilarity('记忆系统', '记忆系统'), 1)
  assert.equal(bigramSimilarity('记忆系统', '完全不相干'), 0)
  assert.ok(bigramSimilarity('记忆系统', '这是我记忆里的系统') > 0)
})

test('cosine handles mismatched and zero vectors', () => {
  assert.equal(cosine([1, 0], [1, 0, 0]), 0)
  assert.equal(cosine([0, 0], [1, 1]), 0)
  assert.equal(cosine([1, 0], [1, 0]), 1)
})

test('tier 1 finds a literal Chinese substring', async () => {
  const { store, search } = seeded()
  const { hits } = await search.search('记忆系统')
  assert.ok(hits.length >= 1)
  assert.ok(hits.some((hit) => hit.text.includes('记忆系统')))
  store.close()
})

test('tier 1 falls back to LIKE for very short queries', async () => {
  const { store, search } = seeded()
  const { hits } = await search.search('白米')
  assert.ok(hits.length >= 1)
  assert.ok(hits.every((hit) => hit.text.includes('白米')))
  store.close()
})

test('kinds filter narrows the pool', async () => {
  const { store, search } = seeded()
  const { hits } = await search.search('存储层', { kinds: ['diary'] })
  assert.ok(hits.length >= 1)
  assert.ok(hits.every((hit) => hit.kind === 'diary'))
  store.close()
})

test('empty query returns nothing without touching sqlite', async () => {
  const { store, search } = seeded()
  const out = await search.search('   ')
  assert.deepEqual(out.hits, [])
  assert.deepEqual(out.tiers, { fts: 0, bigram: 0, semantic: 0 })
  store.close()
})

test('tier 3 is skipped when no embedder is configured', async () => {
  const { store, search } = seeded()
  assert.equal(search.semanticAvailable, false)
  const out = await search.search('记忆', { semantic: true })
  assert.equal(out.tiers.semantic, 0)
  assert.ok(out.hits.length >= 1)
  store.close()
})

test('tier 3 reranks when an embedder is present', async () => {
  const { store } = seeded()
  const embed = async (texts) => texts.map((t) => Float32Array.from([t.includes('记忆') ? 1 : 0, t.includes('白米') ? 1 : 0]))
  const search = new MemorySearch(store, { embedder: { model: 'fake', dim: 2, embed } })
  assert.equal(search.semanticAvailable, true)
  const out = await search.search('记忆', { semantic: true })
  assert.ok(out.tiers.semantic > 0)
  assert.ok(out.hits.length >= 1)
  store.close()
})

test('tier 3 failure degrades to tier 2 instead of throwing', async () => {
  const { store } = seeded()
  const embed = async () => {
    throw new Error('model missing')
  }
  const search = new MemorySearch(store, { embedder: { model: 'broken', dim: 2, embed } })
  const out = await search.search('记忆', { semantic: true })
  assert.equal(out.tiers.semantic, 0)
  assert.ok(out.hits.length >= 1)
  store.close()
})

test('limit is clamped and results are sorted descending', async () => {
  const { store, search } = seeded()
  const out = await search.search('记忆', { limit: 2 })
  assert.ok(out.hits.length <= 2)
  for (let i = 1; i < out.hits.length; i += 1) {
    assert.ok(out.hits[i - 1].score >= out.hits[i].score)
  }
  store.close()
})

test('a two character query still finds its sentence', async () => {
  const store = new MemoryStore(':memory:')
  store.saveEpisode({ sessionId: 's1', presetId: 'p', role: 'user', text: '我记得上次聊过水母图标的颜色', importance: 1 })
  const search = new MemorySearch(store)
  const { hits } = await search.search('水母', { limit: 5 })
  assert.equal(hits.length, 1)
})

test('a run-together query falls back to character bigrams', async () => {
  const store = new MemoryStore(':memory:')
  store.saveEpisode({ sessionId: 's1', presetId: 'p', role: 'user', text: '我记得上次聊过水母图标的颜色', importance: 1 })
  const search = new MemorySearch(store)
  const { hits } = await search.search('水母颜色', { limit: 5 })
  assert.equal(hits.length, 1)
})

test('a literal term is reported as an exact mark', async () => {
  const store = new MemoryStore(':memory:')
  store.saveEpisode({ sessionId: 's1', presetId: 'p', role: 'user', text: '我记得上次聊过水母图标的颜色', importance: 1 })
  const search = new MemorySearch(store)
  const { hits } = await search.search('水母', { limit: 5 })
  assert.deepEqual(hits[0].marks, [{ text: '水母', tier: 'exact' }])
  store.close()
})

test('a bigram-only match is reported as fuzzy, not left unmarked', async () => {
  const store = new MemoryStore(':memory:')
  store.saveEpisode({ sessionId: 's1', presetId: 'p', role: 'user', text: '我记得上次聊过水母图标的颜色', importance: 1 })
  const search = new MemorySearch(store)
  const { hits } = await search.search('水母颜色', { limit: 5 })
  assert.equal(hits.length, 1)
  assert.ok(hits[0].marks.length > 0, 'a fuzzy hit must still carry something to highlight')
  assert.ok(hits[0].marks.every((mark) => mark.tier === 'fuzzy'))
  const texts = hits[0].marks.map((mark) => mark.text)
  assert.ok(texts.includes('水母'))
  assert.ok(texts.includes('颜色'))
  store.close()
})

test('matchMarks keeps the whole term when it is present and caps the list', () => {
  assert.deepEqual(matchMarks('今天聊了水母颜色的方案', '水母颜色'), [{ text: '水母颜色', tier: 'exact' }])
  assert.deepEqual(matchMarks('完全不相干的一句话', '水母'), [])
})

test('tier 3 caches vectors so a second search embeds only the query', async () => {
  const { store } = seeded()
  let batches = 0
  const embed = async (texts) => {
    batches += 1
    return texts.map((t) => Float32Array.from([t.includes('记忆') ? 1 : 0, t.includes('白米') ? 1 : 0]))
  }
  const search = new MemorySearch(store, { embedder: { model: 'fake', dim: 2, embed } })
  const first = await search.search('记忆', { semantic: true })
  assert.ok(first.tiers.semantic > 0)
  assert.ok(store.stats().vectors > 0, 'the first search must have written the cache')
  const after = batches
  const second = await search.search('记忆', { semantic: true })
  assert.ok(second.tiers.semantic > 0)
  // Second pass: one batch for the query, none for the candidates.
  assert.equal(batches - after, 1)
  store.close()
})

test('tier 3 does not reuse vectors from another model', async () => {
  const { store } = seeded()
  const embed = async (texts) => texts.map((t) => Float32Array.from([t.includes('记忆') ? 1 : 0, 1]))
  const first = new MemorySearch(store, { embedder: { model: 'model-a', dim: 2, embed } })
  await first.search('记忆', { semantic: true })
  const cached = store.stats().vectors
  assert.ok(cached > 0)
  // A different model name must miss the cache entirely rather than blend two
  // unrelated vector spaces.
  const second = new MemorySearch(store, { embedder: { model: 'model-b', dim: 2, embed } })
  const out = await second.search('记忆', { semantic: true })
  assert.ok(out.tiers.semantic > 0)
  assert.equal(store.stats().vectors, cached, 'same ids, rewritten rows for the new model')
  store.close()
})

test('an episode importance nudges the score without dominating it', async () => {
  const store = new MemoryStore(':memory:')
  store.saveEpisode({ sessionId: 's1', role: 'user', text: '记忆系统的一条长记录', importance: 3 })
  store.saveEpisode({ sessionId: 's1', role: 'user', text: '记忆系统的一条短记录', importance: 1 })
  const search = new MemorySearch(store)
  const { hits } = await search.search('记忆系统', { limit: 5 })
  assert.equal(hits.length, 2)
  const byText = new Map(hits.map((hit) => [hit.text, hit.score]))
  assert.ok(byText.get('记忆系统的一条长记录') > byText.get('记忆系统的一条短记录'))
  store.close()
})
