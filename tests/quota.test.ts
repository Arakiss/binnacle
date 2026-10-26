import { describe, expect, test } from 'claude-code/testing'

import { useLanguage } from '../i18n'
import * as act from '../model/activity'
import { shareOf } from '../model/shared'
import { observed, paceOf, untilFull } from '../model/signals'
import { argsOf, newestReading, pooledHistory, quotaLines, quotaOf, report, windowsOf, type Args, type StateFile } from '../render/quota'
import type { Sample, Shared } from '../types'
import { NOW } from './fixtures'

const MIN = 60_000
const HOUR = 60 * MIN
/** Two hours east of UTC: 12:05 UTC reads 14:05. */
const TZ = 120

/** Ten points an hour over the last hour, the newest reading three minutes old. */
const rising = (from: number): Sample[] => [
  { t: NOW - 63 * MIN, p: from },
  { t: NOW - 33 * MIN, p: from + 5 },
  { t: NOW - 3 * MIN, p: from + 10 },
]

/** A state binnacle writes now: `history` and `limits`. */
const CURRENT: Shared = {
  history: { five_hour: rising(30), seven_day: rising(60) },
  limits: {
    five_hour: { percent: 40, resetsAt: NOW + 2 * HOUR, seenAt: NOW - 3 * MIN },
    seven_day: { percent: 70, resetsAt: NOW + 20 * HOUR, seenAt: NOW - 3 * MIN },
  },
}

/** A state an older binnacle wrote: `history` alone. */
const OLDER: Shared = { history: { five_hour: rising(30), seven_day: rising(60) } }

describe('the last reading of each window', () => {
  const limits = [
    { kind: 'five_hour', percent: 40, resetsAt: NOW + 2 * HOUR },
    { kind: 'seven_day', percent: 70 },
  ]

  test('records the share, the reset time and when it was read', () => {
    expect(observed({}, limits, NOW)).toEqual({
      five_hour: { percent: 40, resetsAt: NOW + 2 * HOUR, seenAt: NOW },
      seven_day: { percent: 70, seenAt: NOW },
    })
  })

  test('keeps its time while the figures stand still, and moves it once a minute', () => {
    const first = observed({}, limits, NOW)
    expect(observed(first, limits, NOW + 30_000)).toBe(first)
    expect(observed(first, limits, NOW + MIN).five_hour?.seenAt).toBe(NOW + MIN)
  })

  test('takes a moved figure at once', () => {
    const first = observed({}, limits, NOW)
    const moved = observed(first, [{ kind: 'five_hour', percent: 41, resetsAt: NOW + 2 * HOUR }], NOW + 5_000)
    expect(moved.five_hour).toEqual({ percent: 41, resetsAt: NOW + 2 * HOUR, seenAt: NOW + 5_000 })
    // The week was not in this report: it keeps its own reading.
    expect(moved.seven_day).toEqual({ percent: 70, seenAt: NOW })
  })

  test('an empty report changes nothing, and a reset time that does not read is left out', () => {
    const first = observed({}, limits, NOW)
    expect(observed(first, [], NOW + HOUR)).toBe(first)
    expect(observed({}, [{ kind: 'five_hour', percent: 5, resetsAt: Number.NaN }], NOW)).toEqual({ five_hour: { percent: 5, seenAt: NOW } })
  })

  test('is written to the state as `limits`, beside `history`, and left out before any', () => {
    const values = { now: NOW, mode: 'full' as const, activity: act.EMPTY, git: null, ci: null, peers: [], loops: 0, history: CURRENT.history ?? {} }
    expect(shareOf({ ...values, readings: CURRENT.limits }).limits).toEqual(CURRENT.limits)
    expect('limits' in shareOf({ ...values, readings: {} })).toBe(false)
    expect('limits' in shareOf(values)).toBe(false)
  })
})

describe('the pace and when a window fills', () => {
  test('the pace is the points gained over the last hour, per hour', () => {
    expect(paceOf(rising(30))).toBe(10)
    expect(paceOf([{ t: NOW, p: 10 }])).toBeNull()
    expect(paceOf([{ t: NOW - 5 * MIN, p: 10 }, { t: NOW, p: 20 }])).toBeNull()
    // untilFull, which the band draws, reads the same pace.
    expect(Math.round(untilFull(rising(30)) ?? 0)).toBe(6 * HOUR)
  })

  test('a window that fills after it resets says so; one that fills before it, too', () => {
    const [five, week] = windowsOf(CURRENT, NOW)
    expect(five).toEqual(expect.objectContaining({ usedPercent: 40, leftPercent: 60, pacePerHour: 10, fullAt: NOW - 3 * MIN + 6 * HOUR, fillsBeforeReset: false }))
    expect(week).toEqual(expect.objectContaining({ usedPercent: 70, leftPercent: 30, pacePerHour: 10, fullAt: NOW - 3 * MIN + 3 * HOUR, fillsBeforeReset: true }))
    expect(week?.fullInMs).toBe(3 * HOUR - 3 * MIN)
  })

  test('readings from before the window started over do not count toward its pace', () => {
    const history = { five_hour: [{ t: NOW - 50 * MIN, p: 90 }, { t: NOW - 40 * MIN, p: 95 }, { t: NOW - 30 * MIN, p: 2 }, { t: NOW - 3 * MIN, p: 6 }] }
    const [five] = windowsOf({ history }, NOW)
    // 2 to 6 in 27 minutes, not 90 to 6 across the reset.
    expect(five?.pacePerHour).toBe(8.9)
  })

  test('a window not rising does not fill; one at 100% is full now', () => {
    const flat = { five_hour: [{ t: NOW - 40 * MIN, p: 40 }, { t: NOW - 3 * MIN, p: 40 }] }
    expect(windowsOf({ history: flat, limits: CURRENT.limits }, NOW)[0]).toEqual(expect.objectContaining({ pacePerHour: 0, fullAt: null, fillsBeforeReset: false }))
    const full = { five_hour: { percent: 100, resetsAt: NOW + HOUR, seenAt: NOW - MIN } }
    expect(windowsOf({ limits: full }, NOW)[0]).toEqual(expect.objectContaining({ leftPercent: 0, fullAt: NOW - MIN, fillsBeforeReset: true }))
  })

  test('once the reset time passes the figures are the old window’s: no pace, no fill', () => {
    const passed = { five_hour: { percent: 80, resetsAt: NOW - 10 * MIN, seenAt: NOW - HOUR } }
    expect(windowsOf({ history: { five_hour: rising(70) }, limits: passed }, NOW)[0]).toEqual(
      expect.objectContaining({ hasReset: true, resetsInMs: 0, pacePerHour: null, fullAt: null, fillsBeforeReset: null }),
    )
  })
})

describe('a state written before `limits`', () => {
  test('reads the share and the time from the newest sample; the reset is unknown', () => {
    const [five, week] = windowsOf(OLDER, NOW)
    expect(five).toEqual({
      kind: 'five_hour',
      usedPercent: 40,
      leftPercent: 60,
      observedAt: NOW - 3 * MIN,
      ageMs: 3 * MIN,
      resetsAt: null,
      resetsInMs: null,
      hasReset: false,
      pacePerHour: 10,
      fullAt: NOW - 3 * MIN + 6 * HOUR,
      fullInMs: 6 * HOUR - 3 * MIN,
      fillsBeforeReset: null,
      source: 'history',
    })
    expect(week?.source).toBe('history')
  })

  test('a reading older than the whole window belongs to a window that ended', () => {
    const stale = { history: { five_hour: [{ t: NOW - 6 * HOUR, p: 50 }] } }
    expect(windowsOf(stale, NOW)[0]).toEqual(expect.objectContaining({ hasReset: true, resetsAt: null }))
  })

  test('an empty history is no reading', () => {
    expect(quotaOf({ history: {} }, 'state/a.json', NOW)).toBeNull()
    expect(quotaOf({}, 'state/a.json', NOW)).toBeNull()
  })
})

describe('the newest reading among the sessions', () => {
  const file = (path: string, mtimeMs: number, shared: Shared | null): StateFile => ({ path, mtimeMs, shared })

  test('the file with the newest reading wins, whatever was written last', () => {
    const fresh = { limits: { five_hour: { percent: 12, seenAt: NOW - MIN } } }
    const files = [file('b.json', NOW, { history: {} }), file('a.json', NOW - HOUR, fresh), file('c.json', NOW - 2 * MIN, OLDER), file('d.json', NOW, null)]
    expect(newestReading(files)?.path).toBe('a.json')
  })

  test('between two readings as new, the one that knows the reset times, then the file written last', () => {
    expect(newestReading([file('a.json', NOW, OLDER), file('b.json', NOW - HOUR, CURRENT)])?.path).toBe('b.json')
    expect(newestReading([file('a.json', NOW - MIN, OLDER), file('b.json', NOW, OLDER)])?.path).toBe('b.json')
  })

  test('the pace pools every session’s readings: a session just started still gets the hour’s', () => {
    const started = { history: { five_hour: [{ t: NOW - MIN, p: 41 }] } }
    const earlier = { history: { five_hour: rising(30) } }
    const files = [file('new.json', NOW, started), file('old.json', NOW - 2 * MIN, earlier), file('bad.json', NOW, null)]
    expect(pooledHistory(files).five_hour).toEqual([...rising(30), { t: NOW - MIN, p: 41 }])
    const out = report({ args: { format: 'json' }, dir: 'state', files, isTTY: false, now: NOW, tz: TZ })
    const q = JSON.parse(out.stdout)
    expect(q.stateFile).toBe('new.json')
    // The hour before the newest sample: 35 to 41 in 32 minutes.
    expect(q.windows[0]).toEqual(expect.objectContaining({ usedPercent: 41, pacePerHour: 11.3 }))
    expect(quotaOf(started, 'new.json', NOW)?.windows[0]?.pacePerHour).toBeNull()
  })

  test('no file with a reading is none', () => {
    expect(newestReading([])).toBeNull()
    expect(newestReading([file('a.json', NOW, { history: {} }), file('b.json', NOW, null)])).toBeNull()
  })
})

describe('the JSON', () => {
  test('is one stable object: these keys, in this order', () => {
    const q = quotaOf(CURRENT, 'state/s1.json', NOW)
    expect(Object.keys(q ?? {})).toEqual(['version', 'now', 'stateFile', 'observedAt', 'ageMs', 'windows'])
    expect(q).toEqual(expect.objectContaining({ version: 1, now: NOW, stateFile: 'state/s1.json', observedAt: NOW - 3 * MIN, ageMs: 3 * MIN }))
    expect(Object.keys(q?.windows[0] ?? {})).toEqual([
      'kind',
      'usedPercent',
      'leftPercent',
      'observedAt',
      'ageMs',
      'resetsAt',
      'resetsInMs',
      'hasReset',
      'pacePerHour',
      'fullAt',
      'fullInMs',
      'fillsBeforeReset',
      'source',
    ])
    expect(q?.windows.map(w => w.kind)).toEqual(['five_hour', 'seven_day'])
  })

  test('orders the five-hour window first, then the week, then the rest by name', () => {
    const limits = Object.fromEntries(['seven_day_sonnet', 'seven_day', 'seven_day_opus', 'five_hour'].map(kind => [kind, { percent: 1, seenAt: NOW }]))
    expect(windowsOf({ limits }, NOW).map(w => w.kind)).toEqual(['five_hour', 'seven_day', 'seven_day_opus', 'seven_day_sonnet'])
  })
})

describe('the words', () => {
  test('in English', () => {
    useLanguage('en')
    const q = quotaOf(CURRENT, 'state/s1.json', NOW)
    expect(q === null ? [] : quotaLines(q, TZ)).toEqual([
      'Claude Code quota · read 3 min ago',
      '  5-hour limit  40% used · 60% left · resets in 2 h, at 16:05',
      '                +10.0 points/h over the last hour · would be full in 5 h 57 min (20:02), after it resets',
      '▲ week          70% used · 30% left · resets in 20 h, tomorrow at 10:05',
      '                +10.0 points/h over the last hour · full in 2 h 57 min (17:02), before it resets',
    ])
  })

  test('in Spanish', () => {
    useLanguage('es')
    const q = quotaOf(CURRENT, 'state/s1.json', NOW)
    expect(q === null ? [] : quotaLines(q, TZ)).toEqual([
      'Cuota de Claude Code · leída hace 3 min',
      '  límite de 5 h  40 % usado · queda el 60 % · se reinicia en 2 h, a las 16:05',
      '                 +10,0 puntos/h en la última hora · se llenaría en 5 h 57 min (20:02), después del reinicio',
      '▲ semana         70 % usado · queda el 30 % · se reinicia en 20 h, mañana a las 10:05',
      '                 +10,0 puntos/h en la última hora · se llena en 2 h 57 min (17:02), antes del reinicio',
    ])
    useLanguage('en')
  })

  test('an older state: the reset unknown, the fill without a verdict', () => {
    useLanguage('es')
    const q = quotaOf(OLDER, 'state/s1.json', NOW)
    expect(q === null ? [] : quotaLines(q, TZ).slice(1, 3)).toEqual([
      '  límite de 5 h  40 % usado · queda el 60 % · no se sabe cuándo se reinicia',
      '                 +10,0 puntos/h en la última hora · a este ritmo se llena en 5 h 57 min (20:02)',
    ])
    useLanguage('en')
  })

  test('a window that reset since the reading says there is no new one yet', () => {
    useLanguage('en')
    const passed = { five_hour: { percent: 80, resetsAt: NOW - 10 * MIN, seenAt: NOW - HOUR } }
    const q = quotaOf({ limits: passed }, 'state/s1.json', NOW)
    expect(q === null ? [] : quotaLines(q, TZ)).toEqual([
      'Claude Code quota · read 1 h ago',
      '  5-hour limit  80% used · 20% left · reset at 13:55',
      '                no reading since: the next reply in a session brings one',
    ])
  })
})
describe('the command', () => {
  const file = (path: string, mtimeMs: number, shared: Shared | null): StateFile => ({ path, mtimeMs, shared })
  const base = { dir: 'state', isTTY: true, now: NOW, tz: TZ }
  const args = (...argv: string[]): Args => {
    const parsed = argsOf(argv)
    if (typeof parsed === 'string') throw new Error(parsed)
    return parsed
  }

  test('reads its arguments, either form, and names a wrong one', () => {
    expect(argsOf([])).toEqual({ format: 'auto' })
    expect(argsOf(['--json', '--state-dir', '/tmp/s', '--lang=es'])).toEqual({ format: 'json', dir: '/tmp/s', lang: 'es' })
    expect(argsOf(['--text', '--state-dir=/tmp/s'])).toEqual({ format: 'text', dir: '/tmp/s' })
    expect(argsOf(['--state-dir'])).toBe('quota: --state-dir needs a value')
    expect(argsOf(['--state-dir', '--json'])).toBe('quota: --state-dir needs a value')
    expect(argsOf(['--frobnicate'])).toBe('quota: unknown argument --frobnicate')
    expect(argsOf(['-h'])).toEqual({ format: 'auto', isHelp: true })
  })

  test('prints JSON when asked or when stdout is no terminal, words on a terminal, and exits 0', () => {
    const files = [file('state/a.json', NOW, OLDER), file('state/b.json', NOW - HOUR, CURRENT)]
    for (const run of [{ ...base, args: args('--json') }, { ...base, isTTY: false, args: args() }]) {
      const out = report({ ...run, files })
      expect(out.code).toBe(0)
      expect(out.stderr).toBe('')
      expect(JSON.parse(out.stdout)).toEqual(quotaOf(CURRENT, 'state/b.json', NOW))
    }
    const words = report({ ...base, isTTY: false, args: args('--text'), files })
    expect(words.stdout.split('\n')[0]).toBe('Claude Code quota · read 3 min ago')
  })

  test('speaks the language asked for, else the environment’s, else the state’s, else English', () => {
    const files = [file('state/b.json', NOW, { ...CURRENT, language: 'es' })]
    const heading = (run: Partial<Parameters<typeof report>[0]>) => report({ ...base, args: args(), files, ...run }).stdout.split('\n')[0]
    expect(heading({})).toBe('Cuota de Claude Code · leída hace 3 min')
    expect(heading({ args: args('--lang', 'en') })).toBe('Claude Code quota · read 3 min ago')
    expect(heading({ files: [file('state/b.json', NOW, CURRENT)], envLanguage: 'es' })).toBe('Cuota de Claude Code · leída hace 3 min')
    expect(heading({ files: [file('state/b.json', NOW, CURRENT)] })).toBe('Claude Code quota · read 3 min ago')
  })

  test('with no state, or none with a reading, exits 1 and says why and what to do', () => {
    useLanguage('en')
    const none = report({ ...base, args: args(), files: null })
    expect(none).toEqual({
      code: 1,
      stdout: '',
      stderr: 'quota: no binnacle state in state. Open a Claude Code session with binnacle loaded, or point --state-dir (or BINNACLE_STATE_DIR) at the folder it writes to.\n',
    })
    expect(report({ ...base, args: args(), files: [] }).code).toBe(1)
    const unread = report({ ...base, args: args('--json', '--lang', 'es'), files: [file('state/a.json', NOW, { history: {} }), file('state/b.json', NOW, null)] })
    expect(unread.code).toBe(1)
    expect(JSON.parse(unread.stdout)).toEqual({
      version: 1,
      error: 'no-reading',
      message: 'hay 2 ficheros de estado en state y ninguno tiene aún lectura de cuota. La trae la primera respuesta de una sesión con suscripción a Claude.',
      stateDir: 'state',
    })
    useLanguage('en')
  })
})
