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

test('diary: one page per delivery amends instead of appending', () => {
  const s = fresh()
  const first = s.saveDiary({ day: '2026-11-08', text: '第一次写', origin: 'run-a' })
  assert.equal(first.created, true)
  const second = s.saveDiary({ day: '2026-11-08', text: '改写一次', origin: 'run-a' })
  assert.equal(second.created, false)
  assert.equal(second.id, first.id)
  const page = s.getDiaryPage(first.id)
  assert.equal(page.text, '改写一次')
  assert.equal(page.createdAt, s.getDiaryPage(first.id).createdAt)
  assert.equal(s.listDiary().length, 1)
  // A different delivery may add its own page for the same day.
  const third = s.saveDiary({ day: '2026-11-08', text: '另一次投递', origin: 'run-b' })
  assert.equal(third.created, true)
  assert.equal(s.listDiary().length, 2)
  s.deleteDiaryDay('2026-11-08')
  assert.deepEqual(s.pagesOfDay('2026-11-08'), [])
  s.close()
})

test('meta round-trips and rebuildFts counts every table', () => {
  const s = fresh()
  s.setMeta('embeddingModel', 'bge-small-zh-v1.5')
  assert.equal(s.meta('embeddingModel'), 'bge-small-zh-v1.5')
  assert.equal(s.meta('nope'), undefined)
  s.saveFact({ text: '一条事实' })
  s.saveEpisode({ role: 'user', text: '一条片段' })
  s.saveDiary({ day: '2026-11-08', text: '一篇日记', origin: 'x' })
  const counts = s.rebuildFts()
  assert.deepEqual(counts, { facts: 1, episodes: 1, diary: 1 })
  s.close()
})

test('stats reports every table', () => {
  const s = fresh()
  s.saveFact({ text: 'a' })
  s.saveEpisode({ role: 'user', text: 'b' })
  s.saveDiary({ day: '2026-11-08', text: 'c', origin: 'x' })
  const st = s.stats()
  assert.equal(st.facts, 1)
  assert.equal(st.episodes, 1)
  assert.equal(st.diary, 1)
  assert.equal(st.days, 1)
  assert.equal(st.newestDay, dayKey(Date.now()))
  s.close()
})

test('firstUserLines reports the opening line of each session', () => {
  const s = fresh()
  s.saveEpisode({ sessionId: 'a', role: 'user', text: '第一句' })
  s.saveEpisode({ sessionId: 'a', role: 'user', text: '第二句' })
  s.saveEpisode({ sessionId: 'b', role: 'user', text: '另一个会话的开头' })
  const lines = s.firstUserLines()
  assert.equal(lines.get('a'), '第一句')
  assert.equal(lines.get('b'), '另一个会话的开头')
  assert.equal(lines.size, 2)
  s.close()
})

test('deleteSession removes only that session episodes and keeps facts', () => {
  const s = fresh()
  s.saveEpisode({ sessionId: 'a', role: 'user', text: '要忘掉的这句话' })
  s.saveEpisode({ sessionId: 'a', role: 'assistant', text: '要忘掉的这句回话' })
  s.saveEpisode({ sessionId: 'b', role: 'user', text: '别的会话留着' })
  s.saveFact({ text: '一条独立的事实' })
  assert.equal(s.deleteSession('a'), 2)
  assert.equal(s.listEpisodes().length, 1)
  assert.equal(s.listFacts().length, 1)
  assert.equal(s.firstUserLines().get('a'), undefined)
  s.close()
})

test('discardDiaryPages keeps the rewrite and drops the page it replaced', () => {
  const s = fresh()
  s.saveDiary({ day: '2026-11-08', text: '午夜前写的那篇', origin: 'run-a' })
  s.saveDiary({ day: '2026-11-08', text: '补了夜尾巴重写的那篇', origin: 'tail' })
  assert.equal(s.pagesOfDay('2026-11-08').length, 2)
  assert.deepEqual(s.discardDiaryPages('2026-11-08', 'tail'), { removed: 1, kept: 'tail', pages: 1 })
  const pages = s.pagesOfDay('2026-11-08')
  assert.equal(pages.length, 1)
  assert.equal(pages[0].origin, 'tail')
  assert.match(pages[0].text, /夜尾巴/)
  s.close()
})

test('discardDiaryPages refuses an empty or unknown keep', () => {
  const s = fresh()
  s.saveDiary({ day: '2026-11-08', text: '唯一那篇', origin: 'run-a' })
  // Empty would mean "empty the day".
  assert.deepEqual(s.discardDiaryPages('2026-11-08', ''), { removed: 0, kept: '', pages: 1 })
  // A keep naming no page means the rewrite never landed: deleting would lose
  // the only page the day has.
  assert.deepEqual(s.discardDiaryPages('2026-11-08', 'tail'), { removed: 0, kept: 'tail', pages: 1 })
  assert.equal(s.pagesOfDay('2026-11-08').length, 1)
  s.close()
})

test('discardDiaryPages never touches a hand-written page', () => {
  const s = fresh()
  s.saveDiary({ day: '2026-11-08', text: '手写的一篇', origin: '' })
  s.saveDiary({ day: '2026-11-08', text: '投递写的一篇', origin: 'run-a' })
  s.saveDiary({ day: '2026-11-08', text: '补夜尾巴的一篇', origin: 'tail' })
  assert.equal(s.discardDiaryPages('2026-11-08', 'tail').removed, 1)
  const origins = s.pagesOfDay('2026-11-08').map((page) => page.origin).sort()
  assert.deepEqual(origins, ['', 'tail'])
  s.close()
})

test('facts: weight decides what survives recall truncation', () => {
  const s = fresh()
  s.saveFact({ text: '不重要的一条', weight: 1 })
  s.saveFact({ text: '很重要的一条', weight: 5 })
  // listFacts is the panel's view: it has no weight ordering at all, so the
  // promise can only be kept by a separate query.
  assert.equal(s.listFacts().length, 2)
  // topFacts is recall's view: the promise memory_save makes.
  assert.equal(s.topFacts(1)[0].text, '很重要的一条')
  assert.equal(s.topFacts(5).length, 2)
  s.close()
})

test('facts: lastUsedAt is readable after a touch', () => {
  const s = fresh()
  const { id } = s.saveFact({ text: '被用过的一条' })
  assert.equal(s.listFacts()[0].lastUsedAt, 0)
  s.touchFacts([id])
  assert.ok(s.listFacts()[0].lastUsedAt > 0)
  s.close()
})

test('facts: updateFact rewrites in place and keeps the id', () => {
  const s = fresh()
  const { id } = s.saveFact({ text: '错别字的一条', subject: 'x', weight: 2 })
  const out = s.updateFact({ id, text: '改好的一条', weight: 4 })
  assert.equal(out.id, id)
  const rows = s.listFacts()
  assert.equal(rows.length, 1)
  assert.equal(rows[0].text, '改好的一条')
  assert.equal(rows[0].weight, 4)
  assert.equal(rows[0].subject, 'x')
  s.close()
})

test('facts: updateFact refuses an unknown id and a text clash', () => {
  const s = fresh()
  assert.equal(s.updateFact({ id: 'nope', text: 'x' }), undefined)
  s.saveFact({ text: '已有的' })
  const { id } = s.saveFact({ text: '另一条' })
  assert.throws(() => s.updateFact({ id, text: '已有的' }), /already has that text/)
  assert.throws(() => s.updateFact({ id, text: '   ' }), /text is empty/)
  assert.throws(() => s.updateFact({ id, weight: 0 }), /weight must be positive/)
  s.close()
})

test('vec: vectors round-trip per model and are dropped on rewrite', () => {
  const s = fresh()
  const { id } = s.saveFact({ text: '带向量的一条' })
  s.saveVectors('fact', [id], [Float32Array.from([0.5, 0.25])], 'model-a')
  assert.equal(s.stats().vectors, 1)
  const hit = s.loadVectors('fact', [id], 'model-a')
  assert.equal(hit.size, 1)
  assert.deepEqual([...hit.get(id)], [0.5, 0.25])
  // A different model must not read the other model's space.
  assert.equal(s.loadVectors('fact', [id], 'model-b').size, 0)
  // Rewriting the text invalidates the vector: it describes the old sentence.
  s.updateFact({ id, text: '改写了的一条' })
  assert.equal(s.loadVectors('fact', [id], 'model-a').size, 0)
  s.close()
})

test('vec: rewriting a diary page drops its cached vector too', () => {
  const s = fresh()
  const { id } = s.saveDiary({ day: '2026-11-08', text: '第一版', origin: 'run-a' })
  s.saveVectors('diary', [id], [Float32Array.from([1, 0])], 'model-a')
  assert.equal(s.loadVectors('diary', [id], 'model-a').size, 1)
  s.saveDiary({ day: '2026-11-08', text: '第二版', origin: 'run-a' })
  assert.equal(s.loadVectors('diary', [id], 'model-a').size, 0)
  s.close()
})

test('vec: deleting a fact clears its vector', () => {
  const s = fresh()
  const { id } = s.saveFact({ text: '要删掉的一条' })
  s.saveVectors('fact', [id], [Float32Array.from([1, 1])], 'model-a')
  s.deleteFact(id)
  assert.equal(s.stats().vectors, 0)
  s.close()
})
