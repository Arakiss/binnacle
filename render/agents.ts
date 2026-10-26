// How an agent's or a shell's liveness reads: its sign, its tone and its word. Stalled is the one
// loud state; unknown says so instead of passing for waiting.

import { t, tn } from '../i18n'
import { tally, verdictOf, type Liveness, type Tally, type Verdict } from '../model/liveness'
import type { ShellRun } from '../model/shells'
import type { AgentPulse } from '../types'
import type { Line, Tone } from './text'

export const SIGN: Record<Liveness, string> = { working: '●', waiting: '◔', stalled: '✖', done: '✓', unknown: '?' }

export const TONE: Record<Liveness, Tone> = { working: 'accent', waiting: 'plain', stalled: 'bad', done: 'good', unknown: 'warn' }

/** A liveness in the active language: "working", "waiting"… */
export function word(state: Liveness): string {
  if (state === 'working') return t('state.working')
  if (state === 'waiting') return t('state.waiting')
  if (state === 'stalled') return t('state.stalled')
  if (state === 'done') return t('state.done')
  return t('state.unknown')
}

export type Judged = { agent: AgentPulse; verdict: Verdict }

/** Every active agent with its verdict at `now`. */
export function judged(agents: readonly AgentPulse[] = [], runs: readonly ShellRun[], now: number): Judged[] {
  return agents.map(agent => ({ agent, verdict: verdictOf(agent, runs, now) }))
}

export const tallyOf = (list: readonly Judged[]): Tally => tally(list.map(j => j.verdict))

/**
 * The agents in the status line's first line: how many, then the stalled in red and the unknown
 * in amber, so a stall reads at a glance; waiting and working are the count's plain remainder.
 */
export function agentCount(list: readonly Judged[]): Line[] {
  if (list.length === 0) return []
  const n = tallyOf(list)
  const parts: Line[] = [[{ t: tn('count.agents', list.length) }]]
  if (n.stalled > 0) parts.push([{ t: `${SIGN.stalled} ${tn('count.stalled', n.stalled)}`, tone: 'bad' }])
  if (n.unknown > 0) parts.push([{ t: tn('count.unknown', n.unknown), tone: 'warn' }])
  return parts
}
