import { test } from 'node:test'
import assert from 'node:assert/strict'
import { MemoryStore, dayKey } from '../lib/store.js'

const fresh = () => new MemoryStore(':memory:')

test('facts: insert then repeat updates in place', () => {
  const s = fresh()
  const a = s.saveFact({ text: '鸽鸽住在杭州', subject: 'user' })
  assert.equal(a.updated, false)
  const b = s.saveFact({ text: '鸽鸽住在杭州', subject: 'user', weight: 3 })
  assert.equal(b.updated, true)
  assert.equal(b.id, a.id)
  const rows = s.listFacts()
  assert.equal(rows.length, 1)
  assert.equal(rows[0].weight, 3)
  s.close()
})

test('facts: empty text throws', () => {
  const s = fresh()
  assert.throws(() => s.saveFact({ text: '   ' }), /text is empty/)
  s.close()
})

test('facts: delete removes the row and its index entry', () => {
  const s = fresh()
  const { id } = s.saveFact({ text: '小肥鱼爱吃白饭' })
  assert.equal(s.deleteFact(id), true)
  assert.equal(s.deleteFact(id), false)
  assert.equal(s.listFacts().length, 0)
  assert.equal(s.stats().facts, 0)
  s.close()
})

test('episodes: saved with the right day', () => {
  const s = fresh()
  const id = s.saveEpisode({ sessionId: 'session-1', role: 'user', text: '今天聊了记忆系统' })
  assert.ok(id.length > 0)
  const rows = s.listEpisodes()
  assert.equal(rows.length, 1)
  assert.equal(rows[0].day, dayKey(Date.now()))
  assert.equal(rows[0].role, 'user')
  assert.equal(s.episodesOfDay(rows[0].day).length, 1)
  s.close()
})

test('episodes: filter by day', () => {
  const s = fresh()
  s.saveEpisode({ role: 'user', text: '第一条' })
  const rows = s.listEpisodes({ day: '1999-01-01' })
  assert.equal(rows.length, 0)
  s.close()
})

test('diary: upsert keeps created_at, bumps updated_at', () => {
  const s = fresh()
  assert.equal(s.saveDiary('2026-11-08', '第一次写'), false)
  const first = s.getDiary('2026-11-08')
  assert.equal(s.saveDiary('2026-11-08', '改写一次'), true)
  const second = s.getDiary('2026-11-08')
  assert.equal(second.text, '改写一次')
  assert.equal(second.createdAt, first.createdAt)
  assert.equal(s.listDiary().length, 1)
  s.deleteDiary('2026-11-08')
  assert.equal(s.getDiary('2026-11-08'), undefined)
  s.close()
})

test('meta round-trips and rebuildFts counts every table', () => {
  const s = fresh()
  s.setMeta('embeddingModel', 'bge-small-zh-v1.5')
  assert.equal(s.meta('embeddingModel'), 'bge-small-zh-v1.5')
  assert.equal(s.meta('nope'), undefined)
  s.saveFact({ text: '一条事实' })
  s.saveEpisode({ role: 'user', text: '一条片段' })
  s.saveDiary('2026-11-08', '一篇日记')
  const counts = s.rebuildFts()
  assert.deepEqual(counts, { facts: 1, episodes: 1, diary: 1 })
  s.close()
})

test('stats reports every table', () => {
  const s = fresh()
  s.saveFact({ text: 'a' })
  s.saveEpisode({ role: 'user', text: 'b' })
  s.saveDiary('2026-11-08', 'c')
  const st = s.stats()
  assert.equal(st.facts, 1)
  assert.equal(st.episodes, 1)
  assert.equal(st.diary, 1)
  assert.equal(st.days, 1)
  assert.equal(st.newestDay, dayKey(Date.now()))
  s.close()
})
