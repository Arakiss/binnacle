// One row per background shell under the status line: what runs and for how long, and for two
// minutes after it ends, how it ended. Running shells first, newest first, then the ones that
// ended, latest first; past three, a count of the rest, so an ended row never hides a running one.

import { t } from '../i18n'
import { RECENT_MS, type ShellRun } from '../model/shells'
import { duration } from './format'
import { cells, cutWords, fitWords, type Line, type Seg, type Tone } from './text'

const ROWS = 3

/** Running shells newest first, then ended ones by when they ended, latest first. */
export function ordered(runs: readonly ShellRun[]): ShellRun[] {
  const endOf = (run: ShellRun) => (run.state === 'ended' ? (run.endedAt ?? run.startedAt) : run.startedAt)
  const running = runs.filter(run => run.state === 'running').sort((a, b) => b.startedAt - a.startedAt)
  const ended = runs.filter(run => run.state === 'ended').sort((a, b) => endOf(b) - endOf(a))
  return [...running, ...ended]
}

/** What a row says after its label, or null when the shell no longer earns one; the clock in `running`. */
function tailOf(run: ShellRun, now: number, running: Tone): Line | null {
  if (run.state === 'running') {
    const time = duration(now - run.startedAt)
    return running === 'dim' ? [{ t: ` · ${time}`, tone: 'dim' }] : [{ t: ' · ', tone: 'dim' }, { t: time, tone: running }]
  }
  if (run.endedAt === null || now - run.endedAt > RECENT_MS) return null
  if (run.code === null) return [{ t: ` · ${t('shell.stopped')}`, tone: 'dim' }]
  return run.code === 0 ? [{ t: ` · ${t('shell.ended')}`, tone: 'good' }] : [{ t: ` · ${t('shell.exit', { code: run.code })}`, tone: 'bad' }]
}

export function signOf(run: ShellRun, running: Tone = 'dim'): Seg {
  if (run.state === 'running') return { t: '⧗ ', tone: running }
  if (run.code === null) return { t: '■ ', tone: 'dim' }
  return run.code === 0 ? { t: '✓ ', tone: 'good' } : { t: '✗ ', tone: 'bad' }
}

/** The label gives way first, cut at a word, so the time or the outcome always shows. */
export function shellRow(run: ShellRun, after: Line, max: number, running: Tone = 'dim'): Line {
  const sign = signOf(run, running)
  const room = max - cells([sign, ...after])
  if (room < 4) return fitWords([sign, { t: run.label }, ...after], max)
  return [sign, { t: cutWords(run.label, room) }, ...after]
}

/**
 * The rows for the shells, none when nothing runs or ended a moment ago. A running shell's sign
 * and clock take `running`: dim in the status line, amber in the band.
 */
export function shellLines(runs: readonly ShellRun[], now: number, max: number, running: Tone = 'dim'): Line[] {
  const shown = ordered(runs).flatMap(run => {
    const after = tailOf(run, now, running)
    return after === null ? [] : [shellRow(run, after, max, running)]
  })
  if (shown.length <= ROWS) return shown
  return [...shown.slice(0, ROWS), [{ t: t('more', { n: shown.length - ROWS }), tone: 'dim' }]]
}
