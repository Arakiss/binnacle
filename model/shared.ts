// What the mod writes for the status line, from the session's values: small, and only what the
// status line draws (the pane reads the values themselves).

import type { Activity, AgentPulse, Call, Ci, Git, Mode, Peer, Sample, Shared, Shell } from '../types'
import { activeAgents, currentCall, previousCall } from './activity'
import { crowdOf, recent } from './signals'

/** Each active agent with the facts model/liveness.ts judges it by; what is unknown stays out. */
export function pulses(a: Activity): AgentPulse[] {
  return activeAgents(a).map(run => {
    const { id, name, lastAt, busy, isTeammate, phase, phaseAt, status, reportedAt, sentAt, sentTo, heardAt, monitors, workflow, doing } = run
    const facts = { isTeammate, phase, phaseAt, status, reportedAt, sentAt, sentTo, heardAt, monitors: monitors?.length ? monitors : undefined, workflow, doing }
    const known = Object.fromEntries(Object.entries(facts).filter(([, value]) => value !== undefined))
    return { id, name, lastAt, busy, ...known }
  })
}

export type Values = {
  now: number
  mode: Mode
  activity: Activity
  git: Git | null
  ci: Ci | null
  peers: readonly Peer[]
  loops: number
  history: Record<string, Sample[]>
  shells?: readonly Shell[]
  /** Whether the band above the prompt draws the HUD now. */
  band?: boolean
  /** The language the words are in. */
  language?: string
}

export function shareOf(v: Values): Shared {
  const a = v.activity
  const words = (c: Call | undefined) => (c === undefined ? undefined : (c.said ?? `${c.tool} ${c.target}`.trim()))
  const call = currentCall(a)
  const doing = words(call)
  const previous = words(previousCall(a))
  const agents = pulses(a)
  const runIds = new Set(agents.flatMap(agent => (agent.workflow === undefined ? [] : [agent.workflow])))
  const workflows = Object.fromEntries(Object.entries(a.workflows ?? {}).filter(([id]) => runIds.has(id)))
  return {
    mode: v.mode,
    git: v.git,
    ci: v.ci,
    crowd: crowdOf(v.peers, v.git?.root),
    loops: v.loops,
    history: recent(v.history, v.now),
    turn: a.turn && { startedAt: a.turn.startedAt, actions: a.turn.actions, denials: a.turn.denials, tool: call?.tool ?? null, ...(doing ? { doing } : {}), ...(previous ? { previous } : {}) },
    last: a.last,
    agents,
    shells: [...(v.shells ?? [])],
    ...(Object.keys(workflows).length > 0 ? { workflows } : {}),
    ...(v.band ? { band: true } : {}),
    ...(v.language && v.language !== 'en' ? { language: v.language } : {}),
  }
}
