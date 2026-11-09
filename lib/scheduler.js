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
    '素材不在正文里，用 `diary_material` 取（它已经按「计入日记」开关筛过一遍）。',
    `先用 diary_read 确认 ${day} 是否已有日记；已经有就跳过，不要重写。`,
    '`diary_material` 返回 total 为 0，说明那天没人跟你说话：直接回复「今天没有素材，不写日记」，不要调用 diary_write。',
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
/**
 * The schedule service only accepts `HH:mm:ss`. The panel hands us `HH:mm`
 * because that is what `<input type="time">` produces, and passing it straight
 * through fails with `daily.time must use HH:mm:ss`.
 */
export function normalizeTime(time = DEFAULT_TIME) {
  const text = String(time).trim()
  if (/^\d{1,2}:\d{2}$/.test(text)) {
    const [hh, mm] = text.split(':')
    return `${String(Number(hh)).padStart(2, '0')}:${mm}:00`
  }
  return text
}

export async function ensureTask(schedule, options) {
  const { time = DEFAULT_TIME, zone = DEFAULT_ZONE, cwd, agentPreset } = options
  const existing = await findTask(schedule)
  const wanted = normalizeTime(time)
  const timing = { kind: 'daily', daily: { time: wanted, time_zone: zone } }
  const target = {
    kind: 'new',
    create: {
      ...(cwd === undefined ? {} : { cwd }),
      ...(agentPreset === undefined ? {} : { agentPreset }),
    },
  }
  if (existing !== undefined) {
    if (existing.kind === 'daily' && normalizeTime(existing.time) === wanted && existing.timeZone === zone) return existing
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
