// Whether each agent and background shell works, waits on something that will wake it, stalled
// with nothing that will, or is done; `unknown` wherever binnacle cannot see. Pure: the mod, the
// status line and tools/liveness.ts read the same verdicts from the same facts and clock.
//
// Measured: a background command a subagent or a teammate started does not wake it when it ends,
// while a message does. A running shell is a wait, then, but not a waker: the moment it ends, an
// idle owner has nothing left.

import { t } from '../i18n'
import { duration } from '../render/format'
import type { AgentPulse } from '../types'
import { isRest } from './activity'
import type { ShellRun } from './shells'

export type Liveness = 'working' | 'waiting' | 'stalled' | 'done' | 'unknown'

/** Something that may end an agent's idle; `wakes` false when its end will not. */
export type Waker = { kind: 'engine' | 'reply' | 'monitor' | 'shell'; wakes: boolean; why: string }

/** What binnacle says of one agent or shell: the state, since when, and why. */
export type Verdict = { state: Liveness; since: number; why: string; wakers: Waker[] }

/** An agent as any drawing site holds it; the mod's own carry an end and the idle hook's last word. */
export type Agent = AgentPulse & { endedAt?: number; nudgedAt?: number }

/** Why the engine's word ended an agent. */
function endedWhy(status: string): string | undefined {
  if (status === 'completed') return t('why.completed')
  if (status === 'failed') return t('why.failed')
  if (status === 'killed') return t('why.stopped')
  return undefined
}

/** The shells an agent's own calls started. */
export function ownShells(agent: Agent, runs: readonly ShellRun[]): ShellRun[] {
  return agent.id === undefined ? [] : runs.filter(r => r.agentId === agent.id)
}

/** What could still end an agent's idle at `now`: the engine's hold, an answer owed, a monitor, a shell. */
export function wakersOf(agent: Agent, runs: readonly ShellRun[], now: number): Waker[] {
  const out: Waker[] = []
  if (agent.status === 'waiting') out.push({ kind: 'engine', wakes: true, why: t('why.heldByEngine') })
  if (agent.sentAt !== undefined && agent.sentAt > (agent.heardAt ?? -Infinity)) {
    out.push({ kind: 'reply', wakes: true, why: t('why.waitsOn', { who: agent.sentTo ?? '?' }) })
  }
  for (const m of agent.monitors ?? []) {
    if (m.until === undefined || m.until > now) out.push({ kind: 'monitor', wakes: true, why: t('why.monitorArmed') })
  }
  for (const r of ownShells(agent, runs)) {
    if (r.state !== 'running') continue
    out.push({ kind: 'shell', wakes: false, why: t('why.shellWillNotWake', { label: r.label }) })
  }
  return out
}

/** Why an idle agent with no waker is stalled, and since when: the latest wait that went away. */
function stallOf(agent: Agent, runs: readonly ShellRun[], idleAt: number, now: number): { since: number; why: string } {
  let since = idleAt
  let why = agent.heardAt !== undefined && agent.heardAt > (agent.sentAt ?? -Infinity) ? t('why.unanswered') : t('why.idleNothingWakes')
  for (const r of ownShells(agent, runs)) {
    if (r.state === 'ended' && r.endedAt !== null && r.endedAt >= since) {
      since = r.endedAt
      why = t('why.shellEnded', { label: r.label })
    }
  }
  for (const m of agent.monitors ?? []) {
    if (m.until !== undefined && m.until >= since && m.until <= now) {
      since = m.until
      why = t('why.monitorExpired')
    }
  }
  return { since, why }
}

/** The verdict on one agent at `now`, from its facts and the session's shells. */
export function verdictOf(agent: Agent, runs: readonly ShellRun[], now: number): Verdict {
  const verdict = (state: Liveness, since: number, why: string, wakers: Waker[] = []): Verdict => ({ state, since, why, wakers })
  // A teammate the engine calls completed while still active is idle, not done (see isRest).
  const ended = agent.status === undefined || !isRest(agent.status, agent.isTeammate === true && agent.endedAt === undefined) ? undefined : endedWhy(agent.status)
  if (ended !== undefined) return verdict('done', agent.endedAt ?? agent.phaseAt ?? agent.lastAt, ended)
  if (agent.endedAt !== undefined) {
    if (agent.reportedAt !== undefined) return verdict('done', agent.reportedAt, t('why.reported'))
    return verdict('unknown', agent.endedAt, t('why.vanished'))
  }
  if (agent.busy > 0) return verdict('working', agent.phaseAt ?? agent.lastAt, t('why.callInFlight'))
  if (agent.phase === 'turn') return verdict('working', agent.phaseAt ?? agent.lastAt, t('why.inTurn'))
  if (agent.phase === undefined) {
    if (agent.status === 'running') return verdict('working', agent.lastAt, t('why.engineSaysRunning'))
    if (agent.status === 'idle') return verdict('unknown', agent.lastAt, t('why.idleElsewhere'))
    return verdict('unknown', agent.lastAt, t('why.noLoopEvent'))
  }
  const idleAt = agent.phaseAt ?? agent.lastAt
  const wakers = wakersOf(agent, runs, now)
  if (wakers.length > 0) return verdict('waiting', idleAt, wakers.map(w => w.why).join(' · '), wakers)
  const stall = stallOf(agent, runs, idleAt, now)
  return verdict('stalled', stall.since, stall.why)
}

/** A background shell's verdict: it runs, it ended (how), or its output is gone and nobody knows. */
export function shellVerdict(run: ShellRun): Verdict {
  const verdict = (state: Liveness, since: number, why: string): Verdict => ({ state, since, why, wakers: [] })
  if (run.state === 'running') return verdict('working', run.startedAt, t('why.running'))
  if (run.endedAt === null) return verdict('unknown', run.startedAt, t('why.outputGone'))
  if (run.code === null) return verdict('done', run.endedAt, t('why.stopped'))
  return verdict('done', run.endedAt, t('why.exitCode', { code: run.code }))
}

export type Tally = Record<Liveness, number>

export function tally(verdicts: readonly Verdict[]): Tally {
  const out: Tally = { working: 0, waiting: 0, stalled: 0, done: 0, unknown: 0 }
  for (const v of verdicts) out[v.state] += 1
  return out
}

/** «a», «b»: labels quoted for a sentence. */
const quoted = (runs: readonly ShellRun[]) => runs.map(r => t('quote', { text: r.label })).join(', ')

/**
 * What the idle hook tells a teammate about to go idle, or null when it may: something will wake
 * it, or it was already told since the last message it got (a second silent idle is the lead's).
 */
export function idleNudge(agent: Agent, runs: readonly ShellRun[], now: number): string | null {
  if (agent.nudgedAt !== undefined && (agent.heardAt ?? -Infinity) <= agent.nudgedAt) return null
  const wakers = wakersOf(agent, runs, now)
  if (wakers.some(w => w.wakes)) return null
  const shells = ownShells(agent, runs).filter(r => r.state === 'running')
  if (shells.length > 0) return t('nudge.idleOnShell', { shells: quoted(shells) })
  return t('nudge.idle')
}

/** What the stop hook tells a subagent ending with its own shells still running, or null. */
export function stopNudge(agent: Agent, runs: readonly ShellRun[], isRetry: boolean): string | null {
  if (isRetry || agent.nudgedAt !== undefined) return null
  const running = ownShells(agent, runs).filter(r => r.state === 'running')
  if (running.length === 0) return null
  return t('nudge.stop', { shells: quoted(running) })
}

/** What wakes the main loop when one of its agents stalled. */
export function leadNote(name: string, verdict: Verdict, now: number): string {
  return t('nudge.lead', { name, time: duration(now - verdict.since), why: verdict.why })
}

/** What wakes an idle teammate when a shell of its ended: binnacle is the waker it lacked. */
export function shellNote(run: ShellRun, output: string): string {
  const how = run.state === 'ended' && run.code !== null ? t('nudge.withCode', { code: run.code }) : t('nudge.withoutCode')
  return t('nudge.shellEnded', { label: run.label, how, output })
}
