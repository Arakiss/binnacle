// What needs the user now: the status line's alert line, the band's alerts and the pane's last
// section read the same list, most severe first, each item with the step that resolves it.

import { t, tn } from '../i18n'
import { duration } from '../render/format'
import type { AgentPulse, Ci } from '../types'
import { STALL_MS } from './activity'
import { verdictOf } from './liveness'
import type { ShellRun } from './shells'

export type Alert = {
  /** Which condition raised it; the band reads `crowd` as a quiet fact rather than an alarm. */
  kind: 'ci' | 'loops' | 'crowd' | 'denials' | 'stalled' | 'quiet' | 'owed'
  tone: 'bad' | 'warn'
  /** The alert in full words. */
  text: string
  /** The same, shorter, for a narrow terminal. */
  short: string
  /** What resolves it. */
  fix: string
  /** The agent it names, and since when, for an agent's alert. */
  agent?: { name: string; since: number; why: string }
}

export type AlertInput = {
  now: number
  ci?: Ci | null
  crowd?: number
  turnDenials?: number
  loops?: number
  agents?: AgentPulse[]
  /** The session's shells, which say whether an agent still waits on one. */
  runs?: readonly ShellRun[]
}

export function alertsOf(input: AlertInput): Alert[] {
  const alerts: Alert[] = []
  const { ci, crowd = 0, turnDenials = 0, loops = 0, agents = [], runs = [], now } = input

  if (ci && ci.fail > 0) {
    const total = ci.pass + ci.fail + ci.pending
    alerts.push({ kind: 'ci', tone: 'bad', text: t('alert.ci', { fail: ci.fail, total }), short: t('alert.ci.short'), fix: t('alert.ci.fix') })
  }
  if (loops > 0) {
    alerts.push({ kind: 'loops', tone: 'bad', text: tn('alert.loops', loops), short: tn('alert.loops.short', loops), fix: t('alert.loops.fix') })
  }
  if (crowd > 0) {
    alerts.push({ kind: 'crowd', tone: 'warn', text: tn('alert.crowd', crowd), short: tn('alert.crowd.short', crowd), fix: t('alert.crowd.fix') })
  }
  if (turnDenials > 0) {
    alerts.push({ kind: 'denials', tone: 'warn', text: tn('alert.denials', turnDenials), short: tn('alert.denials.short', turnDenials), fix: t('alert.denials.fix') })
  }
  for (const agent of agents) {
    const verdict = verdictOf(agent, runs, now)
    const named = { name: agent.name, since: verdict.since, why: verdict.why }
    if (verdict.state === 'stalled') {
      alerts.push({
        kind: 'stalled',
        tone: 'bad',
        text: t('alert.stalled', { name: agent.name, time: duration(now - verdict.since) }),
        short: t('alert.stalled.short', { name: agent.name }),
        fix: t('alert.stalled.fix', { why: verdict.why }),
        agent: named,
      })
      continue
    }
    // Waiting this long on an answer: whoever it wrote to owes the next move, an answer or a close.
    const asked = agent.sentAt ?? now
    if (verdict.state === 'waiting' && verdict.wakers.some(w => w.kind === 'reply') && now - asked >= STALL_MS) {
      alerts.push({
        kind: 'owed',
        tone: 'warn',
        text: t('alert.owed', { name: agent.name, who: agent.sentTo ?? '?', time: duration(now - asked) }),
        short: t('alert.owed.short', { name: agent.name }),
        fix: t('alert.owed.fix'),
        agent: { ...named, since: asked },
      })
      continue
    }
    // In a turn, yet no step and no call for this long: a hung request, or a loop that lost its way.
    const silent = now - agent.lastAt
    if (verdict.state !== 'working' || agent.busy > 0 || silent < STALL_MS) continue
    alerts.push({
      kind: 'quiet',
      tone: 'warn',
      text: t('alert.quiet', { name: agent.name, time: duration(silent) }),
      short: t('alert.quiet.short', { name: agent.name }),
      fix: t('alert.quiet.fix'),
      agent: { ...named, since: agent.lastAt, why: t('why.silentTurn') },
    })
  }

  return [...alerts.filter(a => a.tone === 'bad'), ...alerts.filter(a => a.tone === 'warn')]
}
