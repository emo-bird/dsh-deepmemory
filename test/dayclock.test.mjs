/**
 * The day boundary, and what a diary day turns into around it.
 *
 * Every test here builds its own timestamps. The whole feature is about "when
 * did this happen", so a test that ran against the wall clock would be a test of
 * the clock instead: it would pass or fail depending on the hour it ran at.
 */

import assert from 'node:assert/strict'
import { test } from 'node:test'

import { MemoryStore } from '../lib/store.js'
import {
  DEFAULT_DAYCLOCK,
  HOUR_MS,
  cutHourOf,
  dayKeyOf,
  dayOfMoment,
  nightWindowOf,
  normalizeDayclock,
  startOfDayMs,
  windowOf,
} from '../lib/dayclock.js'
import { dayDigest, dayWindow, hasNightTail, nightTailOf, previousMaterial, renderDigest } from '../lib/diary.js'

const at = (day, hour, minute = 0) => startOfDayMs(day) + hour * HOUR_MS + minute * 60_000

/** A store holding the given turns, each placed at an explicit instant. */
function seedStore(turns) {
  const store = new MemoryStore(':memory:')
  for (const [time, text, sessionId] of turns) {
    store.saveEpisode({ role: 'user', text, sessionId: sessionId ?? 's1', at: time })
  }
  return store
}

test('a day key is a local calendar date', () => {
  assert.equal(dayKeyOf(new Date(2026, 10, 7, 23, 30)), '2026-11-07')
  assert.equal(dayKeyOf(new Date(2026, 0, 1, 0, 5)), '2026-01-01')
})

test('a moment belongs to the day its cut says it does', () => {
  // 01:20 with a 04:00 cut is still the previous evening.
  assert.equal(dayOfMoment(at('2026-11-08', 1, 20), 4), '2026-11-07')
  // The same instant, with no cut, is simply the 8th.
  assert.equal(dayOfMoment(at('2026-11-08', 1, 20), 0), '2026-11-08')
})

test('the settings are clamped into a usable range', () => {
  assert.deepEqual(normalizeDayclock({}), DEFAULT_DAYCLOCK)
  assert.equal(normalizeDayclock({ gapMinutes: 1 }).gapMinutes, 30)
  assert.equal(normalizeDayclock({ gapMinutes: 9999 }).gapMinutes, 360)
  assert.equal(normalizeDayclock({ latestHour: 0 }).latestHour, 1)
  assert.equal(normalizeDayclock({ latestHour: 99 }).latestHour, 12)
  // Explicitly off survives; anything else is on.
  assert.equal(normalizeDayclock({ enabled: false }).enabled, false)
  assert.equal(normalizeDayclock({ enabled: 'yes' }).enabled, true)
})

test('a night with no activity has no cut of its own', () => {
  assert.equal(cutHourOf([]), 0)
  assert.equal(cutHourOf([], { enabled: false }), 0)
  assert.equal(cutHourOf([at('2026-11-08', 1, 0)], { enabled: false }), 0)
})

test('the cut follows one continuous stretch and stops at the first gap', () => {
  // 00:10, 01:00 — 50 minutes apart, one stretch: the night ended around 01:00.
  assert.equal(cutHourOf([at('2026-11-08', 0, 10), at('2026-11-08', 1, 0)]), 2)
  // Add 03:30, two and a half hours later: that is a second, unrelated burst.
  assert.equal(cutHourOf([at('2026-11-08', 0, 10), at('2026-11-08', 1, 0), at('2026-11-08', 3, 30)]), 2)
  // A lone 03:30 is still its own night.
  assert.equal(cutHourOf([at('2026-11-08', 3, 30)]), 4)
})

test('the cut never exceeds the configured ceiling', () => {
  const stamps = [at('2026-11-08', 1, 0), at('2026-11-08', 2, 0), at('2026-11-08', 5, 30)]
  assert.equal(cutHourOf(stamps, { latestHour: 4, gapMinutes: 360 }), 4)
  assert.equal(cutHourOf(stamps, { latestHour: 6, gapMinutes: 360 }), 6)
})

test('a window runs from its own cut to the next day\'s cut', () => {
  const window = windowOf('2026-11-07', 2, 4)
  assert.equal(window.from, at('2026-11-07', 2, 0))
  assert.equal(window.to, at('2026-11-08', 4, 0))
  // No cuts at all is exactly the calendar day.
  assert.deepEqual(windowOf('2026-11-07', 0, 0), {
    from: startOfDayMs('2026-11-07'),
    to: startOfDayMs('2026-11-08'),
  })
})

test('the night window is the hours that can belong to the day before', () => {
  const night = nightWindowOf('2026-11-07', { latestHour: 4 })
  assert.equal(night.from, startOfDayMs('2026-11-07'))
  assert.equal(night.to, startOfDayMs('2026-11-07') + 4 * HOUR_MS)
})

test('an evening alone does not reach past midnight', () => {
  const store = seedStore([
    [at('2026-11-07', 9, 0), '早上的事'],
    [at('2026-11-07', 23, 0), '晚上的事'],
  ])
  const window = dayWindow(store, '2026-11-07')
  assert.equal(window.from, at('2026-11-07', 0, 0))
  // 23:00 with a 04:00 ceiling: the cut is capped, so the window still runs to 04:00
  // the next morning only if something actually happened there. Nothing did.
  assert.equal(hasNightTail(store, '2026-11-07'), false)
  store.close()
})

test('work after midnight widens yesterday\'s window, not today\'s', () => {
  const store = seedStore([
    [at('2026-11-07', 22, 0), '还在改面板'],
    [at('2026-11-08', 1, 0), '又发现一个 bug'],
    // 70 minutes later: still the same stretch, so the night is one run.
    [at('2026-11-08', 2, 10), '终于跑通了'],
  ])
  // Yesterday now reaches into the small hours.
  const yesterday = dayWindow(store, '2026-11-07')
  assert.equal(yesterday.cutHour, 0)
  assert.equal(yesterday.nextCutHour, 3)
  assert.equal(yesterday.to, at('2026-11-08', 3, 0))
  // And today starts there, so the same three turns are not counted twice.
  const today = dayWindow(store, '2026-11-08')
  assert.equal(today.from, at('2026-11-08', 3, 0))
  store.close()
})

test('the tail is exactly the part after midnight', () => {
  const store = seedStore([
    [at('2026-11-07', 22, 0), '晚上'],
    [at('2026-11-08', 1, 0), '凌晨一点'],
    [at('2026-11-08', 2, 0), '凌晨两点'],
  ])
  const tail = nightTailOf(store, '2026-11-07')
  assert.equal(tail.count, 2)
  const digest = dayDigest(store, '2026-11-07', { dayclock: {} })
  assert.equal(digest.total, 3)
  assert.equal(digest.tail.count, 2)
  // The 01:00 turn is marked as belonging to the next calendar day, so the writer
  // cannot read it as the start of a fresh morning.
  const items = digest.sessions[0].items
  assert.deepEqual(items.map((item) => item.next === true), [false, true, true])
  // The digest is in clock order, not store order.
  assert.deepEqual(items.map((item) => item.hour), ['22:00', '01:00', '02:00'])
  store.close()
})

test('with no dayclock the digest is still the plain calendar day', () => {
  const store = seedStore([
    [at('2026-11-07', 22, 0), '晚上'],
    [at('2026-11-08', 1, 0), '凌晨一点'],
  ])
  const digest = dayDigest(store, '2026-11-07')
  assert.equal(digest.total, 1)
  assert.equal(digest.window, undefined)
  store.close()
})

test('the previous day is handed back with its page and its last words', () => {
  const store = seedStore([
    [at('2026-11-06', 21, 0), '明天继续弄那个面板'],
    [at('2026-11-06', 23, 0), '先睡了'],
  ])
  store.saveDiary({ day: '2026-11-06', text: '他今天一直在改面板。', origin: 'run-a' })
  const previous = previousMaterial(store, '2026-11-07')
  assert.equal(previous.day, '2026-11-06')
  assert.match(previous.text, /一直在改面板/)
  assert.equal(previous.pageCount, 1)
  // Newest first, so the last thing said is at the top of the section.
  assert.deepEqual(previous.closing.map((item) => item.hour), ['23:00', '21:00'])
  store.close()
})

test('the rendered material names the window and the previous day', () => {
  const store = seedStore([
    [at('2026-11-06', 20, 0), '昨天的事'],
    [at('2026-11-07', 20, 0), '今天的事'],
    [at('2026-11-08', 1, 30), '凌晨的事'],
  ])
  store.saveDiary({ day: '2026-11-06', text: '昨天那篇。', origin: 'run-a' })
  const text = renderDigest(dayDigest(store, '2026-11-07', { dayclock: {} }))
  assert.match(text, /# 2026-11-07 的素材（共 2 条）/)
  assert.match(text, /其中 1 条在午夜之后/)
  assert.match(text, /## 前一天（2026-11-06）/)
  assert.match(text, /昨天那篇。/)
  assert.match(text, /- 次日 01:30 凌晨的事/)
  assert.match(text, /昨天最后说的几句/)
  store.close()
})

test('the tail count is zero for a day nothing happened after midnight', () => {
  const store = seedStore([[at('2026-11-07', 20, 0), '就这一条']])
  assert.deepEqual(nightTailOf(store, '2026-11-07'), {
    from: at('2026-11-08', 0, 0),
    to: at('2026-11-08', 0, 0),
    count: 0,
  })
  store.close()
})

test('the dayclock settings survive a save and a reload', async () => {
  const { mkdtempSync } = await import('node:fs')
  const { tmpdir } = await import('node:os')
  const { join } = await import('node:path')
  const { MemorySettings } = await import('../lib/settings.js')
  const path = join(mkdtempSync(join(tmpdir(), 'deepmemory-dayclock-')), 'settings.json')
  const first = new MemorySettings(path, {})
  assert.deepEqual(first.dayclockConfig(), DEFAULT_DAYCLOCK)
  first.setDayclockConfig({ gapMinutes: 120, latestHour: 6 })
  const second = new MemorySettings(path, {})
  assert.deepEqual(second.dayclockConfig(), { enabled: true, gapMinutes: 120, latestHour: 6 })
  first.close?.()
  second.close?.()
})
