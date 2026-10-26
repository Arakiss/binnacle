import { describe, expect, test } from 'claude-code/testing'

import { exitOf, isOutputPath, labelOf, outputPathOf, runOf, shellAdded, shellFrom, SHELLS_MAX, shellStopped, tailStart, type ShellRun } from '../model/shells'
import { shellLines } from '../render/shells'
import { statusLines } from '../render/status'
import { cells, paint, plainText } from '../render/text'
import type { Shell } from '../types'
import { IDLE, NOW, STATUS, TZ } from './fixtures'

const MIN = 60_000
const PATH = '/private/tmp/claude-501/-repo/session/tasks/bxogwr2mq.output'
const RESULT = `Command running in background with ID: bxogwr2mq. Output is being written to: ${PATH}`

const shell = (id: string, startedAt: number, label = id): Shell => ({ id, label, startedAt, output: `/tmp/tasks/${id}.output` })
const running = (label: string, startedAt: number): ShellRun => ({ label, startedAt, state: 'running' })
const ended = (label: string, startedAt: number, code: number | null, endedAt: number | null): ShellRun => ({ label, startedAt, state: 'ended', code, endedAt })
const text = (lines: ReturnType<typeof shellLines>) => lines.map(plainText)

describe('recording a background shell', () => {
  test('the output path comes from the result text, and nothing when it names no file', () => {
    expect(outputPathOf(RESULT)).toBe(PATH)
    expect(outputPathOf(`${RESULT}.`)).toBe(PATH)
    expect(outputPathOf('Command completed.')).toBeNull()
  })

  test('a background Bash call becomes a shell named by its description, its id the file name', () => {
    const args = { command: 'bun test --watch', description: 'Watch the HUD tests', run_in_background: true }
    expect(shellFrom(args, RESULT, NOW)).toEqual({ id: 'bxogwr2mq', label: 'Watch the HUD tests', startedAt: NOW, output: PATH })
  })

  test('without a description the label is the command, its first line, shortened', () => {
    expect(labelOf('', 'cd /repo\n  && bun run dev')).toBe('cd /repo')
    expect(labelOf('  ', `bun run ${'x'.repeat(100)}`)).toHaveLength(60)
    expect(labelOf('', `bun run ${'x'.repeat(100)}`).endsWith('…')).toBe(true)
  })

  test('a foreground call, or one whose result names no file, records nothing', () => {
    expect(shellFrom({ command: 'ls' }, RESULT, NOW)).toBeNull()
    expect(shellFrom({ command: 'ls', run_in_background: 'true' }, RESULT, NOW)).toBeNull()
    expect(shellFrom({ command: 'ls', run_in_background: true }, 'Exit code 1', NOW)).toBeNull()
  })

  test(`the list keeps ${SHELLS_MAX}: the oldest finished shell goes first, else the oldest`, () => {
    const full = Array.from({ length: SHELLS_MAX }, (_, i) => shell(`s${i}`, NOW + i))
    const next = shell('new', NOW + 100)
    expect(shellAdded(full, next, s => s.id === 's3').map(s => s.id)).toEqual(['s0', 's1', 's2', 's4', 's5', 's6', 's7', 'new'])
    expect(shellAdded(full, next, () => false).map(s => s.id)).toEqual(['s1', 's2', 's3', 's4', 's5', 's6', 's7', 'new'])
    const stopped = shellStopped(full, 's5', NOW + 50)
    expect(shellAdded(stopped, next, () => false).map(s => s.id)).not.toContain('s5')
  })

  test('the same shell added twice is kept once', () => {
    expect(shellAdded([shell('a', NOW)], shell('a', NOW), () => false)).toHaveLength(1)
  })
})

describe('the state of a shell, from the tail of its output', () => {
  test('a tail ending with the exit line is a shell ended with that code', () => {
    expect(exitOf('done\n\n[exited with code 0]\n')).toBe(0)
    expect(exitOf('boom\n[exited with code 144]')).toBe(144)
    expect(exitOf('still compiling…\n')).toBeNull()
    expect(exitOf('[exited with code 1]\nmore output after')).toBeNull()
  })

  test('a missing file is a shell gone, with no code; a stopped one ends when it was stopped', () => {
    const s = shell('a', NOW - 5 * MIN)
    expect(runOf(s, null)).toEqual(ended('a', NOW - 5 * MIN, null, null))
    // A running shell carries when its output last changed, so a silent one can be told.
    expect(runOf(s, { tail: 'tick\n', mtimeMs: NOW })).toEqual({ ...running('a', NOW - 5 * MIN), quietSince: NOW })
    expect(runOf(s, { tail: '[exited with code 2]\n', mtimeMs: NOW - MIN })).toEqual(ended('a', NOW - 5 * MIN, 2, NOW - MIN))
    expect(runOf({ ...s, stoppedAt: NOW - 10_000 }, { tail: 'tick', mtimeMs: NOW })).toEqual(ended('a', NOW - 5 * MIN, null, NOW - 10_000))
  })
})

// The test sandbox has no disk; tools/liveness.ts reads with these two and nothing else decides.
describe('reading output files', () => {
  test('only a task output file named by an absolute path is read at all', () => {
    expect(isOutputPath(PATH)).toBe(true)
    expect(isOutputPath('/Users/ana/.ssh/id_ed25519')).toBe(false)
    expect(isOutputPath('relative/tasks/a.output')).toBe(false)
  })

  test('only the last 200 bytes are read, however big the log grew', () => {
    expect(tailStart(50)).toBe(0)
    expect(tailStart(450_000)).toBe(450_000 - 200)
  })
})

describe('shell rows', () => {
  test('nothing runs: no rows, and the status line keeps its three', () => {
    expect(shellLines([], NOW, 118)).toEqual([])
    expect(statusLines(STATUS, IDLE, NOW, 120, TZ, [])).toHaveLength(3)
    expect(statusLines(STATUS, IDLE, NOW, 120, TZ, [ended('old', NOW - 20 * MIN, 0, NOW - 10 * MIN)])).toHaveLength(3)
  })

  test('running shells read newest first, with how long each has run', () => {
    const runs = [running('Dev server', NOW - 6 * MIN), running('Watch tests', NOW - 40_000)]
    expect(text(shellLines(runs, NOW, 118))).toEqual(['⧗ Watch tests · 40 s', '⧗ Dev server · 6 min'])
  })

  test('a shell that ended in the last two minutes says how, latest end first, then disappears', () => {
    const ok = ended('Build', NOW - 5 * MIN, 0, NOW - 30_000)
    const failed = ended('Lint', NOW - 4 * MIN, 2, NOW - 2 * MIN)
    const stopped = ended('Tail logs', NOW - 3 * MIN, null, NOW - 10_000)
    expect(text(shellLines([ok, failed, stopped], NOW, 118))).toEqual(['■ Tail logs · stopped', '✓ Build · ended', '✗ Lint · exit 2'])
    expect(shellLines([ok, failed], NOW + 2 * MIN, 118).map(plainText)).toEqual([])
    expect(shellLines([ended('Gone', NOW - MIN, null, null)], NOW, 118)).toEqual([])
  })

  test('green for a clean end, red for a failing code, the running clock dim', () => {
    const [run, ok, bad] = shellLines(
      [running('a', NOW - MIN), ended('b', NOW - 2 * MIN, 0, NOW), ended('c', NOW - 3 * MIN, 1, NOW)],
      NOW,
      118,
    ).map(paint)
    expect(run).toContain('\x1b[38;5;247m⧗ ')
    expect(run).toContain('\x1b[38;5;247m · 1 min')
    expect(ok).toContain('\x1b[38;5;114m · ended')
    expect(bad).toContain('\x1b[38;5;210m · exit 1')
  })

  test('running shells come before ended ones, whatever started first', () => {
    const runs = [ended('Build', NOW - MIN, 0, NOW - 5_000), running('Dev server', NOW - 30 * MIN), running('Watch tests', NOW - 2 * MIN)]
    expect(text(shellLines(runs, NOW, 118))).toEqual(['⧗ Watch tests · 2 min', '⧗ Dev server · 30 min', '✓ Build · ended'])
  })

  test('an ended row never pushes a running one into the count', () => {
    const runs = [
      ended('a', NOW - MIN, 0, NOW - 1_000),
      ended('b', NOW - MIN, 1, NOW - 2_000),
      running('one', NOW - 10 * MIN),
      running('two', NOW - 20 * MIN),
      running('three', NOW - 30 * MIN),
    ]
    expect(text(shellLines(runs, NOW, 118))).toEqual(['⧗ one · 10 min', '⧗ two · 20 min', '⧗ three · 30 min', '+2 more'])
  })

  test('past three, the rest are counted on one more row', () => {
    const runs = Array.from({ length: 5 }, (_, i) => running(`job ${i}`, NOW - (i + 1) * MIN))
    expect(text(shellLines(runs, NOW, 118))).toEqual(['⧗ job 0 · 1 min', '⧗ job 1 · 2 min', '⧗ job 2 · 3 min', '+2 more'])
  })

  test('a long label is cut at a word so the time still shows, at every width', () => {
    const runs = [running('Run the full end-to-end suite against the preview deployment and wait for it', NOW - 6 * MIN)]
    for (const columns of [40, 70, 80, 120]) {
      const lines = statusLines(STATUS, IDLE, NOW, columns, TZ, runs)
      const last = lines.at(-1) ?? []
      for (const line of lines) expect(cells(line)).toBeLessThanOrEqual(Math.max(20, columns - 2))
      expect(plainText(last)).toMatch(columns < 90 ? /^⧗ Run .*… · 6 min$/ : /^⧗ Run .* · 6 min$/)
    }
  })

  test('a hidden status line hides the shells too', () => {
    expect(statusLines(STATUS, { ...IDLE, mode: 'hidden' }, NOW, 120, TZ, [running('a', NOW)])).toEqual([])
  })
})
