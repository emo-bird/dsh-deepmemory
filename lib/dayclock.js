/**
 * Where one day of the diary ends.
 *
 * A calendar day ends at midnight; the day a person actually lived does not. Work
 * that runs past midnight — and here it usually does — belongs to the evening it
 * started from. Bucketing those hours into tomorrow is what made the page for the
 * 14th read like two unrelated days stapled together: 「三点出头……中间隔了大半天……
 * 十三点二十二分」.
 *
 * So the boundary is learned from the timestamps instead of being assumed: look at
 * the small hours of the next calendar day, follow the unbroken run of activity
 * that starts just after midnight, and cut where that run stops. A night that ends
 * at 03:12 yields a cut at 04:00; a night that runs to 05:30 yields 06:00.
 *
 * Nothing is stored. The cut is recomputed from the episodes on every read, so a
 * cut learned tomorrow retroactively re-buckets the hours of yesterday — which is
 * exactly what a 「夜尾巴」 rewrite needs.
 *
 * @module @emo-bird/dsh-deepmemory/dayclock
 */

export const HOUR_MS = 3_600_000
export const DAY_MS = 86_400_000

/**
 * `enabled: false` restores the plain calendar day.
 *
 * `gapMinutes` is what "the same night" means: activity with no longer pause
 * belongs to one run. 90 minutes separates 「去睡了」 from 「半夜起来看了一眼」.
 *
 * `latestHour` is the ceiling: no matter how long the night ran, a day never ends
 * later than this, so one very long night cannot swallow the morning after it.
 */
export const DEFAULT_DAYCLOCK = { enabled: true, gapMinutes: 90, latestHour: 4 }

/** Clamp a stored or patched config into something the arithmetic can trust. */
export function normalizeDayclock(patch = {}, base = DEFAULT_DAYCLOCK) {
  const merged = { ...DEFAULT_DAYCLOCK, ...(base ?? {}), ...(patch ?? {}) }
  const gap = Number(merged.gapMinutes)
  const latest = Number(merged.latestHour)
  return {
    enabled: merged.enabled !== false,
    // Under half an hour would split one night into several runs; past six hours
    // would merge the evening with the following morning.
    gapMinutes: Number.isFinite(gap) ? Math.max(30, Math.min(360, Math.round(gap))) : DEFAULT_DAYCLOCK.gapMinutes,
    // 0 would mean "no night at all"; 12 would let a day run until noon.
    latestHour: Number.isFinite(latest) ? Math.max(1, Math.min(12, Math.round(latest))) : DEFAULT_DAYCLOCK.latestHour,
  }
}

const pad = (value) => String(value).padStart(2, '0')

/** Local calendar day of an instant, as `YYYY-MM-DD`. */
export function dayKeyOf(date) {
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`
}

/** Midnight (local) of a `YYYY-MM-DD` key, in milliseconds. */
export function startOfDayMs(day) {
  const [y, m, d] = String(day).split('-').map(Number)
  return new Date(y, m - 1, d, 0, 0, 0, 0).getTime()
}

/** The day key after `day`. Noon is used so a DST shift cannot move the date. */
export function nextDay(day) {
  const stamp = new Date(startOfDayMs(day))
  return dayKeyOf(new Date(stamp.getFullYear(), stamp.getMonth(), stamp.getDate() + 1, 12, 0, 0, 0))
}

/** The day key before `day`. */
export function previousDay(day) {
  const stamp = new Date(startOfDayMs(day))
  return dayKeyOf(new Date(stamp.getFullYear(), stamp.getMonth(), stamp.getDate() - 1, 12, 0, 0, 0))
}

/**
 * Which day a moment belongs to, once the cut is known.
 *
 * `cutHour` is this day's own cut: a moment before it still belongs to the day
 * before. `undefined` means the plain calendar day.
 */
export function dayOfMoment(ms, cutHour = 0) {
  const hour = Number(cutHour) || 0
  const shifted = new Date(ms - hour * HOUR_MS)
  return dayKeyOf(shifted)
}

/**
 * How far into `day` the night that started on `day - 1` ran.
 *
 * `stamps` are the instants recorded during `day`'s small hours. The run is
 * followed from its first episode for as long as the pauses stay under the gap
 * threshold, and the cut is rounded up to a whole hour — a window edge on a half
 * hour reads as an accident, and hour edges match how times are displayed.
 *
 * @param {number[]} stamps milliseconds, any order
 * @param {{gapMinutes?: number, latestHour?: number, enabled?: boolean}} [options]
 * @returns {number} 0 when the day has no night activity, else 1..latestHour
 */
export function cutHourOf(stamps, options = {}) {
  const config = normalizeDayclock(options)
  if (!config.enabled) return 0
  const times = stamps.filter((stamp) => Number.isFinite(stamp)).sort((a, b) => a - b)
  if (times.length === 0) return 0
  const gapMs = config.gapMinutes * 60_000
  let last = times[0]
  for (let index = 1; index < times.length; index += 1) {
    if (times[index] - last > gapMs) break
    last = times[index]
  }
  // Where the run stopped, rounded up to the next whole hour: a window edge at
  // 04:00 is readable, one at 03:47 is not. Half an hour of slack keeps a run
  // that ended at 03:12 from cutting at 03:00 and orphaning its own tail.
  const end = new Date(last)
  const endHour = end.getHours() + end.getMinutes() / 60
  return Math.min(config.latestHour, Math.max(1, Math.ceil(endHour + 0.5)))
}

/**
 * The window an episode of `day` falls into, `[from, to)` in milliseconds.
 *
 * `cutOfOwnDay` moves the start: hours before it still belong to the day before.
 * `cutOfNextDay` moves the end: those hours of tomorrow still belong to this day.
 */
export function windowOf(day, cutOfOwnDay = 0, cutOfNextDay = 0) {
  const from = startOfDayMs(day) + (Number(cutOfOwnDay) || 0) * HOUR_MS
  const to = startOfDayMs(nextDay(day)) + (Number(cutOfNextDay) || 0) * HOUR_MS
  return { from, to }
}

/** The small hours of `day`, where the cut for the day before is decided. */
export function nightWindowOf(day, options = {}) {
  const config = normalizeDayclock(options)
  const from = startOfDayMs(day)
  return { from, to: from + config.latestHour * HOUR_MS }
}

/** `HH:MM` of an instant, for the digest's timestamps. */
export function clockOf(ms) {
  const date = new Date(ms)
  return `${pad(date.getHours())}:${pad(date.getMinutes())}`
}
