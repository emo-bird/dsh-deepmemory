/**
 * Daily diary scheduling.
 *
 * One scheduled task per Host, created through the schedule service rather than
 * by this bundle: the service owns recurrence math, missed-occurrence handling
 * and durable delivery, and re-implementing any of that here would drift.
 *
 * The task prompt carries no date. It is written once and replayed by the Host
 * every evening, so a literal day inside it would pin every future delivery to
 * the day the task was created — and since `diary_read` would then always report
 * "already written", the diary would silently stop. The day is derived at
 * delivery time by the receiving session, from the clock.
 *
 * A day with no material produces no page (see diary.js), so a quiet day does
 * not leave an empty entry behind.
 *
 * @module @emo-bird/dsh-deepmemory/scheduler
 */

import { BACKFILL_DAYS, composeInstruction, DAY_CUTOFF_HOUR } from './diary.js'

export const TASK_TITLE = '深度记忆 · 写日记'
export const DEFAULT_TIME = '23:40'
export const DEFAULT_ZONE = 'Asia/Shanghai'

/** The instruction delivered into the scheduled session. Date-free on purpose. */
export function taskPrompt() {
  return [
    composeInstruction(),
    '',
    '---',
    '这段提示是每天固定投递的，里面没有日期，日期要你按投递时刻自己算。',
    '先调用 diary_read（不传参数）看已有记录，再按需要逐日调用 diary_material；目标日已有日记就跳过，不要重写。',
    '`diary_material` 返回 total 为 0，说明那天没人跟你说话：直接回复「今天没有素材，不写日记」，不要调用 diary_write。',
    `补写窗口是最近 ${BACKFILL_DAYS} 天，只补有素材却没有日记的日子。`,
    `日界是 ${String(DAY_CUTOFF_HOUR).padStart(2, '0')}:00：在此之前投递算「昨天」，之后算「今天」。`,
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

/** A phrase only the current (date-free) prompt contains, used to spot stale tasks. */
const PROMPT_MARK = '这段提示是每天固定投递的'

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
    const sameTime = existing.kind === 'daily' && normalizeTime(existing.time) === wanted && existing.timeZone === zone
    // An older build baked the creation date into the stored prompt; rewriting it
    // is the repair for a task that would otherwise keep writing that one day.
    const freshPrompt = typeof existing.prompt === 'string' && existing.prompt.includes(PROMPT_MARK)
    if (sameTime && freshPrompt) return existing
    const result = await schedule.edit({
      id: existing.id,
      action: 'update',
      patch: { timing, target, prompt: taskPrompt(), active: true },
    })
    return result
  }
  return schedule.create({ title: TASK_TITLE, prompt: taskPrompt(), timing, target })
}

/**
 * Rewrite the stored prompt of an existing task when it still carries a date.
 *
 * A task created by an older build keeps its baked-in day forever, and every
 * delivery then writes that one day and skips — the diary looks alive while it
 * is frozen. Repairing on activation is what makes the fix reach a task the user
 * never re-enables. Only the prompt is touched: timing, target and the pending
 * occurrence stay exactly as they are.
 *
 * @returns {Promise<{repaired: boolean, reason?: string}>}
 */
export async function repairTask(schedule) {
  if (schedule === undefined || schedule === null) return { repaired: false, reason: 'no-schedule-service' }
  const existing = await findTask(schedule)
  if (existing === undefined) return { repaired: false, reason: 'no-task' }
  if (typeof existing.prompt === 'string' && existing.prompt.includes(PROMPT_MARK)) {
    return { repaired: false, reason: 'fresh' }
  }
  await schedule.edit({ id: existing.id, action: 'update', patch: { prompt: taskPrompt() } })
  return { repaired: true }
}

/** Remove the diary task, if it exists. */
export async function removeTask(schedule) {
  const existing = await findTask(schedule)
  if (existing === undefined) return { deleted: false }
  await schedule.edit({ id: existing.id, action: 'delete' })
  return { deleted: true }
}

/**
 * Deliver the diary task once, now, without touching its schedule.
 *
 * This is what the panel's 补写 button asks for: the task prompt already carries
 * the backfill instruction, so a manual delivery is exactly "look at the last
 * week and write what is missing". `schedule.run` explicitly does not consume or
 * move the pending occurrence.
 *
 * @returns {Promise<{ran: boolean, reason?: string}>}
 */
export async function runTaskNow(schedule) {
  if (schedule === undefined || schedule === null) return { ran: false, reason: 'no-schedule-service' }
  const existing = await findTask(schedule)
  if (existing === undefined) return { ran: false, reason: 'no-task' }
  const result = await schedule.run({ id: existing.id })
  if (result !== null && typeof result === 'object' && 'code' in result) {
    return { ran: false, reason: String(result.code) }
  }
  return { ran: true }
}

/**
 * Deliver a one-off prompt into a fresh session, right away.
 *
 * Used by the 补写 button: the user picked a day the schedule never wrote, so a
 * task with its own date is created — the recurring task must stay date-free, and
 * a one-shot is the documented way to ask for a delivery about one specific day.
 * The 2 second delay is the service's minimum useful spacing; `after` is the only
 * timing kind that means "as soon as possible" without reserving a Session.
 */
export async function deliverOnce(schedule, { title, prompt, cwd, agentPreset }) {
  if (schedule === undefined || schedule === null) return { created: false, reason: 'no-schedule-service' }
  const entry = await schedule.create({
    title,
    prompt,
    timing: { kind: 'after', after_seconds: 2 },
    target: {
      kind: 'new',
      create: {
        ...(cwd === undefined ? {} : { cwd }),
        ...(agentPreset === undefined ? {} : { agentPreset }),
      },
    },
  })
  return { created: true, id: entry?.id ?? null }
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
