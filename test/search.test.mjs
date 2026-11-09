import { test } from 'node:test'
import assert from 'node:assert/strict'
import { MemoryStore } from '../lib/store.js'
import { MemorySearch, bigrams, bigramSimilarity, cosine } from '../lib/search.js'

const seeded = () => {
  const store = new MemoryStore(':memory:')
  const search = new MemorySearch(store)
  store.saveFact({ text: '鸽鸽在做 DeepSeek Harness 的记忆插件', subject: 'project' })
  store.saveFact({ text: '小肥鱼喜欢吃白米饭和 Token', subject: 'companion' })
  store.saveEpisode({ role: 'user', text: '今天讨论了记忆系统要用 sqlite 存', sessionId: 'session-a' })
  store.saveDiary('2026-11-08', '今天把存储层写完了，FTS5 中文检索可用。')
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
