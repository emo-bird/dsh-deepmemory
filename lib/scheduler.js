/**
 * Daily diary scheduling.
 *
 * One scheduled task per Host, created through the schedule service rather than
 * by this bundle: the service owns recurrence math, missed-occurrence handling
 * and durable delivery, and re-implementing any of that here would drift.
 *
 * The delivered prompt is built at delivery time by the session that receives
 * it, not here — the task only carries the instruction plus the day it covers.
 * A day with no material produces no diary page (see diary.js), so a quiet day
 * does not leave an empty entry behind.
 *
 * @module @emo-bird/dsh-deepmemory/scheduler
 */

import { composeInstruction, localDay, previousDay } from './diary.js'

export const TASK_TITLE = '深度记忆 · 写日记'
export const DEFAULT_TIME = '23:40'
export const DEFAULT_ZONE = 'Asia/Shanghai'

/**
 * Which day a delivery at `time` is writing about.
 *
 * A page is written in the evening *about that same day*. A delivery shortly
 * after midnight is treated as closing out yesterday, which is what a "00:10"
 * schedule is really asking for.
 */
export function targetDayFor(time = DEFAULT_TIME) {
  const hour = Number(String(time).split(':')[0])
  return Number.isFinite(hour) && hour < 4 ? previousDay() : localDay()
}

/** The instruction delivered into the scheduled session. */
export function taskPrompt(day) {
  return [
    composeInstruction(day),
    '',
    '---',
    `先用 memory_search 或 diary_read 确认 ${day} 是否已有日记；已经有就跳过，不要重写。`,
    '素材从记忆里取：调用 memory_search 查当天的片段，或用 memory_recall 看概览。',
    '没有素材说明那天没人跟你说话，直接回复「今天没有素材，不写日记」，不要调用 diary_write。',
  ].join('\n')
}

/**
 * Read the diary task out of the schedule catalog.
 *
 * Identity is the title, because this bundle has nowhere else to persist an id:
 * the catalog is the durable record and a title match is stable enough for a
 * single task that the panel only ever creates or deletes by name.
 */
export async function findTask(schedule) {
  if (schedule === undefined || schedule === null) return undefined
  const catalog = await schedule.catalog()
  return catalog.find((entry) => entry.title === TASK_TITLE)
}

/**
 * Create or retime the diary task. Returns the stored entry.
 *
 * `cwd` and `agentPreset` are carried into the created session so the diary is
 * written by the same agent the user configured, in a stable directory — not in
 * whatever workspace happened to be current.
 */
export async function ensureTask(schedule, options) {
  const { time = DEFAULT_TIME, zone = DEFAULT_ZONE, cwd, agentPreset } = options
  const existing = await findTask(schedule)
  const timing = { kind: 'daily', daily: { time, time_zone: zone } }
  const target = {
    kind: 'new',
    create: {
      ...(cwd === undefined ? {} : { cwd }),
      ...(agentPreset === undefined ? {} : { agentPreset }),
    },
  }
  if (existing !== undefined) {
    if (existing.kind === 'daily' && existing.time === time && existing.timeZone === zone) return existing
    const result = await schedule.edit({
      id: existing.id,
      action: 'update',
      patch: { timing, target, prompt: taskPrompt(localDay()), active: true },
    })
    return result
  }
  return schedule.create({ title: TASK_TITLE, prompt: taskPrompt(localDay()), timing, target })
}

/** Remove the diary task, if it exists. */
export async function removeTask(schedule) {
  const existing = await findTask(schedule)
  if (existing === undefined) return { deleted: false }
  await schedule.edit({ id: existing.id, action: 'delete' })
  return { deleted: true }
}

/** Panel-facing status: whether the task exists and when it next runs. */
export async function taskStatus(schedule) {
  const existing = await findTask(schedule)
  if (existing === undefined) return { scheduled: false }
  return {
    scheduled: true,
    id: existing.id,
    status: existing.status,
    time: existing.kind === 'daily' ? existing.time : undefined,
    zone: existing.kind === 'daily' ? existing.timeZone : undefined,
    nextAt: existing.scheduledAt,
  }
}
