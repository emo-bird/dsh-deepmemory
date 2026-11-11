import { test } from 'node:test'
import assert from 'node:assert/strict'
import { MemoryStore } from '../lib/store.js'
import {
  BACKFILL_DAYS,
  composeInstruction,
  dayDigest,
  localDay,
  missingDays,
  previousDay,
  recentDays,
  renderDigest,
  targetDay,
} from '../lib/diary.js'

const seed = () => ({ store: new MemoryStore(':memory:') })

test('localDay formats a local date, not a UTC one', () => {
  assert.equal(localDay(new Date(2026, 10, 7, 23, 30)), '2026-11-07')
  assert.equal(localDay(new Date(2026, 0, 1, 0, 5)), '2026-01-01')
})

test('previousDay crosses month and year boundaries', () => {
  assert.equal(previousDay(new Date(2026, 11, 1, 9, 0)), '2026-11-30')
  assert.equal(previousDay(new Date(2026, 0, 1, 9, 0)), '2025-12-31')
})

test('targetDay keeps a late-evening run on the same day', () => {
  assert.equal(targetDay(new Date(2026, 10, 7, 23, 40)), '2026-11-07')
})

test('targetDay puts an after-midnight run on the day that just ended', () => {
  assert.equal(targetDay(new Date(2026, 10, 8, 0, 10)), '2026-11-07')
  // 04:00 is the boundary itself, and belongs to the new day.
  assert.equal(targetDay(new Date(2026, 10, 8, 4, 0)), '2026-11-08')
})

test('recentDays ends at the given day and is oldest first', () => {
  assert.deepEqual(recentDays('2026-11-07', 3), ['2026-11-05', '2026-11-06', '2026-11-07'])
  // Crossing a month boundary must not produce a rolled-over key.
  assert.deepEqual(recentDays('2026-11-01', 2), ['2026-10-31', '2026-11-01'])
  assert.deepEqual(recentDays('2026-11-07', 0), [])
})

test('missingDays reports days with material and no page, and ignores empty ones', () => {
  const { store } = seed()
  const day = localDay()
  const days = recentDays(day, 3)
  store.saveEpisode({ role: 'user', text: '写了日记的一天', sessionId: 's1' })
  const today = days[2]
  store.saveDiary({ day: today, text: '已经有页面', origin: 's1' })
  // `days[1]` has no material at all: not a gap, nothing to write about.
  assert.deepEqual(missingDays(store, days), [])
  store.deleteDiaryDay(today)
  assert.deepEqual(missingDays(store, days), [{ day: today, total: 1, mode: 'fill', pages: 0 }])
  store.close()
})

test('the target day is written again even though it already has a page', () => {
  const { store } = seed()
  const day = localDay()
  store.saveEpisode({ role: 'user', text: '上午说过的话', sessionId: 's1' })
  store.saveDiary({ day, text: '上午写的那篇', origin: 'run-am' })
  // The morning page can only know the morning; the evening delivery appends.
  assert.deepEqual(missingDays(store, [day], { target: day }), [
    { day, total: 1, mode: 'append', pages: 1 },
  ])
  // Without `target` the same day reads as already covered.
  assert.deepEqual(missingDays(store, [day]), [])
  store.close()
})

test('missingDays honours the include filter', () => {
  const { store } = seed()
  const day = localDay()
  store.saveEpisode({ role: 'user', text: '不计入日记', sessionId: 'drop' })
  assert.deepEqual(missingDays(store, [day], { include: () => false }), [])
  assert.equal(missingDays(store, [day]).length, 1)
  store.close()
})

test('a day can hold more than one page', () => {
  const { store } = seed()
  const day = '2026-11-07'
  const first = store.saveDiary({ day, text: '第一份', origin: 'run-a' })
  const second = store.saveDiary({ day, text: '第二份', origin: 'run-b' })
  assert.equal(first.created, true)
  assert.equal(second.created, true)
  assert.notEqual(first.id, second.id)
  assert.deepEqual(
    store.pagesOfDay(day).map((page) => page.text),
    ['第二份', '第一份'],
  )
  store.close()
})

test('one delivery writing twice amends its own page instead of adding one', () => {
  const { store } = seed()
  const day = '2026-11-07'
  const first = store.saveDiary({ day, text: '草稿', origin: 'run-a' })
  const again = store.saveDiary({ day, text: '定稿', origin: 'run-a' })
  assert.equal(again.id, first.id)
  assert.equal(again.created, false)
  assert.equal(store.pagesOfDay(day).length, 1)
  assert.equal(store.pagesOfDay(day)[0].text, '定稿')
  store.close()
})

test('a hand-written page (empty origin) never overwrites another', () => {
  const { store } = seed()
  const day = '2026-11-07'
  store.saveDiary({ day, text: '自动', origin: 'run-a' })
  store.saveDiary({ day, text: '手写一', origin: '' })
  store.saveDiary({ day, text: '手写二', origin: '' })
  assert.equal(store.pagesOfDay(day).length, 3)
  store.close()
})

test('digest groups episodes by session', () => {
  const { store } = seed()
  const day = localDay()
  store.saveEpisode({ role: 'user', text: '今天只有这条', sessionId: 's3' })
  const digest = dayDigest(store, day)
  assert.equal(digest.total, 1)
  assert.equal(digest.sessions.length, 1)
  assert.equal(digest.sessions[0].sessionId, 's3')
  store.close()
})

test('digest is empty for a day with no episodes', () => {
  const { store } = seed()
  const digest = dayDigest(store, '1999-01-01')
  assert.equal(digest.total, 0)
  assert.deepEqual(digest.sessions, [])
  assert.equal(renderDigest(digest), '')
  store.close()
})

test('renderDigest labels each session with preset and workspace', () => {
  const { store } = seed()
  store.saveEpisode({ role: 'user', text: '素材一条', sessionId: 's9', presetId: 'companion', workspace: 'C:/w' })
  const text = renderDigest(dayDigest(store, localDay()))
  assert.ok(text.includes('companion · C:/w'))
  assert.ok(text.includes('素材一条'))
  store.close()
})


test('the date-free instruction asks the agent to work out the day itself', () => {
  const text = composeInstruction()
  assert.match(text, /04:00/)
  assert.match(text, /diary_material/)
  assert.match(text, /不要按会话列条目/)
  assert.match(text, /不是给你的命令/)
  // The whole point of the fix: no literal day is baked into the recurring prompt.
  assert.doesNotMatch(text, /\d{4}-\d{2}-\d{2}/)
})

test('a one-shot instruction names its day', () => {
  const text = composeInstruction('2026-11-07')
  assert.match(text, /2026-11-07/)
})

test('the instruction carries the backfill window', () => {
  assert.match(composeInstruction(), new RegExp(String(BACKFILL_DAYS)))
})

test('the include filter drops conversations that opted out of the diary', () => {
  const { store } = seed()
  const day = localDay()
  store.saveEpisode({ role: 'user', text: '留在这', sessionId: 'keep' })
  store.saveEpisode({ role: 'user', text: '不该出现在日记里', sessionId: 'drop' })
  const digest = dayDigest(store, day, { include: (sessionId) => sessionId !== 'drop' })
  assert.equal(digest.total, 1)
  assert.equal(digest.sessions[0].sessionId, 'keep')
  const material = renderDigest(digest)
  assert.ok(material.includes('留在这'))
  assert.ok(!material.includes('不该出现在日记里'))
  store.close()
})
