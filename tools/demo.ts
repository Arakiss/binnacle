#!/usr/bin/env bun
// Plays the band in a terminal, for a recording of it: one scripted session, from a request typed
// at the prompt to its turn's end, drawn frame by frame through the band's own lines and
// components. Nothing here talks to Claude Code: the session is made up, the drawing is real.
//   bun tools/demo.ts            play once at the terminal's width
//   bun tools/demo.ts 120 es     120 columns, in Spanish
// assets/demo.tape records it with vhs: `vhs assets/demo.tape`.
import { useLanguage } from '../i18n'
import { bandLines, type BandInput } from '../render/band'
import { createBandView } from '../render/band-view'
import type { AgentPulse, Mate, Shared, Story } from '../types'
import { drawn, installFactory, partsAt, STAND_INS } from './draw'

const columns = Number(process.argv[2] ?? (process.stdout.columns ?? 122) - 2)
useLanguage(process.argv[3] ?? 'en')
installFactory()

/** Frames a second, and how many seconds of the session pass in one of the recording. */
const FPS = 12
const SPEED = 11
/** Rows the picture takes, so the prompt stays where it is while the band grows above it. */
const ROWS = 21

const START = Date.UTC(2026, 9, 10, 12, 0)
const ASK = 'The status line overflows at 70 columns. Find out why and fix it, with a test.'
const THOUGHT = 'The cut happens before the separators are counted, so a full line runs four cells over'
const GOAL = 'Stop the status line overflowing at 70 columns'

/** When each thing happens, in seconds of the recording. */
const AT = { typed: 3.2, sent: 3.8, says: 6.6, read: 9.2, agents: 10.8, briefed: 13.2, mate: 14.8, reports: 16.6, tests: 18.4, ends: 21, over: 25 }

const GIT = { root: '/home/dev/acme', repo: 'acme', branch: 'fix/status-width', dirty: 2, ahead: 0, behind: 0 }

function sceneAt(t: number): { input: BandInput; prompt: string } {
  const now = START + t * SPEED * 1000
  const sim = (at: number) => START + at * SPEED * 1000
  const typed = ASK.slice(0, Math.round((Math.min(t, AT.typed) / AT.typed) * ASK.length))
  const isWorking = t >= AT.sent && t < AT.ends
  const story: Story | undefined =
    t < AT.sent
      ? undefined
      : {
          asks: [ASK],
          askedAt: sim(AT.sent),
          ...(t >= AT.says ? { said: 'Reading how the line is cut.' } : {}),
          trail: {
            read: Math.min(9, Math.max(0, Math.floor((t - AT.says) * 1.6))),
            search: Math.min(4, Math.max(0, Math.floor((t - AT.says) * 0.7))),
            edit: t < AT.briefed ? 0 : t < AT.tests ? 1 : 2,
            run: Math.min(5, Math.max(0, Math.floor((t - 8) * 0.4))),
            web: 0,
            agent: t >= AT.agents ? 2 : 0,
            other: 0,
            files: t < AT.briefed ? [] : t < AT.tests ? ['render/status.ts'] : ['render/status.ts', 'render/text.ts'],
          },
          ...(t >= AT.read
            ? {
                brief: {
                  goal: GOAL,
                  now: t < AT.briefed ? 'Measuring the line at three widths' : t < AT.tests ? 'Fixing the cut so it counts the separators' : t < AT.ends ? 'Running the tests on the two fixes' : 'Fixed the separator miscount and added width tests',
                  done: t < AT.briefed ? '' : t < AT.tests ? 'Found the cut ignores separators' : t < AT.ends ? 'Two fixes in place; three width tests written' : 'All 248 tests pass; nothing committed',
                  at: t < AT.ends ? sim(AT.read) : sim(AT.ends) + 1,
                },
              }
            : {}),
          ...(t >= AT.ends ? { outcome: 'Fixed: the cut now counts separators.', outcomeAt: sim(AT.ends) } : {}),
        }
  const call = t < AT.says ? undefined : t < AT.read ? 'Read · render/status.ts' : t < AT.agents ? 'Run the status line at 70 columns' : t < AT.briefed ? undefined : t < AT.tests ? 'Edit · render/status.ts' : 'Run the width tests'
  const audit: AgentPulse = {
    id: 'a-width',
    name: 'width-audit',
    lastAt: now,
    busy: 1,
    phase: 'turn',
    phaseAt: sim(AT.agents),
    doing: { id: 'w', tool: 'Bash', text: t < AT.reports ? 'Measure the band at 40 columns' : 'Measure the band at 70 columns', at: now - 8_000, running: true },
    story: {
      asks: ['Measure the band at 40, 70 and 120 columns against every fixture and report which lines overflow.'],
      askedAt: sim(AT.agents),
      trail: { read: 3, search: 1, edit: 0, run: Math.min(6, Math.floor((t - AT.agents) * 0.8)), web: 0, agent: 0, other: 0, files: [] },
      ...(t >= AT.briefed ? { brief: { goal: 'Find which band lines overflow at narrow widths', now: t < AT.reports ? 'Running every fixture at 40 columns' : 'Running every fixture at 70 columns', done: t < AT.reports ? '120 columns is clean' : '120 and 40 columns are clean', at: sim(AT.briefed) } } : {}),
    },
  }
  const types: AgentPulse = {
    id: 'a-types',
    name: 'explore types',
    lastAt: now,
    busy: 0,
    phase: 'turn',
    phaseAt: sim(AT.agents),
    story: { asks: ['List every place the Shared type is read outside the hooks module.'], askedAt: sim(AT.agents), ...(t >= AT.agents + 1.2 ? { said: 'Three readers so far; checking the tools folder next.' } : {}) },
  }
  const agents = t < AT.agents || t >= AT.ends ? [] : t < AT.reports ? [audit, types] : [audit]
  const shared: Shared = {
    git: GIT,
    turn: isWorking ? { startedAt: sim(AT.sent), actions: Math.max(0, Math.floor((t - AT.sent - 1) * 1.8)), denials: 0, tool: null, ...(call ? { doing: call } : {}) } : null,
    last: t >= AT.ends ? { endedAt: sim(AT.ends), seconds: 190, actions: 31, steps: 12 } : null,
    agents,
    ...(story ? { story } : {}),
    ...(isWorking && t >= AT.says ? { pulse: Array.from({ length: 12 }, (_, i) => Math.max(0, Math.round(2.4 + 2.6 * Math.sin((i + Math.floor(t * 1.5)) * 0.9) + 1.5 * Math.sin((i + Math.floor(t * 1.5)) * 2.3)))) } : {}),
    ...(t >= AT.reports && t < AT.ends + 2 ? { finished: [{ id: 'a-types', name: 'explore types', endedAt: sim(AT.reports), outcome: 'Four readers: the status line, the pane, tools/liveness.ts and tools/quota.ts.' }] } : {}),
  }
  const mates: Mate[] = t < AT.mate ? [] : [{ session: 'b1c2d3e4-0000', repo: 'shop', branch: 'feat/cart', seenAt: now, turnStartedAt: now - 7 * 60_000, agents: 1, goal: 'Make the cart total survive a reload', now: 'Writing the session store' }]
  const thought = t >= AT.sent + 0.4 && t < AT.says ? THOUGHT.slice(0, Math.round(((t - AT.sent - 0.4) / (AT.says - AT.sent - 0.6)) * THOUGHT.length)) : ''
  const input: BandInput = {
    now,
    tz: 120,
    model: 'Opus 5.5',
    effort: 'high',
    startedAt: START - 42 * 60_000,
    snapshot: { percent: 34 + Math.max(0, t - AT.sent) * 0.25, tokens: 340_000 + Math.round(Math.max(0, t - AT.sent) * 2500), window: 1_000_000, limits: [{ kind: 'five_hour', percent: 41 + Math.max(0, t - AT.sent) * 0.3, resetsAt: START + 3 * 3_600_000 }, { kind: 'seven_day', percent: 9, resetsAt: START + 4 * 86_400_000 }] },
    shared,
    runs: t >= AT.read && t < AT.ends ? [{ label: 'Dev server', startedAt: sim(AT.read), state: 'running' }] : [],
    isWorking,
    mates,
    ...(thought ? { live: { main: { thinking: thought } } } : {}),
  }
  return { input, prompt: t < AT.sent ? typed : '' }
}

const DIM = '\x1b[38;2;86;95;137m'
const RESET = '\x1b[0m'

function frame(t: number, n: number): string {
  const { input, prompt } = sceneAt(t)
  const lines = bandLines(input, columns, 18)
  const { Band } = createBandView(STAND_INS, partsAt(n))
  const rows = drawn(Band({ lines, columns })).flatMap((row, i) => (i > 0 && lines[i]?.tight !== true ? ['', row] : [row]))
  const rule = `${DIM}${'─'.repeat(columns)}${RESET}`
  const cursor = Math.floor(t * 2) % 2 === 0 ? '\x1b[48;2;125;207;255m \x1b[0m' : ' '
  const foot = ['', rule, `\x1b[38;2;115;122;162m❯${RESET} \x1b[38;2;192;202;245m${prompt}${RESET}${cursor}`, rule]
  const body = [...rows, ...foot]
  const picture = [...Array.from({ length: Math.max(0, ROWS - body.length) }, () => ''), ...body]
  return `\x1b[H${picture.map(row => ` ${row}\x1b[K`).join('\n')}`
}

process.stdout.write('\x1b[?25l\x1b[2J')
const total = Math.round(AT.over * FPS)
for (let n = 0; n <= total; n += 1) {
  process.stdout.write(frame(n / FPS, n))
  await Bun.sleep(1000 / FPS)
}
process.stdout.write('\x1b[?25h\n')
