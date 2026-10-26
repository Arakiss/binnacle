// Fixed sessions for the tests and tools/preview.ts. 12:05 UTC is 14:05 local time (UTC+2).

import * as act from '../model/activity'
import { shareOf } from '../model/shared'
import type { ShellRun } from '../model/shells'
import type { BandInput } from '../render/band'
import type { PaneInput } from '../render/pane'
import type { Status } from '../render/status'
import type { Activity, Git, Peer, Sample, Shared } from '../types'

export const TZ = 120
export const NOW = Date.UTC(2026, 9, 10, 12, 5)
const MIN = 60_000
const at = (hh: number, mm: number, ss = 0) => Date.UTC(2026, 9, 10, hh - 2, mm, ss)

export const STATUS: Status = {
  model: 'Opus 5.5',
  context: { percent: 34, tokens: 340_000, window: 1_000_000 },
  limits: [
    { kind: 'seven_day', percent: 9, resetsAt: NOW + 4 * 24 * 60 * MIN },
    { kind: 'five_hour', percent: 62, resetsAt: at(14, 20) },
  ],
}

/** An API key: no rate-limit windows, a real cost. */
export const API_KEY: Status = { model: 'Sonnet 5', context: { percent: 12, tokens: 24_000, window: 200_000 }, limits: [], usd: 1.23 }

export const GIT: Git = { root: '/home/dev/acme', repo: 'acme', branch: 'main', dirty: 2, ahead: 1, behind: 0 }

export const IDLE: Shared = {
  git: GIT,
  turn: null,
  last: { endedAt: NOW - 5 * MIN, seconds: 300, actions: 14, steps: 9 },
}

export const WORKING: Shared = {
  git: GIT,
  turn: { startedAt: NOW - 3 * MIN, actions: 14, denials: 0, tool: 'Bash', doing: 'Run the HUD tests' },
  agents: [
    {
      id: 'a-width',
      name: 'width-audit',
      lastAt: NOW - 20_000,
      busy: 1,
      phase: 'turn',
      phaseAt: NOW - 2 * MIN,
      doing: { id: 'call-w', tool: 'Bash', text: 'Measure the band at 40 columns', at: NOW - 20_000, running: true },
    },
    { id: 'a-types', name: 'explore types', lastAt: NOW - 60_000, busy: 0, phase: 'turn', phaseAt: NOW - 3 * MIN },
  ],
}

/** The five-hour window went from 5% to 62% in the last hour: full in 40 minutes. */
export const FILLING: Record<string, Sample[]> = {
  five_hour: [
    { t: NOW - 60 * MIN, p: 5 },
    { t: NOW - 30 * MIN, p: 33 },
    { t: NOW, p: 62 },
  ],
}

export const ALERTS: Shared = {
  git: GIT,
  ci: { pass: 7, fail: 2, pending: 0 },
  crowd: 1,
  loops: 6,
  history: FILLING,
  turn: { startedAt: NOW - 3 * MIN, actions: 14, denials: 3, tool: 'Bash' },
  agents: [
    { id: 'a-width', name: 'width-audit', lastAt: NOW - 20_000, busy: 1, phase: 'turn', phaseAt: NOW - 2 * MIN },
    // A teammate idle twelve minutes with nothing that will wake it: stalled.
    { id: 'a-types', name: 'explore types', lastAt: NOW - 12 * MIN, busy: 0, isTeammate: true, phase: 'idle', phaseAt: NOW - 12 * MIN, status: 'idle' },
  ],
}

export const ALERT_STATUS: Status = {
  ...STATUS,
  context: { percent: 92, tokens: 920_000, window: 1_000_000 },
  limits: [
    { kind: 'five_hour', percent: 62, resetsAt: NOW + 3 * 60 * MIN },
    { kind: 'seven_day', percent: 41, resetsAt: NOW + 4 * 24 * 60 * MIN },
  ],
}

export const NO_REPO: Shared = { ...WORKING, git: null }

/**
 * A fresh session in a shared checkout: clean, detached, three other sessions in it; the week 60%
 * spent with four and a half days still to run, the five-hour window nearly untouched.
 */
export const SHARED_CHECKOUT: Shared = {
  git: { root: '/home/dev/shop', repo: 'shop', branch: '(detached)', dirty: 0, ahead: 0, behind: 0 },
  crowd: 3,
  turn: null,
  last: null,
}

export const AHEAD_OF_PACE: Status = {
  model: 'Opus 5.5',
  limits: [
    { kind: 'five_hour', percent: 8, resetsAt: NOW + 3 * 60 * MIN },
    { kind: 'seven_day', percent: 60, resetsAt: NOW + (4 * 24 + 13) * 60 * MIN },
  ],
}

const CWD = '/home/dev/acme'

/** A session three minutes into a turn, with agents, a refusal and an error. */
export function busyActivity(): Activity {
  let a = act.EMPTY
  const call = (id: string, tool: string, args: Record<string, unknown>, start: number, end: number | null, ran: act.CallEnd['ran'] = {}, agentId?: string) => {
    const begin = { id, agentId, tool, target: act.summarize(tool, args, CWD), at: start }
    a = act.callStarted(a, begin)
    if (end !== null) {
      const edited = act.editedFile(tool, args)
      a = act.callEnded(a, { ...begin, endedAt: end, ran, file: edited && act.relative(edited, CWD) })
    }
  }

  a = act.agentSpawned(a, { id: 'a-old', name: 'first-pass', type: 'Explore', isBackground: true, at: at(13, 20) })
  a = act.agentTurnEnded(a, 'a-old', at(13, 30))
  a = act.skillLoaded(a, 'plugin-authoring', at(13, 40))
  a = act.skillLoaded(a, 'software-craft', at(13, 41))
  a = act.compacted(a, { at: at(13, 45), trigger: 'auto', before: 820_000, after: 61_000 })
  a = act.agentSpawned(a, { id: 'a-types', name: 'explore types', type: 'Explore', isBackground: false, at: at(13, 50) })
  call('t1', 'Grep', { pattern: 'tool.check', path: `${CWD}/src` }, at(13, 51), at(13, 51, 1), {}, 'a-types')
  call('t2', 'Read', { file_path: `${CWD}/src/types/index.d.ts` }, at(13, 53), at(13, 53, 1), {}, 'a-types')
  a = act.noted(a, { at: at(13, 58), direction: 'in', who: 'another session', text: 'Can you review PR 41 before five?' })

  a = act.turnStarted(a, 'turn-2', at(14, 2))
  for (let i = 0; i < 4; i += 1) a = act.stepTaken(a, undefined, at(14, 2, 5 + i))
  call('m1', 'Read', { file_path: `${CWD}/src/hooks/register.tsx` }, at(14, 2, 10), at(14, 2, 10) + 120)
  call('m2', 'Edit', { file_path: `${CWD}/src/render/status.ts` }, at(14, 2, 30), at(14, 2, 31))
  call('m3', 'Edit', { file_path: `${CWD}/src/render/status.ts` }, at(14, 2, 50), at(14, 2, 51))
  call('m4', 'Bash', { command: 'bun test src' }, at(14, 3), at(14, 3, 12))
  a = act.checkDenied(a, 'm5', 'policy: rm -rf of an absolute path is blocked')
  call('m5', 'Bash', { command: 'rm -rf /home/dev/acme/build' }, at(14, 3, 20), at(14, 3, 20) + 40, { isError: true, text: 'blocked' })
  call('m6', 'Bash', { command: 'git push origin feat/status-widths' }, at(14, 3, 30), at(14, 3, 33), { isError: true, text: 'error: failed to push some refs\nhint: pull first' })
  a = act.agentSpawned(a, { id: 'a-width', name: 'width-audit', type: 'general-purpose', isBackground: true, at: at(14, 3, 40) })
  call('m7', 'Agent', { description: 'Audit status line widths', subagent_type: 'general-purpose' }, at(14, 3, 40), at(14, 3, 41))
  call('w1', 'Read', { file_path: `${CWD}/src/render/text.ts` }, at(14, 3, 50), at(14, 3, 50) + 80, {}, 'a-width')
  call('w2', 'WebFetch', { url: 'https://code.claude.com/docs/en/statusline', prompt: 'columns' }, at(14, 4), at(14, 4, 2), {}, 'a-width')
  call('w3', 'Bash', { command: 'COLUMNS=70 bun src/statusline.ts < fixture.json' }, at(14, 4, 40), null, {}, 'a-width')
  a = act.noted(a, { at: at(14, 4, 10), direction: 'out', who: 'width-audit', text: 'Measure 70 columns too' })
  call('m8', 'Bash', { command: 'claude plugin validate . && claude plugin test .' }, at(14, 4, 50), null)
  return a
}

export const PEERS: Peer[] = [
  { session: 'b1c2d3e4-0000', harness: 'claude-code', place: 'acme', repo: GIT.root, branch: 'main', intent: 'Vesper: Syncing the docs site', liveness: 'live', lastMs: NOW - MIN },
  { session: 'c9d8e7f6-0000', harness: 'codex', place: 'shop', repo: '/home/dev/shop', branch: null, intent: null, liveness: 'stale', lastMs: NOW - 40 * MIN },
]

/** Two shells running and two that ended: one clean a minute ago, one failing before it. */
export const RUNS: ShellRun[] = [
  { label: 'Render the mockups', startedAt: NOW - 9 * MIN, state: 'ended', code: 0, endedAt: NOW - MIN },
  { label: 'Executor · inbox redesign', startedAt: NOW - 14 * MIN, state: 'running' },
  { label: 'Lint the plugin', startedAt: NOW - 8 * MIN, state: 'ended', code: 2, endedAt: NOW - 90_000 },
  { label: 'Wait for PR 2303 to reach production', startedAt: NOW - 6 * MIN, state: 'running' },
]

export function busyPane(): PaneInput {
  return {
    now: NOW,
    tz: TZ,
    activity: busyActivity(),
    snapshot: { percent: 34, tokens: 340_000, window: 1_000_000, limits: ALERT_STATUS.limits, usd: 4.1 },
    history: FILLING,
    git: GIT,
    ci: { pass: 7, fail: 2, pending: 0 },
    pr: { number: 41, review: 'CHANGES_REQUESTED' },
    peers: PEERS,
    loops: 6,
    shells: RUNS,
  }
}

/** The state file the mod would write for the busy pane's session. */
export function busyShared(): Shared {
  const p = busyPane()
  return shareOf({ now: p.now, mode: 'full', activity: p.activity, git: p.git, ci: p.ci, peers: p.peers, loops: p.loops, history: p.history })
}

/** What the band hook would gather for a status fixture; working while the fixture's turn runs. */
export function bandOf(status: Status, shared: Shared, runs: readonly ShellRun[] = []): BandInput {
  const ctx = status.context
  return {
    now: NOW,
    tz: TZ,
    model: status.model,
    effort: 'high',
    startedAt: NOW - (4 * 24 + 17) * 60 * MIN,
    snapshot: { percent: ctx?.percent, tokens: ctx?.tokens, window: ctx?.window ?? 200_000, limits: status.limits, usd: status.usd },
    shared,
    pr: shared.ci ? { number: 41, review: '', url: 'https://github.com/example/shop/pull/41' } : null,
    runs,
    isWorking: Boolean(shared.turn),
  }
}

/** The liveness fixture's shells: one a stalled teammate's that ended, one a waiting teammate's, one the main loop's. */
export const LIVE_RUNS: ShellRun[] = [
  { label: 'Measure classes', startedAt: NOW - 9 * MIN, agentId: 'a-sim', state: 'ended', code: 0, endedAt: NOW - 4 * MIN },
  { label: 'Translate the catalogue', startedAt: NOW - 5 * MIN, agentId: 'a-i18n', state: 'running' },
  { label: 'Dev server', startedAt: NOW - 40 * MIN, state: 'running' },
]

/** A team with every liveness: at work, waiting on the lead, on a shell, stalled, unknown, and done. */
export function livenessActivity(): Activity {
  const teammate = (id: string, name: string, at: number) => act.agentSpawned(a, { id, name, type: 'teammate', isBackground: true, isTeammate: true, at })
  let a = act.EMPTY
  a = teammate('a-rust', 'rustsim', NOW - 20 * MIN)
  a = act.callStarted(a, { id: 'r1', agentId: 'a-rust', tool: 'Bash', target: 'cargo test', at: NOW - 10_000 })
  a = teammate('a-hud', 'hudwatch', NOW - 30 * MIN)
  a = act.agentHeard(a, 'a-hud', NOW - 5 * MIN)
  a = act.agentSent(a, 'a-hud', 'team-lead', NOW - 70_000)
  a = act.agentTurnEnded(a, 'a-hud', NOW - MIN)
  a = teammate('a-i18n', 'i18n', NOW - 25 * MIN)
  a = act.agentTurnEnded(a, 'a-i18n', NOW - 3 * MIN)
  a = teammate('a-sim', 'simclasses', NOW - 40 * MIN)
  a = act.agentSent(a, 'a-sim', 'team-lead', NOW - 8 * MIN)
  a = act.agentHeard(a, 'a-sim', NOW - 7 * MIN)
  a = act.agentTurnEnded(a, 'a-sim', NOW - 6 * MIN)
  a = act.agentSpawned(a, { id: 'a-scout', name: 'scout', type: 'Explore', isBackground: true, at: NOW - 12 * MIN })
  a = act.agentTurnEnded(a, 'a-scout', NOW - 2 * MIN, true)
  // A teammate in a terminal pane of its own: listed idle, its loop never seen here.
  const observer = { id: 'observer@team', name: 'observer', type: 'teammate', startedAt: NOW - 50 * MIN, lastAt: NOW - 9 * MIN, actions: 0, busy: 0, isTeammate: true, status: 'idle' }
  return { ...a, agents: [...a.agents, observer] }
}

export function livenessShared(): Shared {
  return shareOf({ now: NOW, mode: 'full', activity: livenessActivity(), git: GIT, ci: null, peers: [], loops: 0, history: {}, shells: [] })
}

export function livenessPane(): PaneInput {
  return { ...emptyPane(), git: GIT, activity: livenessActivity(), shells: LIVE_RUNS, snapshot: { percent: 34, tokens: 340_000, window: 1_000_000, limits: STATUS.limits } }
}

export function emptyPane(): PaneInput {
  return { now: NOW, tz: TZ, activity: act.EMPTY, snapshot: null, history: {}, git: null, ci: null, pr: null, peers: [], loops: 0, shells: [] }
}
