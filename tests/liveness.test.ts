import { describe, expect, test } from 'claude-code/testing'

import * as act from '../model/activity'
import { idleNudge, shellVerdict, stopNudge, verdictOf, type Agent } from '../model/liveness'
import type { ShellRun } from '../model/shells'
import { bandLines } from '../render/band'
import { statusLines } from '../render/status'
import { plainText } from '../render/text'
import { exitOf, lineOf, rowsOf } from '../render/report'
import { bandOf, IDLE, NOW, STATUS } from './fixtures'

const MIN = 60_000

/** A teammate that went idle two minutes ago, with nothing else known. */
const idle: Agent = { id: 'a-sim', name: 'simclasses', lastAt: NOW - 2 * MIN, busy: 0, isTeammate: true, phase: 'idle', phaseAt: NOW - 2 * MIN, status: 'idle' }

const shell = (state: 'running' | 'ended', agentId = 'a-sim', endedAt: number | null = NOW - MIN): ShellRun =>
  state === 'running'
    ? { label: 'Medir clases', startedAt: NOW - 5 * MIN, agentId, state }
    : { label: 'Medir clases', startedAt: NOW - 5 * MIN, agentId, state, code: 0, endedAt }

describe('an idle agent', () => {
  test('waits while a background process of its own runs, and says its end will not wake it', () => {
    const v = verdictOf(idle, [shell('running')], NOW)
    expect(v.state).toBe('waiting')
    expect(v.since).toBe(NOW - 2 * MIN)
    expect(v.why).toBe('shell “Medir clases”, whose end will not wake it')
  })

  test('is stalled, not waiting, once that process finished: nothing else will wake it', () => {
    const v = verdictOf(idle, [shell('ended')], NOW)
    expect(v.state).toBe('stalled')
    expect(v.since).toBe(NOW - MIN)
    expect(v.why).toBe('its shell “Medir clases” ended and nothing else wakes it')
  })

  test("another agent's running shell is no waker of its", () => {
    expect(verdictOf(idle, [shell('running', 'a-other')], NOW).state).toBe('stalled')
  })

  test('waits on whoever it wrote to until they answer; an answer it left unanswered is a stall', () => {
    const asked = { ...idle, sentAt: NOW - 2 * MIN, sentTo: 'team-lead', heardAt: NOW - 10 * MIN }
    expect(verdictOf(asked, [], NOW)).toEqual(expect.objectContaining({ state: 'waiting', why: 'waits on team-lead' }))
    const answered = { ...asked, heardAt: NOW - MIN }
    expect(verdictOf(answered, [], NOW)).toEqual(expect.objectContaining({ state: 'stalled', why: 'got a message and went idle without answering' }))
  })

  test("waits while the engine holds it, and on a monitor until the monitor's deadline", () => {
    expect(verdictOf({ ...idle, status: 'waiting' }, [], NOW).state).toBe('waiting')
    const watched = { ...idle, monitors: [{ id: 'm1', until: NOW + MIN }] }
    expect(verdictOf(watched, [], NOW).state).toBe('waiting')
    const expired = { ...idle, monitors: [{ id: 'm1', until: NOW - 30_000 }] }
    expect(verdictOf(expired, [], NOW)).toEqual(expect.objectContaining({ state: 'stalled', since: NOW - 30_000 }))
    expect(verdictOf({ ...idle, monitors: [{ id: 'm2' }] }, [], NOW).state).toBe('waiting')
  })
})

describe('what the HUD cannot see it says it cannot', () => {
  test('a teammate idle in a pane of its own, whose loop never ran here, is unknown, not waiting', () => {
    const elsewhere: Agent = { id: 'pane@team', name: 'scout', lastAt: NOW - 5 * MIN, busy: 0, isTeammate: true, status: 'idle' }
    expect(verdictOf(elsewhere, [], NOW)).toEqual(expect.objectContaining({ state: 'unknown' }))
  })

  test('an agent that vanished with no report is unknown; one that handed its report back is done', () => {
    const gone: Agent = { id: 'a1', name: 'scout', lastAt: NOW - 5 * MIN, busy: 0, endedAt: NOW - MIN }
    expect(verdictOf(gone, [], NOW).state).toBe('unknown')
    expect(verdictOf({ ...gone, reportedAt: NOW - MIN }, [], NOW)).toEqual(expect.objectContaining({ state: 'done', why: 'delivered its report' }))
    expect(verdictOf({ ...idle, isTeammate: false, status: 'completed' }, [], NOW).state).toBe('done')
    // A teammate still active that the engine calls completed is idle with nothing to wake it.
    expect(verdictOf({ ...idle, status: 'completed' }, [], NOW).state).toBe('stalled')
  })

  test('a shell whose output file is gone is unknown; a running one works; an ended one is done with its code', () => {
    expect(shellVerdict(shell('running')).state).toBe('working')
    expect(shellVerdict(shell('ended'))).toEqual(expect.objectContaining({ state: 'done', why: 'exit 0' }))
    expect(shellVerdict(shell('ended', 'a-sim', null)).state).toBe('unknown')
  })

  test('a call in flight or a turn under way is work, whatever the list last said', () => {
    expect(verdictOf({ ...idle, busy: 1 }, [], NOW).state).toBe('working')
    expect(verdictOf({ ...idle, phase: 'turn' }, [], NOW).state).toBe('working')
  })
})

describe('the idle and stop hooks', () => {
  test('a teammate going idle with nothing to wake it is sent back once per message it gets', () => {
    const text = idleNudge(idle, [], NOW)
    expect(text).toContain('with nothing to wake you')
    expect(idleNudge({ ...idle, nudgedAt: NOW - MIN, heardAt: NOW - 3 * MIN }, [], NOW)).toBeNull()
    expect(idleNudge({ ...idle, nudgedAt: NOW - 3 * MIN, heardAt: NOW - MIN }, [], NOW)).not.toBeNull()
  })

  test('one that wrote to someone may idle; one leaning on a running shell is told the shell will not wake it', () => {
    expect(idleNudge({ ...idle, sentAt: NOW - MIN, sentTo: 'team-lead' }, [], NOW)).toBeNull()
    expect(idleNudge(idle, [shell('running')], NOW)).toContain('“Medir clases”, but its end will not wake you')
  })

  test('a subagent ending with its own shell running is held once, and never on the retry', () => {
    const sub: Agent = { id: 'a-sim', name: 'measure', lastAt: NOW, busy: 0, phase: 'turn' }
    expect(stopNudge(sub, [shell('running')], false)).toContain('still running')
    expect(stopNudge(sub, [shell('running')], true)).toBeNull()
    expect(stopNudge({ ...sub, nudgedAt: NOW }, [shell('running')], false)).toBeNull()
    expect(stopNudge(sub, [shell('ended')], false)).toBeNull()
  })
})

describe('reducers', () => {
  test("a teammate's turn ends in idle, not in its end; a subagent's ends it with its report", () => {
    let a = act.agentSpawned(act.EMPTY, { id: 't', name: 'simclasses', type: 'teammate', isBackground: true, isTeammate: true, at: 1000 })
    a = act.agentSpawned(a, { id: 's', name: 'scout', type: 'Explore', isBackground: true, at: 1000 })
    a = act.agentTurnEnded(act.agentTurnEnded(a, 't', 5000, true), 's', 6000, true)
    expect(a.agents.find(r => r.id === 't')).toEqual(expect.objectContaining({ phase: 'idle', phaseAt: 5000 }))
    expect(a.agents.find(r => r.id === 't')?.endedAt).toBeUndefined()
    expect(a.agents.find(r => r.id === 's')).toEqual(expect.objectContaining({ endedAt: 6000, reportedAt: 6000 }))
  })

  test('a message or a call wakes a teammate into a turn; what it sends and hears is kept', () => {
    let a = act.agentSpawned(act.EMPTY, { id: 't', name: 'simclasses', type: 'teammate', isBackground: true, isTeammate: true, at: 1000 })
    a = act.agentTurnEnded(a, 't', 2000)
    a = act.agentHeard(a, 't', 3000)
    a = act.agentTurnStarted(a, 't', 3000)
    a = act.agentSent(a, 't', 'team-lead', 4000)
    expect(a.agents[0]).toEqual(expect.objectContaining({ phase: 'turn', phaseAt: 3000, heardAt: 3000, sentAt: 4000, sentTo: 'team-lead' }))
  })

  test('the live list starts a missed turn at once, and ends one only after a quiet grace', () => {
    const a = act.callEnded(act.callStarted(act.EMPTY, { id: 'c', agentId: 't', tool: 'Read', target: 'x', at: 1000 }), {
      id: 'c', agentId: 't', tool: 'Read', target: 'x', at: 1000, endedAt: 1100, ran: {},
    })
    const listed = (status: string) => [{ id: 't', teammateId: 'sim@team', description: '', type: 'teammate', status }]
    expect(act.agentsReconciled(a, listed('idle'), 1100 + act.LISTING_GRACE_MS - 1).agents[0]?.phase).toBe('turn')
    const quiet = act.agentsReconciled(a, listed('idle'), 1100 + act.LISTING_GRACE_MS)
    expect(quiet.agents[0]).toEqual(expect.objectContaining({ phase: 'idle', phaseAt: 1100, isTeammate: true, status: 'idle' }))
    expect(act.agentsReconciled(quiet, listed('running'), 99_999).agents[0]?.phase).toBe('turn')
  })

  test("a workflow's agent, which the live list never holds, is not ended for missing from it", () => {
    let a = act.agentSpawned(act.EMPTY, { id: 'w', name: 'review:bugs', type: 'general-purpose', isBackground: true, workflow: 'wf_abc123', at: 1000 })
    a = act.callEnded(act.callStarted(a, { id: 'c', agentId: 'w', tool: 'Read', target: 'x', at: 1000 }), { id: 'c', agentId: 'w', tool: 'Read', target: 'x', at: 1000, endedAt: 1100, ran: {} })
    const later = act.agentsReconciled(a, [], 1100 + 10 * act.LISTING_GRACE_MS)
    expect(later.agents[0]).toEqual(expect.objectContaining({ workflow: 'wf_abc123', endedAt: undefined }))
    expect(act.agentsReconciled(a, [], 1100 + act.UNLISTED_EXPIRY_MS).agents[0]?.endedAt).toBe(1100 + act.UNLISTED_EXPIRY_MS)
    // Any other agent missing from the list past the grace has ended.
    const plain = act.callStarted(act.EMPTY, { id: 'd', agentId: 'p', tool: 'Read', target: 'x', at: 1000 })
    expect(act.agentsReconciled(plain, [], 1000 + act.LISTING_GRACE_MS).agents[0]?.endedAt).toBe(1000 + act.LISTING_GRACE_MS)
  })

  test('an agent carries what it does now, in its call\'s own words, and keeps it as the last thing once the call ends', () => {
    const started = act.callStarted(act.EMPTY, { id: 'c', agentId: 'w', tool: 'Bash', target: 'bun test', said: 'Run the HUD tests', at: 1000 })
    expect(started.agents[0]?.doing).toEqual({ id: 'c', tool: 'Bash', text: 'Run the HUD tests', at: 1000, running: true })
    expect(started.calls[0]?.said).toBe('Run the HUD tests')
    const ended = act.callEnded(started, { id: 'c', agentId: 'w', tool: 'Bash', target: 'bun test', said: 'Run the HUD tests', at: 1000, endedAt: 1500, ran: {} })
    expect(ended.agents[0]?.doing).toEqual({ id: 'c', tool: 'Bash', text: 'Run the HUD tests', at: 1000, running: false })
    // Without words of its own, the call is named by what it acts on.
    expect(act.callStarted(act.EMPTY, { id: 'e', agentId: 'w', tool: 'Read', target: 'model/shells.ts', at: 1 }).agents[0]?.doing?.text).toBe('model/shells.ts')
    expect(act.described({ description: 'Run the HUD tests\nand more' })).toBe('Run the HUD tests')
    // A message names who it goes to and its summary.
    expect(act.summarize('SendMessage', { to: 'team-lead', summary: 'Report ready', message: 'long text' }, '')).toBe('→ team-lead: Report ready')
    expect(act.described({ command: 'ls' })).toBeUndefined()
  })

  test("the list's completed ends a subagent but not a teammate; killed ends both, and the word is kept", () => {
    const a = act.agentTurnEnded(act.agentSpawned(act.EMPTY, { id: 't', name: 'sim', type: 'teammate', isBackground: true, isTeammate: true, at: 1000 }), 't', 2000)
    const listed = (status: string) => [{ id: 't', teammateId: 'sim@team', description: '', type: 'teammate', status }]
    const completed = act.agentsReconciled(a, listed('completed'), 9000)
    expect(completed.agents[0]).toEqual(expect.objectContaining({ status: 'completed', phase: 'idle' }))
    expect(completed.agents[0]?.endedAt).toBeUndefined()
    expect(verdictOf({ ...completed.agents[0]!, id: 't' }, [], 9000).state).toBe('stalled')
    const killed = act.agentsReconciled(a, listed('killed'), 9000)
    expect(killed.agents[0]).toEqual(expect.objectContaining({ status: 'killed', endedAt: 9000 }))
    expect(verdictOf(killed.agents[0]!, [], 9000).state).toBe('done')
    expect(act.isRest('completed', false)).toBe(true)
  })

  test('TaskStop on an agent ends it as killed: done, never stalled', () => {
    const a = act.agentStopped(act.agentTurnEnded(act.agentSpawned(act.EMPTY, { id: 't', name: 'sim', type: 'teammate', isBackground: true, isTeammate: true, at: 1000 }), 't', 2000), 't', 3000)
    expect(verdictOf(a.agents[0]!, [], 99_000)).toEqual(expect.objectContaining({ state: 'done', why: 'stopped' }))
    expect(act.agentStopped(act.EMPTY, 'nobody', 1)).toBe(act.EMPTY)
  })

  test("a workflow's name is kept by its run id, bounded, the newest last", () => {
    let a = act.workflowNamed(act.EMPTY, 'wf_1', 'review-changes')
    expect(a.workflows).toEqual({ wf_1: 'review-changes' })
    for (let i = 2; i <= 25; i += 1) a = act.workflowNamed(a, `wf_${i}`, `flow ${i}`)
    expect(Object.keys(a.workflows ?? {})).toHaveLength(20)
    expect(a.workflows?.wf_1).toBeUndefined()
    expect(a.workflows?.wf_25).toBe('flow 25')
  })

  test('a monitor stopped by its task id wakes nobody any more', () => {
    let a = act.monitorArmed(act.EMPTY, 't', { id: 'm1', until: 9000 }, 1000)
    a = act.monitorStopped(a, 'm1')
    expect(a.agents[0]?.monitors).toEqual([])
  })
})

describe('the command', () => {
  test('a row per agent and per shell with its owner; exit 3 while an agent stalled, 0 once nothing did', () => {
    const shared = { agents: [{ id: 'a-sim', name: 'simclasses', lastAt: NOW - 2 * MIN, busy: 0, phase: 'idle' as const, phaseAt: NOW - 2 * MIN }] }
    const rows = rowsOf(shared, [shell('ended')], NOW)
    expect(rows.map(r => lineOf(r, NOW))).toEqual([
      'stalled    simclasses                            1 min   its shell “Medir clases” ended and nothing else wakes it',
      'done       shell Medir clases (simclasses)       1 min   exit 0',
    ])
    expect(exitOf(rows)).toBe(3)
    expect(exitOf(rowsOf(shared, [shell('running')], NOW))).toBe(0)
  })

  test("the main loop's shell names no owner, even beside an agent the state knows by no id", () => {
    const main: ShellRun = { label: 'Dev server', startedAt: NOW - MIN, state: 'running' }
    const [, row] = rowsOf({ agents: [{ name: 'old-format', lastAt: NOW, busy: 0 }] }, [main], NOW)
    expect(row?.owner).toBeUndefined()
  })
})

describe('stalled reads loud', () => {
  const stalled = { ...IDLE, agents: [{ id: 'a-sim', name: 'simclasses', lastAt: NOW - 2 * MIN, busy: 0, isTeammate: true, phase: 'idle' as const, phaseAt: NOW - 2 * MIN }] }
  const runs = [shell('ended')]

  test('the status line counts it in the first line, and names it with why in the alert line', () => {
    const lines = statusLines(STATUS, stalled, NOW, 160, 120, runs).map(plainText)
    expect(lines[0]).toContain('1 agent · ✖ 1 stalled')
    expect(statusLines(STATUS, stalled, NOW, 160, 120, runs)[0]?.find(seg => seg.t.includes('stalled'))?.tone).toBe('bad')
    expect(lines.find(l => l.startsWith('⚠'))).toContain('agent stalled 1 min: simclasses')
  })

  test('an answer owed ten minutes is an amber alert naming who owes it', () => {
    const owed = { ...IDLE, agents: [{ id: 'a-hud', name: 'hudwatch', lastAt: NOW - 12 * MIN, busy: 0, phase: 'idle' as const, phaseAt: NOW - 12 * MIN, sentAt: NOW - 12 * MIN, sentTo: 'team-lead' }] }
    const alerts = statusLines(STATUS, owed, NOW, 160, 120).map(plainText).find(l => l.startsWith('⚠'))
    expect(alerts).toBe('⚠ hudwatch has waited on team-lead for 12 min')
  })

  test('the band counts it in red on its second line, whatever the width', () => {
    for (const w of [160, 90]) {
      const [, where] = bandLines(bandOf(STATUS, stalled, runs), w, 3)
      const parts = where?.left.flatMap(item => item.parts) ?? []
      expect(parts.find(p => p.kind === 'text' && p.t.includes('1 stalled'))).toEqual(expect.objectContaining({ color: '#f7768e' }))
    }
  })
})
