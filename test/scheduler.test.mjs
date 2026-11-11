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

import {
  DEFAULT_TIME,
  DEFAULT_ZONE,
  TASK_TITLE,
  deliverOnce,
  ensureTask,
  findTask,
  normalizeTime,
  removeTask,
  repairTask,
  runTaskNow,
  taskPrompt,
  taskStatus,
} from '../lib/scheduler.js'
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
      if (request.patch?.prompt !== undefined) entry.prompt = request.patch.prompt
      if (request.patch?.target !== undefined) entry.target = request.patch.target
      return { ...entry }
    },
    async run(request) {
      calls.push(['run', request])
      const entry = entries.find((item) => item.id === request.id)
      if (entry === undefined) return { id: request.id, code: 'schedule_not_found' }
      return { ...entry }
    },
  }
}

test('the delivered prompt carries no literal date', () => {
  const prompt = taskPrompt()
  // The bug this guards: a date written once would make every later delivery
  // write that same day, and diary_read would then always say "already written".
  assert.doesNotMatch(prompt, /\d{4}-\d{2}-\d{2}/)
  assert.match(prompt, /自己算/)
  assert.match(prompt, /diary_read/)
  assert.match(prompt, /diary_material/)
  assert.match(prompt, /diary_write/)
  assert.match(prompt, /今天没有素材/)
})

test('repairTask rewrites only the prompt of a dated task', async () => {
  const schedule = fakeSchedule([
    {
      id: 'task-old',
      title: TASK_TITLE,
      prompt: '写 2026-11-07 这一天的日记。',
      kind: 'daily',
      time: '23:40:00',
      timeZone: DEFAULT_ZONE,
      status: 'active',
      scheduledAt: '2026-11-09T15:40:00.000Z',
      target: { kind: 'new', create: { cwd: 'somewhere' } },
    },
  ])
  const result = await repairTask(schedule)
  assert.equal(result.repaired, true)
  const request = schedule.calls.at(-1)[1]
  // Only the prompt: retiming or re-targeting here would silently undo a user's
  // own settings whenever the plugin happens to reload.
  assert.deepEqual(Object.keys(request.patch), ['prompt'])
  assert.doesNotMatch(schedule.entries[0].prompt, /2026-11-07/)
  assert.equal(schedule.entries[0].time, '23:40:00')
})

test('repairTask leaves a fresh task alone and reports a missing one', async () => {
  const schedule = fakeSchedule()
  assert.deepEqual(await repairTask(schedule), { repaired: false, reason: 'no-task' })
  await ensureTask(schedule, {})
  const callsBefore = schedule.calls.length
  assert.deepEqual(await repairTask(schedule), { repaired: false, reason: 'fresh' })
  assert.equal(schedule.calls.length, callsBefore)
})

test('repairTask adds the diary preset to a task that predates it', async () => {
  const schedule = fakeSchedule([
    {
      id: 'task-old',
      title: TASK_TITLE,
      prompt: taskPrompt(),
      kind: 'daily',
      time: '23:40:00',
      timeZone: DEFAULT_ZONE,
      status: 'active',
      scheduledAt: '2026-11-09T15:40:00.000Z',
      target: { kind: 'new', create: { cwd: 'C:/Users/me/.dsh/deepmemory/diary' } },
    },
  ])
  const result = await repairTask(schedule, { agentPreset: 'deepmemory-diary' })
  assert.equal(result.repaired, true)
  const request = schedule.calls.at(-1)[1]
  // The prompt is already current, so only the delivery target is touched.
  assert.deepEqual(Object.keys(request.patch), ['target'])
  assert.deepEqual(schedule.entries[0].target.create, {
    cwd: 'C:/Users/me/.dsh/deepmemory/diary',
    agentPreset: 'deepmemory-diary',
  })
  // Second pass: nothing left to do.
  assert.deepEqual(await repairTask(schedule, { agentPreset: 'deepmemory-diary' }), {
    repaired: false,
    reason: 'fresh',
  })
})

test('ensureTask retargets a task whose preset changed', async () => {
  const schedule = fakeSchedule()
  await ensureTask(schedule, { cwd: 'C:/x', agentPreset: 'standard' })
  const before = schedule.calls.length
  await ensureTask(schedule, { cwd: 'C:/x', agentPreset: 'deepmemory-diary' })
  assert.equal(schedule.calls.length, before + 1)
  const request = schedule.calls.at(-1)[1]
  assert.equal(request.patch.target.create.agentPreset, 'deepmemory-diary')
  // Same preset again is a no-op.
  const settled = schedule.calls.length
  await ensureTask(schedule, { cwd: 'C:/x', agentPreset: 'deepmemory-diary' })
  assert.equal(schedule.calls.length, settled)
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
  assert.equal(entry.time, normalizeTime(DEFAULT_TIME))
  assert.equal(entry.timeZone, DEFAULT_ZONE)
  const request = schedule.calls[0][1]
  // The service only accepts HH:mm:ss; the panel sends HH:mm.
  assert.deepEqual(request.timing, { kind: 'daily', daily: { time: normalizeTime(DEFAULT_TIME), time_zone: DEFAULT_ZONE } })
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

test('ensureTask repairs a task still carrying a dated prompt', async () => {
  const schedule = fakeSchedule([
    {
      id: 'task-old',
      title: TASK_TITLE,
      prompt: '写 2026-11-07 这一天的日记。',
      kind: 'daily',
      time: normalizeTime(DEFAULT_TIME),
      timeZone: DEFAULT_ZONE,
      status: 'active',
      scheduledAt: '2026-11-09T15:40:00.000Z',
    },
  ])
  await ensureTask(schedule, {})
  assert.equal(schedule.calls.at(-1)[0], 'edit')
  assert.doesNotMatch(schedule.entries[0].prompt, /2026-11-07/)
})

test('ensureTask retimes instead of creating a second task', async () => {
  const schedule = fakeSchedule()
  await ensureTask(schedule, { time: '23:40' })
  await ensureTask(schedule, { time: '21:15' })
  assert.equal(schedule.entries.length, 1)
  assert.equal(schedule.entries[0].time, '21:15:00')
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

test('runTaskNow delivers without touching the schedule', async () => {
  const schedule = fakeSchedule()
  assert.deepEqual(await runTaskNow(schedule), { ran: false, reason: 'no-task' })
  await ensureTask(schedule, { time: '21:15' })
  assert.deepEqual(await runTaskNow(schedule), { ran: true })
  assert.equal(schedule.entries[0].time, '21:15:00')
  assert.equal(schedule.entries[0].status, 'active')
})

test('deliverOnce creates a one-shot aimed at its own day', async () => {
  const schedule = fakeSchedule()
  const result = await deliverOnce(schedule, { title: '深度记忆 · 补写 2026-11-02', prompt: '写 2026-11-02', cwd: 'C:/d' })
  assert.equal(result.created, true)
  const [kind, request] = schedule.calls[0]
  assert.equal(kind, 'create')
  assert.equal(request.timing.kind, 'after')
  assert.equal(request.target.kind, 'new')
  assert.match(request.title, /2026-11-02/)
})

test('taskStatus reports the schedule the panel renders', async () => {
  const schedule = fakeSchedule()
  assert.deepEqual(await taskStatus(schedule), { scheduled: false })
  await ensureTask(schedule, { time: '21:15' })
  const status = await taskStatus(schedule)
  assert.equal(status.scheduled, true)
  assert.equal(status.time, '21:15:00')
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
