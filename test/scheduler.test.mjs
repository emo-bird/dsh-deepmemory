/**
 * Scheduler and embedder-install plumbing, without touching a real Host.
 *
 * The schedule service is replaced by a small in-memory fake that records what
 * was asked of it: the point is not to re-test the Host's recurrence engine, but
 * to pin *which* request this bundle makes and that a repeat call retimes rather
 * than duplicating the task.
 */

import assert from 'node:assert/strict'
import { test } from 'node:test'
import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { DEFAULT_TIME, DEFAULT_ZONE, TASK_TITLE, ensureTask, findTask, removeTask, targetDayFor, taskPrompt, taskStatus } from '../lib/scheduler.js'
import { installState } from '../lib/embed.js'

function fakeSchedule(seed = []) {
  const entries = seed.map((entry) => ({ ...entry }))
  const calls = []
  return {
    entries,
    calls,
    async catalog() {
      return entries.map((entry) => ({ ...entry }))
    },
    async create(request) {
      calls.push(['create', request])
      const entry = {
        id: `task-${entries.length + 1}`,
        title: request.title,
        prompt: request.prompt,
        kind: request.timing.kind,
        time: request.timing.daily?.time,
        timeZone: request.timing.daily?.time_zone,
        status: 'active',
        scheduledAt: '2026-11-09T15:40:00.000Z',
        target: request.target,
      }
      entries.push(entry)
      return entry
    },
    async edit(request) {
      calls.push(['edit', request])
      const entry = entries.find((item) => item.id === request.id)
      if (entry === undefined) return { code: 'schedule_not_found' }
      if (request.action === 'delete') {
        entries.splice(entries.indexOf(entry), 1)
        return { deleted: true }
      }
      if (request.patch?.timing?.daily !== undefined) {
        entry.time = request.patch.timing.daily.time
        entry.timeZone = request.patch.timing.daily.time_zone
      }
      return { ...entry }
    },
  }
}

test('targetDayFor reads a late-evening schedule as the same day', () => {
  assert.equal(targetDayFor('23:40'), targetDayFor(DEFAULT_TIME))
  const day = targetDayFor('23:40')
  assert.match(day, /^\d{4}-\d{2}-\d{2}$/)
})

test('targetDayFor reads an after-midnight schedule as the day that just ended', () => {
  // previousDay() is local-time based; compare against the same contract.
  const early = targetDayFor('00:10')
  const late = targetDayFor('23:40')
  assert.notEqual(early, late)
})

test('the delivered prompt names the day and forbids rewriting an existing page', () => {
  const prompt = taskPrompt('2026-11-07')
  assert.match(prompt, /2026-11-07/)
  assert.match(prompt, /diary_read/)
  assert.match(prompt, /不要重写|跳过/)
  assert.match(prompt, /diary_write/)
  // The no-material escape hatch has to be explicit, or the agent invents a day.
  assert.match(prompt, /今天没有素材/)
})

test('findTask matches by title and stays undefined when absent', async () => {
  const schedule = fakeSchedule()
  assert.equal(await findTask(schedule), undefined)
  await ensureTask(schedule, {})
  assert.equal((await findTask(schedule)).title, TASK_TITLE)
})

test('ensureTask creates one daily task at the default time and zone', async () => {
  const schedule = fakeSchedule()
  await ensureTask(schedule, {})
  assert.equal(schedule.entries.length, 1)
  const entry = schedule.entries[0]
  assert.equal(entry.title, TASK_TITLE)
  assert.equal(entry.kind, 'daily')
  assert.equal(entry.time, DEFAULT_TIME)
  assert.equal(entry.timeZone, DEFAULT_ZONE)
  const request = schedule.calls[0][1]
  assert.deepEqual(request.timing, { kind: 'daily', daily: { time: DEFAULT_TIME, time_zone: DEFAULT_ZONE } })
  // A new session per delivery, so the diary is not written into a chat.
  assert.equal(request.target.kind, 'new')
})

test('ensureTask is idempotent: a second call with the same time changes nothing', async () => {
  const schedule = fakeSchedule()
  await ensureTask(schedule, {})
  const before = schedule.entries.length
  await ensureTask(schedule, {})
  assert.equal(schedule.entries.length, before)
  assert.equal(schedule.calls.length, 1)
})

test('ensureTask retimes instead of creating a second task', async () => {
  const schedule = fakeSchedule()
  await ensureTask(schedule, { time: '23:40' })
  await ensureTask(schedule, { time: '21:15' })
  assert.equal(schedule.entries.length, 1)
  assert.equal(schedule.entries[0].time, '21:15')
  assert.equal(schedule.calls.at(-1)[0], 'edit')
})

test('ensureTask carries cwd and agentPreset into the created session', async () => {
  const schedule = fakeSchedule()
  await ensureTask(schedule, { cwd: 'C:/Project', agentPreset: 'xiaofeiyu' })
  assert.deepEqual(schedule.calls[0][1].target.create, { cwd: 'C:/Project', agentPreset: 'xiaofeiyu' })
})

test('removeTask deletes the task and reports when there was none', async () => {
  const schedule = fakeSchedule()
  assert.deepEqual(await removeTask(schedule), { deleted: false })
  await ensureTask(schedule, {})
  assert.deepEqual(await removeTask(schedule), { deleted: true })
  assert.equal(schedule.entries.length, 0)
})

test('taskStatus reports the schedule the panel renders', async () => {
  const schedule = fakeSchedule()
  assert.deepEqual(await taskStatus(schedule), { scheduled: false })
  await ensureTask(schedule, { time: '21:15' })
  const status = await taskStatus(schedule)
  assert.equal(status.scheduled, true)
  assert.equal(status.time, '21:15')
  assert.equal(status.status, 'active')
})

test('installState treats a missing vendor directory as not installed', () => {
  const root = mkdtempSync(join(tmpdir(), 'deepmemory-embed-'))
  const state = installState(root)
  assert.equal(state.installed, false)
  assert.deepEqual(state.models, [])
})

test('installState finds a vendored dependency and downloaded models', () => {
  const root = mkdtempSync(join(tmpdir(), 'deepmemory-embed-'))
  const packageDir = join(root, 'vendor', 'node_modules', '@huggingface', 'transformers')
  mkdirSync(join(packageDir, 'dist'), { recursive: true })
  writeFileSync(
    join(packageDir, 'package.json'),
    '{"name":"@huggingface/transformers","exports":{"node":{"import":{"default":"./dist/transformers.node.mjs"}}}}\n',
    'utf8',
  )
  writeFileSync(join(packageDir, 'dist', 'transformers.node.mjs'), 'export const pipeline = () => {}\n', 'utf8')
  const models = join(root, 'vendor', 'models')
  mkdirSync(models, { recursive: true })
  writeFileSync(join(models, 'model.onnx'), 'x', 'utf8')
  const state = installState(root)
  assert.equal(state.installed, true)
  assert.deepEqual(state.models, ['model.onnx'])
})

test('installState does not count a package whose entry file is missing', () => {
  // An interrupted npm run leaves the manifest but not the file it points at;
  // treating that as installed would advertise tier 3 and then fail every query.
  const root = mkdtempSync(join(tmpdir(), 'deepmemory-embed-'))
  const packageDir = join(root, 'vendor', 'node_modules', '@huggingface', 'transformers')
  mkdirSync(packageDir, { recursive: true })
  writeFileSync(
    join(packageDir, 'package.json'),
    '{"name":"@huggingface/transformers","exports":{"node":{"import":{"default":"./dist/transformers.node.mjs"}}}}\n',
    'utf8',
  )
  assert.equal(installState(root).installed, false)
})
