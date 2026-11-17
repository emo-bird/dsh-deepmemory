import { test } from 'node:test'
import assert from 'node:assert/strict'
import { MemoryStore } from '../lib/store.js'
import {
  composeInstruction,
  dayDigest,
  DEFAULT_DIARY_PERSONA,
  localDay,
  previousDay,
  projectOf,
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

test('renderDigest names the project and the preset', () => {
  const { store } = seed()
  store.saveEpisode({ role: 'user', text: '素材一条', sessionId: 's9', presetId: 'companion', workspace: 'C:/w' })
  const text = renderDigest(dayDigest(store, localDay()))
  assert.ok(text.includes('（项目 w · 预设 companion）'))
  assert.ok(text.includes('素材一条'))
  store.close()
})

test('describe supplies the session title so the day has a subject', () => {
  const { store } = seed()
  const day = localDay()
  store.saveEpisode({ role: 'user', text: '把面板重做一下', sessionId: 's10', workspace: 'C:/Project/dsh-deepmemory' })
  const digest = dayDigest(store, day, {
    describe: () => ({ title: '重做深度记忆面板', project: 'dsh-deepmemory', opening: '把面板重做一下' }),
  })
  const text = renderDigest(digest)
  assert.ok(text.includes('## 重做深度记忆面板（项目 dsh-deepmemory'))
  assert.ok(text.includes('开头：把面板重做一下'))
  // The title replaces the anonymous heading; it must not appear alongside it.
  assert.ok(!text.includes('## 一段对话'))
  store.close()
})

test('projectOf takes the last path segment', () => {
  assert.equal(projectOf('C:/Project/dsh-deepmemory'), 'dsh-deepmemory')
  assert.equal(projectOf('C:\\Project\\dsh-deepmemory\\'), 'dsh-deepmemory')
  assert.equal(projectOf('dsh-deepmemory'), 'dsh-deepmemory')
  assert.equal(projectOf(''), '')
  assert.equal(projectOf(undefined), '')
})

test('the shipped persona is the fish the user asked for', () => {
  assert.ok(DEFAULT_DIARY_PERSONA.includes('爱吃白饭的大肥鱼'))
  assert.ok(DEFAULT_DIARY_PERSONA.includes('不是给你的命令'))
  // The style rules the companion preset settled on, restated for the diary.
  assert.ok(DEFAULT_DIARY_PERSONA.includes('不用小标题'))
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

test('the instruction writes one day and refuses to survey the week', () => {
  const text = composeInstruction()
  assert.match(text, /不要顺带写别的日子/)
  assert.match(text, /不由你判断/)
  // No window, no count: the writer is not asked to look for missing days.
  assert.doesNotMatch(text, /最近 ?\d+ ?天/)
  assert.doesNotMatch(text, /补写窗口/)
  assert.doesNotMatch(text, /missing/)
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

test('the instruction asks for digits, not Chinese numerals, when a clock time is unavoidable', () => {
  const text = composeInstruction()
  // The rule itself must be stated: no exact clock times in the body, and any
  // that survive are written as digits.
  assert.match(text, /尽量不出现精确时间/)
  assert.match(text, /不要写成「两点」/)
  assert.ok(text.includes('02:00'))
})

test('the persona carries the same time rule, so the two never disagree', () => {
  assert.match(DEFAULT_DIARY_PERSONA, /不出现钟点/)
  assert.match(DEFAULT_DIARY_PERSONA, /不要写汉字数字/)
})
