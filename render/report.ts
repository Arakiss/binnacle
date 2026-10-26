// The liveness report tools/liveness.ts prints: a row per active agent and per background shell,
// with how it stands, since when and why. Pure, so the tests read what the command prints.

import { shellVerdict, verdictOf, type Liveness } from '../model/liveness'
import type { ShellRun } from '../model/shells'
import type { Shared } from '../types'
import { t } from '../i18n'
import { word } from './agents'
import { duration } from './format'

export type Row = { kind: 'agent' | 'shell'; name: string; state: Liveness; since: number; why: string; owner?: string }

/** One row per active agent, then one per background shell with the agent that started it. */
export function rowsOf(shared: Shared, runs: readonly ShellRun[], now: number): Row[] {
  const agents = shared.agents ?? []
  // A shell of the main loop's has no owner to name; an agent known by no id owns none.
  const nameOf = (id: string | undefined) => (id === undefined ? undefined : (agents.find(a => a.id === id)?.name ?? id))
  return [
    ...agents.map((agent): Row => {
      const v = verdictOf(agent, runs, now)
      return { kind: 'agent', name: agent.name, state: v.state, since: v.since, why: v.why }
    }),
    ...runs.map((run): Row => {
      const v = shellVerdict(run)
      const owner = nameOf(run.agentId)
      return { kind: 'shell', name: run.label, state: v.state, since: v.since, why: v.why, ...(owner === undefined ? {} : { owner }) }
    }),
  ]
}

/** 3 when an agent stalled, else 0: a script waits on the first, a lead acts on it. */
export const exitOf = (rows: readonly Row[]) => (rows.some(r => r.kind === 'agent' && r.state === 'stalled') ? 3 : 0)

export function lineOf(row: Row, now: number): string {
  const what = row.kind === 'shell' ? `${t('report.shell', { name: row.name })}${row.owner ? ` (${row.owner})` : ''}` : row.name
  return `${word(row.state).padEnd(10)} ${what.padEnd(32)} ${duration(now - row.since).padStart(10)}   ${row.why}`
}
