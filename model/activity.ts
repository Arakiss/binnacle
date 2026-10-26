// Pure reducers from the session's events to what the HUD shows. Every list is bounded, every
// reducer tolerates a missing or repeated event (a reload mid-turn, an agent's first call
// arriving before its spawn settles), and none of them reads the clock: `at` is passed in.

import type { Activity, AgentRun, Block, Call, Compaction, FileTouch, Note, Watch } from '../types'
import { t } from '../i18n'
import { firstLine } from '../render/format'

export const LIMITS = {
  calls: 50,
  files: 100,
  agents: 40,
  skills: 50,
  blocks: 20,
  compactions: 20,
  notes: 20,
  checks: 20,
  target: 200,
  reason: 300,
}

export const EMPTY: Activity = {
  turn: null,
  last: null,
  calls: [],
  agents: [],
  files: [],
  skills: [],
  denials: [],
  errors: [],
  deniedTotal: 0,
  errorTotal: 0,
  compactions: [],
  notes: [],
  checks: {},
}

const FILE_TOOLS = new Set(['Edit', 'Write', 'NotebookEdit', 'MultiEdit'])

const cut = (text: string, max: number) => (text.length <= max ? text : `${text.slice(0, max - 1)}…`)

function str(args: Record<string, unknown>, key: string): string | undefined {
  const value = args[key]
  return typeof value === 'string' && value !== '' ? value : undefined
}

/** A path relative to the session's folder when it lies inside it. */
export function relative(path: string, cwd: string): string {
  if (cwd !== '' && path.startsWith(`${cwd}/`)) return path.slice(cwd.length + 1)
  return path
}

/** The file a call edits, or undefined for a tool that edits none. */
export function editedFile(tool: string, args: Record<string, unknown>): string | undefined {
  if (!FILE_TOOLS.has(tool)) return undefined
  return str(args, 'file_path') ?? str(args, 'notebook_path')
}

/** One line saying what a call acts on: the command, the file, the task, the host. */
export function summarize(tool: string, args: Record<string, unknown>, cwd: string): string {
  const path = str(args, 'file_path') ?? str(args, 'notebook_path')
  let text: string | undefined
  if (tool === 'Bash') text = str(args, 'command')
  else if (path !== undefined) text = relative(path, cwd)
  else if (tool === 'Agent' || tool === 'Task') text = str(args, 'description') ?? str(args, 'subagent_type')
  else if (tool === 'Skill') text = str(args, 'skill')
  else if (tool === 'SendMessage') {
    const to = str(args, 'to')
    const said = str(args, 'summary') ?? str(args, 'message')
    text = [to === undefined ? '' : `→ ${to}`, said ?? ''].filter(Boolean).join(': ')
  }
  else if (tool === 'WebFetch') {
    const url = str(args, 'url') ?? ''
    try {
      text = new URL(url).host
    } catch {
      text = url
    }
  } else if (tool === 'Grep' || tool === 'Glob') {
    const pattern = str(args, 'pattern')
    const where = str(args, 'path')
    text = pattern === undefined ? where : where === undefined ? pattern : t('call.patternIn', { pattern, where: relative(where, cwd) })
  } else {
    for (const key of ['description', 'query', 'pattern', 'path', 'url', 'subject', 'name', 'prompt']) {
      text = str(args, key)
      if (text !== undefined) break
    }
  }
  return cut(firstLine(text ?? ''), LIMITS.target)
}

/** The words a call gave for itself (its `description`), shortened; undefined when it gave none. */
export function described(args: Record<string, unknown>): string | undefined {
  const said = str(args, 'description')
  return said === undefined ? undefined : cut(firstLine(said), LIMITS.target)
}

/** What became of a call, from what `next(e)` resolved and what `tool.check` said of it. */
export function outcomeOf(
  ran: { deny?: string; isError?: true; text?: string },
  checkReason?: string,
): { outcome: Exclude<Call['outcome'], 'running'>; reason?: string } {
  if (ran.deny !== undefined) return { outcome: 'denied', reason: cut(firstLine(ran.deny), LIMITS.reason) }
  if (ran.isError === true) {
    if (checkReason !== undefined) return { outcome: 'denied', reason: cut(firstLine(checkReason), LIMITS.reason) }
    return { outcome: 'error', reason: cut(firstLine(ran.text ?? ''), LIMITS.reason) }
  }
  return { outcome: 'ok' }
}

function touchAgent(agents: AgentRun[], id: string, at: number, change: (a: AgentRun) => AgentRun): AgentRun[] {
  const found = agents.find(a => a.id === id)
  const base: AgentRun = found ?? { id, name: id.slice(0, 8), type: '', startedAt: at, lastAt: at, actions: 0, busy: 0 }
  const next = change(base)
  const rest = agents.filter(a => a.id !== id)
  return [...rest, next].slice(-LIMITS.agents)
}

/** An agent's loop seen at work: a turn starts unless one already runs. */
const inTurn = (run: AgentRun, at: number): AgentRun => (run.phase === 'turn' ? run : { ...run, phase: 'turn', phaseAt: at })

export type CallStart = { id: string; at: number; agentId?: string; tool: string; target: string; said?: string }

const callStart = ({ said, ...call }: CallStart) => (said === undefined ? call : { ...call, said })

export function callStarted(a: Activity, call: CallStart): Activity {
  if (a.calls.some(c => c.id === call.id)) return a
  const entry: Call = { ...callStart(call), outcome: 'running' }
  const isMain = call.agentId === undefined
  return {
    ...a,
    calls: [...a.calls, entry].slice(-LIMITS.calls),
    turn: isMain && a.turn !== null ? { ...a.turn, actions: a.turn.actions + 1 } : a.turn,
    agents:
      call.agentId === undefined
        ? a.agents
        : touchAgent(a.agents, call.agentId, call.at, run => ({
            ...inTurn(run, call.at),
            lastAt: call.at,
            actions: run.actions + 1,
            busy: run.busy + 1,
            endedAt: undefined,
            doing: { id: call.id, tool: call.tool, text: call.said ?? call.target, at: call.at, running: true },
          })),
  }
}

export type CallEnd = CallStart & {
  endedAt: number
  ran: { deny?: string; isError?: true; text?: string }
  file?: string
}

export function callEnded(a: Activity, end: CallEnd): Activity {
  const { outcome, reason } = outcomeOf(end.ran, a.checks[end.id])
  const { [end.id]: _checked, ...checks } = a.checks
  const ms = Math.max(0, end.endedAt - end.at)

  const known = a.calls.some(c => c.id === end.id)
  const calls = known
    ? a.calls.map(c => (c.id === end.id ? { ...c, outcome, reason, ms } : c))
    : [...a.calls, { ...callStart({ id: end.id, at: end.at, agentId: end.agentId, tool: end.tool, target: end.target, said: end.said }), outcome, reason, ms }].slice(
        -LIMITS.calls,
      )

  const block: Block = { at: end.endedAt, tool: end.tool, target: end.target, reason: reason ?? '', agentId: end.agentId, ...(end.said === undefined ? {} : { said: end.said }) }
  const isDenied = outcome === 'denied'
  const isError = outcome === 'error'

  let files = a.files
  if (outcome === 'ok' && end.file !== undefined) {
    const before = files.find(f => f.path === end.file)
    const touched: FileTouch = { path: end.file, edits: (before?.edits ?? 0) + 1, lastAt: end.endedAt }
    files = [touched, ...files.filter(f => f.path !== end.file)].slice(0, LIMITS.files)
  }

  return {
    ...a,
    calls,
    checks,
    files,
    denials: isDenied ? [...a.denials, block].slice(-LIMITS.blocks) : a.denials,
    errors: isError ? [...a.errors, block].slice(-LIMITS.blocks) : a.errors,
    deniedTotal: a.deniedTotal + (isDenied ? 1 : 0),
    errorTotal: a.errorTotal + (isError ? 1 : 0),
    turn: isDenied && a.turn !== null ? { ...a.turn, denials: a.turn.denials + 1 } : a.turn,
    agents:
      end.agentId === undefined || !known
        ? a.agents
        : touchAgent(a.agents, end.agentId, end.endedAt, run => ({
            ...run,
            lastAt: end.endedAt,
            busy: Math.max(0, run.busy - 1),
            ...(run.doing?.id === end.id ? { doing: { ...run.doing, running: false } } : {}),
          })),
  }
}

/** `tool.check` refused a real call: kept until its result says how it ended. */
export function checkDenied(a: Activity, id: string, reason: string): Activity {
  const entries = Object.entries({ ...a.checks, [id]: reason }).slice(-LIMITS.checks)
  return { ...a, checks: Object.fromEntries(entries) }
}

export type Spawn = { id: string; name: string; type: string; isBackground: boolean; isTeammate?: boolean; workflow?: string; at: number }

export function agentSpawned(a: Activity, spawn: Spawn): Activity {
  return {
    ...a,
    agents: touchAgent(a.agents, spawn.id, spawn.at, run => ({
      ...(run.phase === undefined ? inTurn(run, spawn.at) : run),
      name: spawn.name,
      type: spawn.type,
      isBackground: spawn.isBackground,
      ...(spawn.isTeammate ? { isTeammate: true } : {}),
      ...(spawn.workflow ? { workflow: spawn.workflow } : {}),
      startedAt: Math.min(run.startedAt, spawn.at),
      lastAt: Math.max(run.lastAt, spawn.at),
    })),
  }
}

/** Names agents first seen through their calls, from `$.agent.list()`. */
export function agentsNamed(a: Activity, infos: readonly { id: string; name?: string; description: string; type: string }[]): Activity {
  const byId = new Map(infos.map(info => [info.id, info]))
  return {
    ...a,
    agents: a.agents.map(run => {
      const info = byId.get(run.id)
      if (info === undefined || run.type !== '') return run
      return { ...run, name: info.name ?? (info.description || info.type), type: info.type }
    }),
  }
}

/** An agent as `$.agent.list()` gives it, reduced to what the HUD reads. */
export type Listed = { id: string; name?: string; teammateId?: string; description: string; type: string; status: string }

// An idle teammate is not over: it waits for a message, and model/liveness.ts says whether one will come.
const RESTING = new Set(['completed', 'failed', 'killed'])
const IDLING = new Set(['idle', 'waiting'])

/**
 * Whether the engine's word ends an agent. A teammate's `completed` does not: the engine has been
 * seen to list an idle teammate as completed the moment the background work it held it `waiting` on
 * ended, with no report sent and nothing to wake it; only a stop (`killed`) or a failure ends one.
 */
export function isRest(status: string, isTeammate: boolean): boolean {
  return RESTING.has(status) && !(isTeammate && status === 'completed')
}

/** An agent seen this recently may not be listed yet: its first call can beat the listing. */
export const LISTING_GRACE_MS = 30_000

/**
 * Without the live list, an agent this long without a step or a call has ended unseen.
 * A foreground Bash call is capped at 10 min and every model step
 * reports, so an hour of silence is no agent at work; long enough that a real stall
 * (STALL_MS) still shows for fifty minutes before it goes.
 */
export const UNLISTED_EXPIRY_MS = 60 * 60_000

/**
 * Ends the agents the live list says are gone or resting and names the ones first seen through
 * their calls. An agent whose `turn.complete` never arrived (a stopped teammate's subagent)
 * otherwise stays active, and stalled, forever. `listed` is null when the list could not be read.
 */
export function agentsReconciled(a: Activity, listed: readonly Listed[] | null, at: number): Activity {
  const byId = listed === null ? null : new Map(listed.map(info => [info.id, info]))
  const isOver = (run: AgentRun): boolean => {
    // The list never holds a workflow's agents: their own turn.complete ends them, the expiry the rest.
    if (byId === null || run.workflow !== undefined) return at - run.lastAt >= UNLISTED_EXPIRY_MS
    const info = byId.get(run.id)
    if (info === undefined) return at - run.lastAt >= LISTING_GRACE_MS
    return isRest(info.status, run.isTeammate === true || info.teammateId !== undefined)
  }
  const ended = a.agents.filter(run => run.endedAt === undefined && isOver(run)).map(run => run.id)
  const named = listed === null ? a : agentsNamed(a, listed)
  const gone = new Set(ended)
  // An agent the list ends keeps the word that ended it, so the pane and the report can say why.
  const over = (run: AgentRun): AgentRun => ({ ...run, busy: 0, endedAt: at, ...(byId?.get(run.id) ? { status: byId.get(run.id)?.status } : {}) })
  return { ...named, agents: named.agents.map(run => (gone.has(run.id) ? over(run) : synced(run, byId?.get(run.id), at))) }
}

/** The session stopped an agent (TaskStop on its id): it is over, whatever the list says next. */
export function agentStopped(a: Activity, id: string, at: number): Activity {
  if (!a.agents.some(run => run.id === id)) return a
  return { ...a, agents: a.agents.map(run => (run.id === id ? { ...run, busy: 0, endedAt: at, status: 'killed' } : run)) }
}

/**
 * The engine's word on one agent folded in. It may start a turn the events missed, never end one
 * the events still show at work: a turn reads idle only after LISTING_GRACE_MS with no step or call.
 */
function synced(run: AgentRun, info: Listed | undefined, at: number): AgentRun {
  if (info === undefined) return run
  const next: AgentRun = { ...run, status: info.status, ...(info.teammateId === undefined ? {} : { isTeammate: true }) }
  if (info.status === 'running' && run.phase === 'idle') return { ...next, phase: 'turn', phaseAt: at }
  const isQuiet = run.busy === 0 && at - run.lastAt >= LISTING_GRACE_MS
  const idles = IDLING.has(info.status) || (next.isTeammate === true && info.status === 'completed')
  if (idles && run.phase === 'turn' && isQuiet) return { ...next, phase: 'idle', phaseAt: run.lastAt }
  return next
}

/** A turn of an agent's loop starts: the spawn's first, or a teammate woken by a message. */
export function agentTurnStarted(a: Activity, id: string, at: number): Activity {
  return { ...a, agents: touchAgent(a.agents, id, at, run => ({ ...run, phase: 'turn', phaseAt: at, lastAt: at, endedAt: undefined })) }
}

/**
 * A subagent's run is one turn: its `turn.complete` is its end, and an answer is its report. A
 * teammate's turn ends in idle instead, until a message wakes it.
 */
export function agentTurnEnded(a: Activity, id: string, at: number, hasReport = false): Activity {
  return {
    ...a,
    agents: touchAgent(a.agents, id, at, run =>
      run.isTeammate
        ? { ...run, lastAt: at, busy: 0, phase: 'idle', phaseAt: at }
        : { ...run, lastAt: at, busy: 0, endedAt: at, ...(hasReport ? { reportedAt: at } : {}) },
    ),
  }
}

/** A message an agent sent (SendMessage out of its loop). */
export function agentSent(a: Activity, id: string, to: string, at: number): Activity {
  return { ...a, agents: touchAgent(a.agents, id, at, run => ({ ...run, sentAt: at, sentTo: cut(to, LIMITS.target) })) }
}

/** A message delivered to an agent. */
export function agentHeard(a: Activity, id: string, at: number): Activity {
  return { ...a, agents: touchAgent(a.agents, id, at, run => ({ ...run, heardAt: at })) }
}

/** The most monitors kept per agent. */
const MONITORS_MAX = 8

/** A Monitor an agent armed. */
export function monitorArmed(a: Activity, id: string, watch: Watch, at: number): Activity {
  return { ...a, agents: touchAgent(a.agents, id, at, run => ({ ...run, monitors: [...(run.monitors ?? []).filter(m => m.id !== watch.id), watch].slice(-MONITORS_MAX) })) }
}

/** A task stopped: if it was a monitor of an agent's, it wakes nobody any more. */
export function monitorStopped(a: Activity, taskId: string): Activity {
  if (!a.agents.some(run => run.monitors?.some(m => m.id === taskId))) return a
  return { ...a, agents: a.agents.map(run => (run.monitors?.some(m => m.id === taskId) ? { ...run, monitors: run.monitors.filter(m => m.id !== taskId) } : run)) }
}

/** The idle hook told an agent it had nothing to wake it. */
export function agentNudged(a: Activity, id: string, at: number): Activity {
  return { ...a, agents: a.agents.map(run => (run.id === id ? { ...run, nudgedAt: at } : run)) }
}

/** The lead was told of the stall that began at `since`. */
export function stallTold(a: Activity, id: string, since: number): Activity {
  return { ...a, agents: a.agents.map(run => (run.id === id ? { ...run, toldAt: since } : run)) }
}

export function turnStarted(a: Activity, id: string, at: number): Activity {
  return { ...a, turn: { id, startedAt: at, steps: 0, actions: 0, denials: 0 } }
}

export function turnEnded(a: Activity, at: number): Activity {
  if (a.turn === null) return a
  const { startedAt, actions, steps } = a.turn
  return { ...a, turn: null, last: { endedAt: at, seconds: Math.round((at - startedAt) / 1000), actions, steps } }
}

export function stepTaken(a: Activity, agentId: string | undefined, at: number): Activity {
  if (agentId === undefined) return a.turn === null ? a : { ...a, turn: { ...a.turn, steps: a.turn.steps + 1 } }
  return { ...a, agents: touchAgent(a.agents, agentId, at, run => ({ ...inTurn(run, at), lastAt: at, endedAt: undefined })) }
}

export function skillLoaded(a: Activity, name: string, at: number): Activity {
  return { ...a, skills: [...a.skills.filter(s => s.name !== name), { name, at }].slice(-LIMITS.skills) }
}

export function compacted(a: Activity, c: Compaction): Activity {
  return { ...a, compactions: [...a.compactions, c].slice(-LIMITS.compactions) }
}

export function noted(a: Activity, note: Note): Activity {
  return { ...a, notes: [...a.notes, { ...note, text: cut(firstLine(note.text), LIMITS.reason) }].slice(-LIMITS.notes) }
}

/** The most workflow names kept; the oldest run goes first. */
const WORKFLOWS_MAX = 20

/** A Workflow call returned its run's id and name: its agents are shown under that name. */
export function workflowNamed(a: Activity, runId: string, name: string): Activity {
  const entries = Object.entries({ ...(a.workflows ?? {}), [runId]: cut(name, 60) }).slice(-WORKFLOWS_MAX)
  return { ...a, workflows: Object.fromEntries(entries) }
}

/** The main loop's last call that ended, newest first. */
export function previousCall(a: Activity): Call | undefined {
  return a.calls.findLast(c => c.agentId === undefined && c.outcome !== 'running')
}

/** The main loop's call running now, newest first. */
export function currentCall(a: Activity): Call | undefined {
  return a.calls.findLast(c => c.agentId === undefined && c.outcome === 'running')
}

export const STALL_MS = 10 * 60_000

/** Agents not finished yet. */
export function activeAgents(a: Activity): AgentRun[] {
  return a.agents.filter(run => run.endedAt === undefined)
}

/** Who made a call: the main loop or the agent's name. */
export function who(a: Activity, agentId: string | undefined): string {
  if (agentId === undefined) return t('who.main')
  return a.agents.find(run => run.id === agentId)?.name ?? agentId.slice(0, 8)
}
