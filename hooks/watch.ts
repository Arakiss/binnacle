// The engine's side of liveness: reads how each background shell stands, answers the classic idle
// and stop events of agents, and on the clock wakes whoever nothing else would. The judgement is
// model/liveness.ts's; this only reads, writes and sends.

import { atom, read, update } from 'claude-code'
import type { EngineInterface as Engine } from 'claude-code'

import * as act from '../model/activity'
import { idleNudge, leadNote, shellNote, stopNudge, verdictOf } from '../model/liveness'
import { isOutputPath, runOf, shellTold, TAIL_BYTES, type Probe, type ShellRun } from '../model/shells'
import type { Shell } from '../types'

// The same values register.tsx keeps: an atom is its plugin and key, and the engine's scan reads
// each where it is written, so this module names the three it touches itself.
const activity = atom({ plugin: 'binnacle', key: 'activity' } as const, act.EMPTY)
const shells = atom({ plugin: 'binnacle', key: 'shells' } as const, [])
const wake = atom({ plugin: 'binnacle', key: 'wake' } as const, true)

/** Past this size an output file is a log too big to read whole; its shell counts as running. */
const OUTPUT_READ_MAX = 256 * 1024

/**
 * What the output file of a shell says, as tools/liveness.ts reads it too: null when it is gone, an empty
 * tail (still running) when it is too big to read whole, since $.fs reads whole files.
 */
async function probeShell($: Engine, shell: Shell): Promise<Probe> {
  if (!isOutputPath(shell.output)) return null
  try {
    const stat = await $.fs.stat(shell.output)
    if (stat.kind !== 'file') return null
    if (stat.size > OUTPUT_READ_MAX) return { tail: '', mtimeMs: stat.mtimeMs }
    const text = await $.fs.read(shell.output)
    return { tail: typeof text === 'string' ? text.slice(-TAIL_BYTES) : '', mtimeMs: stat.mtimeMs }
  } catch {
    return null
  }
}

/** The shells as they stand now; a stopped one is not read at all. */
export async function runsOf($: Engine, list: readonly Shell[]): Promise<ShellRun[]> {
  return Promise.all(list.map(async shell => runOf(shell, shell.stoppedAt === undefined ? await probeShell($, shell) : null)))
}

/** The agent and the session's shells as they stand now, or null for an agent the HUD never saw. */
async function standing($: Engine, agentId: string) {
  const run = (await read($, activity)).agents.find(r => r.id === agentId)
  if (run === undefined) return null
  return { run, runs: await runsOf($, await read($, shells)), now: await $.clock.now() }
}

/**
 * A teammate about to go idle: the words that send it back to work when nothing would wake it,
 * once per message it gets; null lets it idle.
 */
export async function teammateIdle($: Engine, agentId: string): Promise<string | null> {
  const s = await standing($, agentId)
  if (s === null) return null
  const text = idleNudge({ ...s.run, phase: 'idle', phaseAt: s.now }, s.runs, s.now)
  if (text !== null) await update($, activity, a => act.agentNudged(a, agentId, s.now))
  return text
}

/** A subagent about to end with its own shells still running: the words that hold it, once. */
export async function subagentStop($: Engine, agentId: string, isRetry: boolean): Promise<string | null> {
  const s = await standing($, agentId)
  if (s === null || s.run.isTeammate) return null
  const text = stopNudge(s.run, s.runs, isRetry)
  if (text !== null) await update($, activity, a => act.agentNudged(a, agentId, s.now))
  return text
}

/** How long a stall stands before the lead is told: time for a late event or a wake to land. */
export const TELL_AFTER_MS = 30_000

/**
 * On the clock. An idle teammate whose shell ended after it went idle is told so, once: the HUD is
 * the waker the shell is not. An agent stalled TELL_AFTER_MS wakes the main loop with a note, once
 * per stall, unless `/binnacle wake off`.
 */
export async function watch($: Engine): Promise<void> {
  const a = await read($, activity)
  // Only an idle agent can be told or stall: with none, nothing else is read.
  if (!act.activeAgents(a).some(run => run.phase === 'idle')) return
  const now = await $.clock.now()
  const list = await read($, shells)
  const runs = await runsOf($, list)

  for (const [i, shell] of list.entries()) {
    const run = runs[i]
    const agent = a.agents.find(r => r.id === shell.agentId)
    if (run === undefined || run.state !== 'ended' || run.endedAt === null || shell.toldAt !== undefined) continue
    if (agent === undefined || !agent.isTeammate || agent.phase !== 'idle' || agent.endedAt !== undefined) continue
    if (run.endedAt < (agent.phaseAt ?? Infinity)) continue
    await update($, shells, before => shellTold(before, shell.id, now))
    await $.session.send({ to: { agentId: agent.id }, text: shellNote(run, shell.output) })
  }

  if (!(await read($, wake))) return
  const stalled = act
    .activeAgents(a)
    .map(agent => ({ agent, verdict: verdictOf(agent, runs, now) }))
    .filter(({ agent, verdict }) => verdict.state === 'stalled' && now - verdict.since >= TELL_AFTER_MS && agent.toldAt !== verdict.since)
  if (stalled.length === 0) return
  await update($, activity, before => stalled.reduce((b, { agent, verdict }) => act.stallTold(b, agent.id, verdict.since), before))
  await $.prompt.submit({ text: stalled.map(({ agent, verdict }) => leadNote(agent.name, verdict, now)).join('\n') })
}
