// Numbers as a person reads them, in the active language. Pure: the caller passes the clock and
// the local offset from UTC (minutes), so the status line, the pane and the tests agree.

import { decimal, t } from '../i18n'

const MINUTE = 60_000
const HOUR = 60 * MINUTE
const DAY = 24 * HOUR

const WEEKDAYS = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'] as const

/** The name of the weekday `index` (0 is Sunday), whole or short. */
export function weekday(index: number, isShort = false): string {
  const day = WEEKDAYS[index] ?? 'sunday'
  return t(isShort ? `day.short.${day}` : `day.${day}`)
}

/** "40 s", "3 min", "2 h 10 min", "1 d 4 h". */
export function duration(ms: number): string {
  const s = Math.max(0, Math.round(ms / 1000))
  if (s < 60) return t('duration.seconds', { s })
  const minutes = Math.round(s / 60)
  if (minutes < 60) return t('duration.minutes', { m: minutes })
  const d = Math.floor(minutes / 1440)
  const h = Math.floor((minutes % 1440) / 60)
  const m = minutes % 60
  if (d > 0) return h > 0 ? t('duration.daysHours', { d, h }) : t('duration.days', { d })
  return m > 0 ? t('duration.hoursMinutes', { h, m }) : t('duration.hours', { h })
}

/** A tool's run time: "40 ms", "1.2 s", "12 s", "3 min". */
export function runTime(ms: number): string {
  if (ms < 1000) return t('duration.milliseconds', { ms: Math.max(0, Math.round(ms)) })
  if (ms < 10_000) return t('duration.seconds', { s: decimal(Math.max(0, ms) / 1000) })
  return duration(ms)
}

const local = (ms: number, tz: number) => new Date(ms + tz * MINUTE)
const two = (n: number) => String(n).padStart(2, '0')

/** "14:20". */
export function clock(ms: number, tz: number): string {
  const d = local(ms, tz)
  return `${two(d.getUTCHours())}:${two(d.getUTCMinutes())}`
}

/** "14:20:05". */
export function clockSeconds(ms: number, tz: number): string {
  return `${clock(ms, tz)}:${two(local(ms, tz).getUTCSeconds())}`
}

const dayNumber = (ms: number, tz: number) => Math.floor((ms + tz * MINUTE) / DAY)

/** "at 14:20", "tomorrow at 09:00", "on Thursday at 09:00". */
export function when(ms: number, now: number, tz: number): string {
  const days = dayNumber(ms, tz) - dayNumber(now, tz)
  const time = clock(ms, tz)
  if (days <= 0) return t('when.today', { time })
  if (days === 1) return t('when.tomorrow', { time })
  return t('when.weekday', { day: weekday(local(ms, tz).getUTCDay()), time })
}

/** "14:20", "tomorrow 09:00", "Thu 09:00": `when` for a status line. */
export function shortWhen(ms: number, now: number, tz: number): string {
  const days = dayNumber(ms, tz) - dayNumber(now, tz)
  const time = clock(ms, tz)
  if (days <= 0) return time
  if (days === 1) return t('when.short.tomorrow', { time })
  return t('when.short.weekday', { day: weekday(local(ms, tz).getUTCDay(), true), time })
}

/** "340k", "1M", "1.2M". */
export function tokens(n: number): string {
  if (n >= 1e6) {
    const m = n / 1e6
    return `${Number.isInteger(Math.round(m * 10) / 10) ? Math.round(m) : decimal(m)}M`
  }
  if (n >= 1000) return `${Math.round(n / 1000)}k`
  return String(n)
}

export const percent = (p: number) => `${Math.round(p)}%`

export function dollars(usd: number): string {
  return t('money.dollars', { usd: decimal(usd, 2) })
}

const LIMITS = ['five_hour', 'seven_day', 'seven_day_opus', 'seven_day_sonnet', 'spend_limit'] as const

/** What a rate-limit window is called. */
export function limitName(kind: string): string {
  return (LIMITS as readonly string[]).includes(kind) ? t(`limit.${kind}`) : kind.replace(/_/g, ' ')
}

/** "Opus 5.5" from "claude-opus-5-5"; the fallback when the id is not Claude's. */
export function prettyModel(id: string, fallback = id): string {
  const match = /claude-([a-z]+)-(\d+)(?:-(\d{1,2})(?!\d))?/.exec(id)
  const [, family, major, minor] = match ?? []
  if (family === undefined || major === undefined) return fallback || id
  return `${family.charAt(0).toUpperCase()}${family.slice(1)} ${major}${minor ? `.${minor}` : ''}`
}

/** The first line of a text, its whitespace collapsed. */
export function firstLine(text: string): string {
  return (text.split('\n').find(line => line.trim() !== '') ?? '').replace(/\s+/g, ' ').trim()
}
