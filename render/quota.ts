// How much of each Claude Code rate-limit window is left, decided as data from the state binnacle
// writes: what tools/quota.ts prints for a person and the JSON it prints for a script or an agent.
// The quota belongs to the account, not to a session, so the reading comes from whichever session
// read it last, and the pace from every session's readings pooled. Pure: the tool, the tests and
// anything else that reads the state agree.
//
// A state file written by an older binnacle has `history` and no `limits`: the share used and the
// time of the reading come from its newest sample, and when the window resets is unknown.

import { decimal, t, tn, useLanguage } from '../i18n'
import { paceOf } from '../model/signals'
import type { Sample, Shared } from '../types'
import { duration, limitName, shortWhen, when } from './format'

const MINUTE = 60_000
const HOUR = 60 * MINUTE
const DAY = 24 * HOUR

/** How long each window lasts: a reading older than that belongs to a window that has ended. */
const WINDOW_MS: Record<string, number> = { five_hour: 5 * HOUR, seven_day: 7 * DAY, seven_day_opus: 7 * DAY, seven_day_sonnet: 7 * DAY }

/** The JSON's version; a field that changes meaning or goes away bumps it, a new field does not. */
export const QUOTA_VERSION = 1

/**
 * One window, as `--json` prints it. Times are milliseconds since the epoch, durations
 * milliseconds, shares percentages of the window (0 to 100), rounded to one decimal.
 */
export type QuotaWindow = {
  /** The engine's name for the window: `five_hour`, `seven_day`, `seven_day_opus`, … */
  kind: string
  usedPercent: number
  leftPercent: number
  /** When the figures were read, and how long before `now`. */
  observedAt: number
  ageMs: number
  /** When the window resets, and in how long; null when the state does not say. */
  resetsAt: number | null
  resetsInMs: number | null
  /**
   * True when the window has reset since the reading (its reset time passed, or the reading is
   * older than the whole window): the figures are those of the window that ended.
   */
  hasReset: boolean
  /**
   * Points gained per hour over the last hour of readings since the window last started over;
   * null with under ten minutes of them, or once the window has reset since the reading.
   */
  pacePerHour: number | null
  /** When the window would be full at that pace, and in how long; null when it is not filling. */
  fullAt: number | null
  fullInMs: number | null
  /** Whether it would be full before it resets; null when the reset time or the pace is unknown. */
  fillsBeforeReset: boolean | null
  /** Where the figures come from: `limits` (the last reading) or `history` (an older state file). */
  source: 'limits' | 'history'
}

/** What `--json` prints when there is a reading. */
export type Quota = {
  version: number
  now: number
  /** The state file the reading comes from. */
  stateFile: string
  /** The newest reading of any window, and how long before `now`. */
  observedAt: number
  ageMs: number
  windows: QuotaWindow[]
}

/** What `--json` prints, with exit code 1, when there is no reading. */
export type QuotaError = { version: number; error: 'no-state' | 'no-reading'; message: string; stateDir: string }

const round1 = (n: number) => Math.round(n * 10) / 10

/** The five-hour window first, then the week, then any other by name. */
const rank = (kind: string) => (kind === 'five_hour' ? 0 : kind === 'seven_day' ? 1 : 2)

type Raw = { kind: string; percent: number; resetsAt?: number; seenAt: number; source: QuotaWindow['source'] }

/** Each window the state holds a reading of: `limits` first, else the newest sample of `history`. */
function readingsOf(shared: Shared): Raw[] {
  const out = new Map<string, Raw>()
  for (const [kind, samples] of Object.entries(shared.history ?? {})) {
    const last = Array.isArray(samples) ? samples.at(-1) : undefined
    if (last !== undefined && Number.isFinite(last.p) && Number.isFinite(last.t)) out.set(kind, { kind, percent: last.p, seenAt: last.t, source: 'history' })
  }
  for (const [kind, r] of Object.entries(shared.limits ?? {})) {
    if (r === null || typeof r !== 'object' || !Number.isFinite(r.percent) || !Number.isFinite(r.seenAt)) continue
    out.set(kind, { kind, percent: r.percent, ...(Number.isFinite(r.resetsAt) ? { resetsAt: r.resetsAt } : {}), seenAt: r.seenAt, source: 'limits' })
  }
  return [...out.values()].sort((x, y) => rank(x.kind) - rank(y.kind) || x.kind.localeCompare(y.kind))
}

/** When the state's newest reading was taken; null when it holds none. */
export function observedAtOf(shared: Shared): number | null {
  const times = readingsOf(shared).map(r => r.seenAt)
  return times.length === 0 ? null : Math.max(...times)
}

/** The samples of one window since its last reset: a drop means the window started over. */
function sinceReset(samples: readonly Sample[]): Sample[] {
  let start = 0
  for (let i = 1; i < samples.length; i += 1) if ((samples[i]?.p ?? 0) < (samples[i - 1]?.p ?? 0)) start = i
  return samples.slice(start)
}

/**
 * Every window of `shared` with a reading, as of `now`; the pace comes from `history`, by default
 * the state's own, or every session's readings pooled (pooledHistory).
 */
export function windowsOf(shared: Shared, now: number, history: Readonly<Record<string, Sample[]>> = shared.history ?? {}): QuotaWindow[] {
  return readingsOf(shared).map(r => {
    const length = WINDOW_MS[r.kind]
    const resetsAt = r.resetsAt ?? null
    const hasReset = (resetsAt !== null && resetsAt <= now) || (length !== undefined && now - r.seenAt >= length)
    const samples = history[r.kind]
    const pace = hasReset || !Array.isArray(samples) ? null : paceOf(sinceReset(samples))
    const isFull = r.percent >= 100
    const fullAt = hasReset ? null : isFull ? r.seenAt : pace !== null && pace > 0 ? r.seenAt + ((100 - r.percent) / pace) * HOUR : null
    return {
      kind: r.kind,
      usedPercent: round1(r.percent),
      leftPercent: round1(Math.max(0, 100 - r.percent)),
      observedAt: r.seenAt,
      ageMs: Math.max(0, now - r.seenAt),
      resetsAt,
      resetsInMs: resetsAt === null ? null : Math.max(0, resetsAt - now),
      hasReset,
      pacePerHour: pace === null ? null : round1(pace),
      fullAt: fullAt === null ? null : Math.round(fullAt),
      fullInMs: fullAt === null ? null : Math.max(0, Math.round(fullAt - now)),
      fillsBeforeReset: hasReset || resetsAt === null || (pace === null && !isFull) ? null : fullAt !== null && fullAt < resetsAt,
      source: r.source,
    }
  })
}

/** The quota as of `now` from one state file, the pace from `history`; null when the file holds no reading. */
export function quotaOf(shared: Shared, stateFile: string, now: number, history?: Readonly<Record<string, Sample[]>>): Quota | null {
  const observedAt = observedAtOf(shared)
  if (observedAt === null) return null
  return { version: QUOTA_VERSION, now, stateFile, observedAt, ageMs: Math.max(0, now - observedAt), windows: windowsOf(shared, now, history) }
}

/** A state file as read: its path, when it was written, and what it holds (null when it did not parse). */
export type StateFile = { path: string; mtimeMs: number; shared: Shared | null }

/**
 * Every session's samples of each window in one list, oldest first. The quota is the account's, so
 * a session started ten minutes ago still gets the pace the others measured over the hour.
 */
export function pooledHistory(files: readonly StateFile[]): Record<string, Sample[]> {
  const pool: Record<string, Sample[]> = {}
  for (const f of files) {
    for (const [kind, samples] of Object.entries(f.shared?.history ?? {})) {
      if (!Array.isArray(samples)) continue
      const valid = samples.filter(s => s !== null && typeof s === 'object' && Number.isFinite(s.t) && Number.isFinite(s.p))
      pool[kind] = [...(pool[kind] ?? []), ...valid]
    }
  }
  return Object.fromEntries(
    Object.entries(pool).map(([kind, samples]) => [
      kind,
      samples.sort((x, y) => x.t - y.t || x.p - y.p).filter((s, i, all) => i === 0 || s.t !== all[i - 1]?.t || s.p !== all[i - 1]?.p),
    ]),
  )
}

/**
 * The file with the newest reading of any window; between two as new, the one with `limits` (it
 * knows the reset times), then the one written last. Null when no file holds a reading.
 */
export function newestReading(files: readonly StateFile[]): { path: string; shared: Shared } | null {
  const ranked = files.flatMap(f => {
    const at = f.shared === null ? null : observedAtOf(f.shared)
    return f.shared === null || at === null ? [] : [{ path: f.path, shared: f.shared, at, hasLimits: Object.keys(f.shared.limits ?? {}).length > 0, mtimeMs: f.mtimeMs }]
  })
  ranked.sort((x, y) => y.at - x.at || Number(y.hasLimits) - Number(x.hasLimits) || y.mtimeMs - x.mtimeMs)
  const best = ranked[0]
  return best === undefined ? null : { path: best.path, shared: best.shared }
}

/** "8.4", "+8.4": points per hour with the language's decimal mark. */
const points = (pace: number) => `${pace > 0 ? '+' : ''}${decimal(pace)}`

/** One window's words: the share and the reset on one line, the pace and the fill on the next. */
function windowLines(w: QuotaWindow, now: number, tz: number): [string, string] {
  const share = t('quota.share', { used: Math.round(w.usedPercent), left: Math.round(w.leftPercent) })
  const reset = w.hasReset
    ? w.resetsAt === null
      ? t('quota.resetSince')
      : t('quota.resetAt', { when: when(w.resetsAt, now, tz) })
    : w.resetsAt === null
      ? t('quota.resetUnknown')
      : t('quota.resetsIn', { time: duration(w.resetsInMs ?? 0), when: when(w.resetsAt, now, tz) })
  if (w.hasReset) return [`${share} · ${reset}`, t('quota.noFreshReading')]
  const pace = w.pacePerHour === null ? t('quota.paceUnknown') : w.pacePerHour <= 0 ? t('quota.paceFlat') : t('quota.pace', { points: points(w.pacePerHour) })
  const fill =
    w.usedPercent >= 100
      ? t('quota.full')
      : w.fullAt === null
        ? ''
        : t(w.fillsBeforeReset === true ? 'quota.fillsBeforeReset' : w.fillsBeforeReset === false ? 'quota.fillsAfterReset' : 'quota.fills', {
            time: duration(w.fullInMs ?? 0),
            when: shortWhen(w.fullAt, now, tz),
          })
  return [`${share} · ${reset}`, fill === '' ? pace : `${pace} · ${fill}`]
}

/**
 * The quota for a person: a heading with the age of the reading, then two lines per window, the
 * window's name in a column of its own. A window that fills before it resets is marked with ▲.
 */
export function quotaLines(q: Quota, tz: number): string[] {
  const names = q.windows.map(w => limitName(w.kind))
  const width = Math.max(...names.map(n => [...n].length))
  const out = [t('quota.heading', { time: duration(q.ageMs) })]
  q.windows.forEach((w, i) => {
    const [first, second] = windowLines(w, q.now, tz)
    const mark = w.fillsBeforeReset === true || (w.usedPercent >= 100 && !w.hasReset) ? '▲ ' : '  '
    out.push(`${mark}${(names[i] ?? w.kind).padEnd(width)}  ${first}`, `  ${' '.repeat(width)}  ${second}`)
  })
  return out
}

// ── The command ──────────────────────────────────────────────────────────────────────────────

export const USAGE = 'usage: bun tools/quota.ts [--json | --text] [--state-dir DIR] [--lang CODE]'

/** What the command was asked: the format (`auto`: JSON unless stdout is a terminal), the folder, the language. */
export type Args = { format: 'json' | 'text' | 'auto'; dir?: string; lang?: string; isHelp?: true }

/** The arguments, or what is wrong with them. */
export function argsOf(argv: readonly string[]): Args | string {
  const args: Args = { format: 'auto' }
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i] ?? ''
    const cut = arg.indexOf('=')
    const flag = arg.startsWith('--') && cut > 0 ? arg.slice(0, cut) : arg
    if (flag === '--json') args.format = 'json'
    else if (flag === '--text') args.format = 'text'
    else if (flag === '-h' || flag === '--help') args.isHelp = true
    else if (flag === '--state-dir' || flag === '--lang') {
      const value = flag === arg ? argv[++i] : arg.slice(cut + 1)
      if (value === undefined || value === '' || value.startsWith('--')) return `quota: ${flag} needs a value`
      if (flag === '--lang') args.lang = value
      else args.dir = value
    } else return `quota: unknown argument ${arg}`
  }
  return args
}

/** What the command prints and the code it exits with. */
export type Outcome = { code: 0 | 1 | 2; stdout: string; stderr: string }

export type Run = {
  args: Args
  /** The folder read, as the user named it. */
  dir: string
  /** Its state files; null when the folder could not be read. */
  files: readonly StateFile[] | null
  isTTY: boolean
  /** BINNACLE_LANGUAGE, when set. */
  envLanguage?: string
  now: number
  tz: number
}

/**
 * The command's outcome for the state files read: the newest reading as JSON or words, in the
 * language asked for, else the state's own (the plugin's `language` option), else English. Exit 0
 * with a reading; 1, saying why and what to do, without one.
 */
export function report(run: Run): Outcome {
  const isJson = run.args.format === 'json' || (run.args.format === 'auto' && !run.isTTY)
  const found = run.files === null ? null : newestReading(run.files)
  const stateLanguage = found?.shared.language ?? run.files?.find(f => f.shared?.language)?.shared?.language
  useLanguage(run.args.lang || run.envLanguage || stateLanguage || 'en')
  const quota = found === null || run.files === null ? null : quotaOf(found.shared, found.path, run.now, pooledHistory(run.files))
  if (quota === null) {
    const count = run.files?.length ?? 0
    const error: QuotaError =
      count === 0
        ? { version: QUOTA_VERSION, error: 'no-state', message: t('quota.noState', { dir: run.dir }), stateDir: run.dir }
        : { version: QUOTA_VERSION, error: 'no-reading', message: tn('quota.noReading', count, { dir: run.dir }), stateDir: run.dir }
    return isJson ? { code: 1, stdout: `${JSON.stringify(error, null, 2)}\n`, stderr: '' } : { code: 1, stdout: '', stderr: `quota: ${error.message}\n` }
  }
  return { code: 0, stdout: `${isJson ? JSON.stringify(quota, null, 2) : quotaLines(quota, run.tz).join('\n')}\n`, stderr: '' }
}
