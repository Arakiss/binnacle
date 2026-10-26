import { atom, read, update } from 'claude-code'
import type { EngineInterface as Engine, PluginOptions, Register } from 'claude-code'

import { DEFAULT_LANGUAGE, dictionaryFrom, language, t, useLanguage } from '../i18n'

import * as act from '../model/activity'
import { shareOf } from '../model/shared'
import { shellAdded, shellFrom, shellStopped, SHELLS_MAX } from '../model/shells'
import { ciFrom, gitFrom, loopsFrom, offsetFrom, peersFrom, prFrom, remember } from '../model/signals'
import { bandLines, budgetNotices, noticesOf, PALETTE, THEME, type Action, type GaugePart, type SpinnerPart } from '../render/band'
import { createBandView } from '../render/band-view'
import { gaugeCells } from '../render/gauge'
import { prettyModel } from '../render/format'
import { paneLines, type PaneInput } from '../render/pane'
import type { Tone } from '../render/text'
import type { Activity, Meter, Mode, Shared, Shell, Snapshot } from '../types'
import { runsOf, subagentStop, teammateIdle, watch } from './watch'

const PANE = 'binnacle'

/** Empty rows above and below the band. */
const BAND_PAD = 1

const snapshot = atom({ plugin: 'binnacle', key: 'snapshot' } as const, null)
const git = atom({ plugin: 'binnacle', key: 'git' } as const, null)
const ci = atom({ plugin: 'binnacle', key: 'ci' } as const, null)
const pr = atom({ plugin: 'binnacle', key: 'pr' } as const, null)
const peers = atom({ plugin: 'binnacle', key: 'peers' } as const, [])
const loops = atom({ plugin: 'binnacle', key: 'loops' } as const, [])
const history = atom({ plugin: 'binnacle', key: 'history' } as const, {})
const mode = atom({ plugin: 'binnacle', key: 'mode' } as const, 'full')
const activity = atom({ plugin: 'binnacle', key: 'activity' } as const, act.EMPTY)
const shells = atom({ plugin: 'binnacle', key: 'shells' } as const, [])
const band = atom({ plugin: 'binnacle', key: 'band' } as const, true)
const tz = atom({ plugin: 'binnacle', key: 'tz' } as const, 0)
const wake = atom({ plugin: 'binnacle', key: 'wake' } as const, true)

/** The options the user set in the plugin's settings; `register` reads them on every load. */
type Settings = { language: string; peersCommand: string[]; watchCodexLoops: boolean; hideModeHint: boolean }

/** A language name safe to read as a file under i18n/: "en", "es", "pt-BR". */
const LANGUAGE_NAME = /^[a-z]{2,3}(?:-[A-Za-z]{2,4})?$/

/** The options as `register` receives them, each checked; a wrong one reads as its default. */
export function settingsOf(options: PluginOptions | undefined): Settings {
  const text = (key: string) => (typeof options?.[key] === 'string' ? (options[key] as string).trim() : '')
  const chosen = text('language')
  return {
    language: LANGUAGE_NAME.test(chosen) ? chosen : DEFAULT_LANGUAGE,
    // A command and its arguments split on spaces, run without a shell.
    peersCommand: text('peersCommand').split(/\s+/).filter(Boolean),
    watchCodexLoops: options?.watchCodexLoops === true,
    hideModeHint: options?.hideModeHint === true,
  }
}

let settings: Settings = settingsOf(undefined)

// The module's own bookkeeping. A reload starts it over; the values above are the host's and stay.
let cwd = ''
let queue: Promise<unknown> = Promise.resolve()
let isDirty = true
let isGitStale = false
let isCiStale = false
let isGitBusy = false
let hasUnnamedAgents = false
const knownAgents = new Set<string>()
let published = ''
/** The effort the main loop's last request asked for, as the band's pill shows it. */
let effort: string | undefined
/** When the session started, from the engine's usage. */
let sessionStartedAt: number | undefined
/** The alerts already announced; null until the first look, which only takes note of what is there. */
let announced: Set<string> | null = null
let lastChimeAt = 0
/** Whether the band drew the HUD last time the engine asked; the status line keeps quiet while it does. */
let isBandDrawn = false
/** Whether the band's last drawing had a row for a background shell. */
let hasBandShells = false

/** Background work never surfaces as a failure: the HUD shows less, the session goes on. */
function quietly(work: Promise<unknown>): void {
  work.catch(() => undefined)
}

/**
 * Runs bookkeeping in order, one task at a time: a hook queues and returns, so no tool call,
 * step or prompt ever waits on the HUD.
 */
function enqueue(task: () => Promise<unknown>): void {
  queue = queue
    .then(task)
    .then(() => {
      isDirty = true
    })
    .catch(() => undefined)
}

/** Applies a reducer to the activity at the time `at` resolves to (now, when left out). */
function record($: Engine, reduce: (a: Activity, at: number) => Activity, at?: Promise<number>): void {
  enqueue(async () => {
    const when = await (at ?? $.clock.now())
    await update($, activity, a => reduce(a, when))
  })
}

async function refreshGit($: Engine): Promise<void> {
  if (isGitBusy) return
  isGitBusy = true
  isGitStale = false
  try {
    cwd = await $.session.cwd()
    const status = await $.process.run(['git', 'status', '--porcelain=v2', '--branch'], { cwd, timeoutMs: 3000 })
    const top = status.exitCode === 0 ? await $.process.run(['git', 'rev-parse', '--show-toplevel'], { cwd, timeoutMs: 3000 }) : null
    const next = top === null || top.exitCode !== 0 ? null : gitFrom(status.stdout, top.stdout.trim())
    await update($, git, () => next)
  } catch {
    await update($, git, () => null)
  } finally {
    isGitBusy = false
    isDirty = true
  }
}

// Each source fails quiet: a command that cannot run hides its signal instead of breaking the HUD.
async function refreshPeers($: Engine): Promise<void> {
  const argv = settings.peersCommand
  if (argv.length === 0) return
  try {
    const ran = await $.process.run(argv, { timeoutMs: 5000 })
    const next = ran.exitCode === 0 ? peersFrom(ran.stdout, await $.session.id()) : []
    await update($, peers, () => next)
  } catch {
    await update($, peers, () => [])
  }
  isDirty = true
}

async function refreshCi($: Engine): Promise<void> {
  isCiStale = false
  try {
    const where = { cwd: await $.session.cwd(), timeoutMs: 15_000 }
    // gh exits non-zero while checks run or fail, and still prints them.
    const [checks, view] = await Promise.all([
      $.process.run(['gh', 'pr', 'checks', '--json', 'bucket'], where),
      $.process.run(['gh', 'pr', 'view', '--json', 'number,reviewDecision,url'], where),
    ])
    const nextCi = ciFrom(checks.stdout)
    const nextPr = view.exitCode === 0 ? prFrom(view.stdout) : null
    await update($, ci, () => nextCi)
    await update($, pr, () => nextPr)
  } catch {
    await update($, ci, () => null)
    await update($, pr, () => null)
  }
  isDirty = true
}

async function refreshLoops($: Engine): Promise<void> {
  if (!settings.watchCodexLoops) return
  try {
    const ran = await $.process.run(['ps', '-Ao', 'pid=,ppid=,command='], { timeoutMs: 3000 })
    const next = ran.exitCode === 0 ? loopsFrom(ran.stdout) : []
    await update($, loops, () => next)
  } catch {
    await update($, loops, () => [])
  }
  isDirty = true
}

async function refreshTz($: Engine): Promise<void> {
  try {
    const ran = await $.process.run(['date', '+%z'], { timeoutMs: 3000 })
    const offset = ran.exitCode === 0 ? offsetFrom(ran.stdout) : null
    if (offset !== null) await update($, tz, () => offset)
  } catch {
    // The pane keeps the last offset it read.
  }
}

// Events alone cannot end an agent whose turn.complete never comes; the live list can.
async function reconcileAgents($: Engine): Promise<void> {
  if (!hasUnnamedAgents && act.activeAgents(await read($, activity)).length === 0) return
  hasUnnamedAgents = false
  let listed: act.Listed[] | null
  try {
    listed = await $.agent.list()
  } catch {
    listed = null
  }
  const now = await $.clock.now()
  await update($, activity, a => act.agentsReconciled(a, listed, now))
  isDirty = true
}

async function recordLimits($: Engine, limits: Meter[]): Promise<void> {
  const now = await $.clock.now()
  await update($, history, before => {
    const next = { ...before }
    for (const limit of limits) next[limit.kind] = remember(before[limit.kind] ?? [], now, limit.percent)
    return next
  })
}

function snapshotOf(e: { context: { percent?: number; tokens?: number; window: number }; rateLimits: readonly { kind: string; percentUsed: number; resetsAt?: string }[]; cost?: { usd: number } }): Snapshot {
  return {
    percent: e.context.percent,
    tokens: e.context.tokens,
    window: e.context.window,
    limits: e.rateLimits.map(r => ({ kind: r.kind, percent: r.percentUsed, resetsAt: r.resetsAt === undefined ? undefined : Date.parse(r.resetsAt) })),
    usd: e.cost?.usd,
  }
}

/** What the status line and the band both draw from, as the session's values stand at `now`. */
async function sharedNow($: Engine, now: number): Promise<Shared> {
  return shareOf({
    now,
    mode: await read($, mode),
    activity: await read($, activity),
    git: await read($, git),
    ci: await read($, ci),
    peers: await read($, peers),
    loops: (await read($, loops)).length,
    history: await read($, history),
    shells: await read($, shells),
    band: isBandDrawn && (await read($, band)),
    language: language(),
  })
}

let stateDir = ''

/**
 * Where the state files live: ~/.claude/binnacle/state, the folder statusline.ts reads, which stays
 * put when an update moves the plugin to a new folder. Without a home, the plugin's own folder.
 */
async function stateDirOf($: Engine): Promise<string> {
  if (stateDir !== '') return stateDir
  try {
    const ran = await $.process.run(['printenv', 'HOME'], { timeoutMs: 2000 })
    const home = ran.exitCode === 0 ? ran.stdout.trim() : ''
    stateDir = home.startsWith('/') ? `${home}/.claude/binnacle/state` : `${$.plugin.root}/state`
  } catch {
    stateDir = `${$.plugin.root}/state`
  }
  return stateDir
}

/**
 * Writes ~/.claude/binnacle/statusline.sh, which runs this version's status line: the path to name
 * in Claude Code's `statusLine`, since an update installs the plugin in a new folder.
 */
async function writeLauncher($: Engine): Promise<void> {
  const dir = await stateDirOf($)
  if (!dir.endsWith('/.claude/binnacle/state')) return
  const quoted = `'${`${$.plugin.root}/statusline.ts`.replaceAll("'", "'\\''")}'`
  const script = `#!/bin/sh\n# Written by binnacle when a session starts: runs the installed version's status line.\nexec bun ${quoted} "$@"\n`
  const path = dir.replace(/\/state$/, '/statusline.sh')
  const before = await $.fs.read(path).catch(() => '')
  if (before !== script) await $.fs.write(path, script)
}

// The status line draws from this file; it is written only when its content changed.
async function publish($: Engine): Promise<void> {
  isDirty = false
  const body = JSON.stringify(await sharedNow($, await $.clock.now()))
  if (body === published) return
  published = body
  await $.fs.write(`${await stateDirOf($)}/${await $.session.id()}.json`, body)
}

/** Ids of the listed shells that ended; read only when the list is full and something must go. */
async function finishedShells($: Engine, list: readonly Shell[]): Promise<Set<string>> {
  const runs = await runsOf($, list)
  return new Set(list.filter((_, i) => runs[i]?.state === 'ended').map(shell => shell.id))
}

function recordShell($: Engine, args: Record<string, unknown>, text: string, startedAt: Promise<number>, agentId?: string): void {
  enqueue(async () => {
    const shell = shellFrom(args, text, await startedAt, agentId)
    if (shell === null) return
    const list = await read($, shells)
    const ended = list.length >= SHELLS_MAX ? await finishedShells($, list) : new Set<string>()
    await update($, shells, before => shellAdded(before, shell, s => ended.has(s.id)))
  })
}

const STOPPERS = new Set(['TaskStop', 'KillShell', 'KillBash'])

const STALE_MS = 7 * 24 * 3_600_000

// A session that ended leaves its state file behind; a week without a write marks it dead.
// $.fs has no delete, so rm runs without a shell on the listed regular files alone.
async function pruneState($: Engine): Promise<void> {
  try {
    const dir = await stateDirOf($)
    if (!(await $.fs.exists(dir))) return
    const cutoff = (await $.clock.now()) - STALE_MS
    const stale = (await $.fs.list(dir))
      .filter(entry => entry.kind === 'file' && !entry.isLink && entry.name.endsWith('.json') && entry.mtimeMs < cutoff)
      .map(entry => `${dir}/${entry.name}`)
    if (stale.length > 0) await $.process.run(['/bin/rm', '-f', '--', ...stale], { timeoutMs: 3000 })
  } catch {
    // Housekeeping never blocks the session.
  }
}

/** Records whether the band draws the HUD; a change reaches the status line at the next publish. */
function bandDrawn(isDrawn: boolean): void {
  if (isDrawn === isBandDrawn) return
  isBandDrawn = isDrawn
  if (!isDrawn) hasBandShells = false
  isDirty = true
}

async function isPaneOpen($: Engine): Promise<boolean> {
  return (await $.ui.panes()).some(pane => pane.id === PANE)
}

/** Opens the /binnacle pane, or closes it when it is open; says which. */
async function togglePane($: Engine): Promise<string> {
  if (await isPaneOpen($)) {
    await $.ui.close({ id: PANE })
    return t('command.paneClosed')
  }
  const opened = await $.ui.open({ id: PANE, title: 'binnacle' })
  return opened.isPlaced ? t('command.paneOpened') : t('command.paneWaits')
}

/** Ends the orphaned codex wrapper loops the HUD reports, after reading them fresh; says how it went. */
async function reapLoops($: Engine): Promise<string> {
  await refreshLoops($)
  const pids = await read($, loops)
  if (pids.length === 0) return t('command.noLoops')
  const ran = await $.process.run(['kill', ...pids.map(String)], { timeoutMs: 3000 })
  await refreshLoops($)
  const left = (await read($, loops)).length
  return ran.exitCode === 0 && left === 0 ? t('command.loopsReaped', { n: pids.length }) : t('command.loopsLeft', { code: ran.exitCode ?? '?', n: left })
}

/** A chime at most this often, however many alerts arrive. */
const CHIME_MS = 60_000

/**
 * Says each alert once, when it first appears: a toast with its words, and a chime when it is red.
 * The first look after a load only takes note, so a reload never repeats what was already said.
 */
async function announce($: Engine): Promise<void> {
  const now = await $.clock.now()
  const shared = await sharedNow($, now)
  const runs = await runsOf($, await read($, shells))
  const notices = [...noticesOf(shared, now, runs), ...budgetNotices(await read($, snapshot), shared, now)]
  const keys = new Set(notices.map(n => n.key))
  const fresh = announced === null ? [] : notices.filter(n => !announced?.has(n.key))
  announced = keys
  if (fresh.length === 0) return
  $.ui.toast(fresh.map(n => `⚠ ${n.long}`).join(' · '), { timeoutMs: 8000 })
  if (fresh.some(n => n.tone === 'bad') && now - lastChimeAt >= CHIME_MS) {
    lastChimeAt = now
    quietly($.audio.play({ asset: 'sounds/alert.wav' }))
  }
}

const MODES: Record<string, Mode> = { full: 'full', compact: 'compact', hidden: 'hidden' }

const SWITCH: Record<string, boolean> = { on: true, yes: true, off: false, no: false }

/** The command's own words, in the active language. */
const help = () => t('command.help')

/** Loads `language`: the built-in dictionary at once, then its JSON on disk over it, when it reads. */
async function loadLanguage($: Engine, chosen: string): Promise<void> {
  useLanguage(chosen)
  try {
    const text = await $.fs.read(`${$.plugin.root}/i18n/${chosen}.json`)
    const dictionary = typeof text === 'string' ? dictionaryFrom(JSON.parse(text)) : null
    if (dictionary !== null) useLanguage(chosen, dictionary)
  } catch {
    // No file, or one that does not parse: the built-in words stand.
  }
}

/** A string field of a tool's arguments, whichever tool table the build laid. */
function argument(e: object, key: string): string {
  const value = (e as Record<string, unknown>)[key]
  return typeof value === 'string' ? value : ''
}

export const register: Register = (on, options) => {
  settings = settingsOf(options)
  useLanguage(settings.language)

  on('session.start', async ($, e, next) => {
    await loadLanguage($, settings.language)
    quietly(pruneState($))
    quietly(writeLauncher($))
    await $.command.register({ name: 'binnacle', description: help() })

    const usage = await $.session.usage()
    sessionStartedAt = usage.startedAt
    const measured = snapshotOf(usage)
    await update($, snapshot, () => measured)
    await recordLimits($, measured.limits)

    // Every source reads after the session is ready, one after another, never in front of it.
    quietly(
      refreshTz($)
        .then(() => refreshGit($))
        .then(() => refreshPeers($))
        .then(() => refreshLoops($))
        .then(() => refreshCi($)),
    )

    let tick = 0
    $.clock.every(1000, () => {
      tick += 1
      if (isGitStale) quietly(refreshGit($))
      if (tick % 10 === 0) quietly(refreshPeers($).then(() => refreshLoops($)))
      if (tick % 120 === 0 || isCiStale) quietly(refreshCi($))
      if (tick % 3600 === 0) quietly(refreshTz($))
      if (tick % 5 === 0) quietly(reconcileAgents($).then(() => watch($)).then(() => announce($)))
      // The pane says "3 min", the band "40 s": a redraw now and then keeps the clock words true.
      if (isBandDrawn && tick % 5 === 0) $.ui.invalidate('ui.render')
      else if (tick % 15 === 0) quietly(isPaneOpen($).then(isOpen => isOpen && $.ui.invalidate('ui.render')))
      if (isDirty) quietly(publish($))
    })

    return next(e)
  })

  on('session.measure', async ($, e, next) => {
    const measured = snapshotOf(e)
    await update($, snapshot, () => measured)
    if (e.changed.includes('rateLimits')) await recordLimits($, measured.limits)
    isDirty = true
    return next(e)
  })

  on('command.run', { command: 'binnacle' }, async ($, e) => {
    const words = e.args.trim().toLowerCase().split(/\s+/).filter(Boolean)
    const [first = '', second = ''] = words

    if (first === '' || first === 'panel') return { text: await togglePane($) }

    // Ends the orphaned codex wrapper loops the HUD reports, after reading them fresh.
    if (first === 'reap') return { text: await reapLoops($) }

    // The band above the prompt, or the status line alone; `/binnacle band` alone flips it.
    if (first === 'band') {
      const isOn = second === '' ? !(await read($, band)) : SWITCH[second]
      if (isOn === undefined) return { text: help() }
      await update($, band, () => isOn)
      if (!isOn) bandDrawn(false)
      $.ui.invalidate('ui.render')
      await publish($)
      return { text: isOn ? t('command.bandOn') : t('command.bandOff') }
    }

    // Whether a stalled agent wakes the main loop with a note; `/binnacle wake` alone flips it.
    if (first === 'wake') {
      const isOn = second === '' ? !(await read($, wake)) : SWITCH[second]
      if (isOn === undefined) return { text: help() }
      await update($, wake, () => isOn)
      return { text: isOn ? t('command.wakeOn') : t('command.wakeOff') }
    }

    // `/binnacle line compact`, and `/binnacle compact` alike.
    const chosen = MODES[first === 'line' ? second : first]
    if (chosen === undefined) return { text: help() }
    await update($, mode, () => chosen)
    await publish($)
    return { text: t('command.line', { mode: chosen === 'full' ? t('mode.full') : chosen === 'compact' ? t('mode.compact') : t('mode.hidden') }) }
  })

  on('turn.start', ($, e, next) => {
    const id = e.turnId
    const agentId = e.agentId
    record($, (a, at) => (agentId === undefined ? act.turnStarted(a, id, at) : act.agentTurnStarted(a, agentId, at)))
    return next(e)
  })

  on('turn.step', async function* ($, e, next) {
    const agentId = e.agentId
    if (agentId === undefined && typeof e.effort === 'string') effort = e.effort
    record($, (a, at) => act.stepTaken(a, agentId, at))
    return yield* next(e)
  })

  on('turn.complete', ($, e, next) => {
    const agentId = e.agentId
    const hasReport = e.reason === 'answer' && e.answer !== ''
    record($, (a, at) => (agentId === undefined ? act.turnEnded(a, at) : act.agentTurnEnded(a, agentId, at, hasReport)))
    if (agentId === undefined) isGitStale = true
    return next(e)
  })

  on('agent.spawn', async ($, e, next) => {
    const started = await next(e)
    if (started.agentId !== undefined) {
      const spawn = {
        id: started.agentId,
        name: e.name ?? (e.description || e.subagentType),
        type: e.subagentType,
        isBackground: e.background,
        isTeammate: e.isTeammate === true,
        ...(e.workflow?.runId ? { workflow: e.workflow.runId } : {}),
      }
      knownAgents.add(spawn.id)
      record($, (a, at) => act.agentSpawned(a, { ...spawn, at }))
    }
    return started
  })

  on('tool.call', async ($, e, next) => {
    const tool = String(e.tool)
    const said = act.described(e as Record<string, unknown>)
    const start = { id: e.tool_use_id, agentId: e.agentId, tool, target: act.summarize(tool, e as Record<string, unknown>, cwd), ...(said === undefined ? {} : { said }) }
    const startedAt = $.clock.now()
    record($, (a, at) => act.callStarted(a, { ...start, at }), startedAt)
    if (e.agentId !== undefined && !knownAgents.has(e.agentId)) {
      knownAgents.add(e.agentId)
      hasUnnamedAgents = true
    }

    const ran = await next(e)

    const endedAt = $.clock.now()
    const edited = act.editedFile(tool, e as Record<string, unknown>)
    const file = edited === undefined ? undefined : act.relative(edited, cwd)
    const outcome = { deny: ran.deny, isError: ran.isError, text: ran.text }
    enqueue(async () => {
      const [at, end] = await Promise.all([startedAt, endedAt])
      await update($, activity, a => act.callEnded(a, { ...start, at, endedAt: end, ran: outcome, file }))
    })
    if (tool === 'Bash' && !ran.isError && !ran.deny) recordShell($, e as Record<string, unknown>, ran.text ?? '', startedAt, e.agentId)
    if (tool === 'Workflow' && !ran.isError && !ran.deny) {
      const launched = ran.result as { runId?: unknown; workflowName?: unknown } | undefined
      const { runId, workflowName } = launched ?? {}
      if (typeof runId === 'string' && typeof workflowName === 'string' && workflowName !== '') record($, a => act.workflowNamed(a, runId, workflowName))
    }
    const owner = e.agentId
    if (tool === 'Monitor' && owner !== undefined && !ran.isError && !ran.deny) {
      const armed = ran.result as { taskId?: unknown; timeoutMs?: unknown; persistent?: unknown } | undefined
      if (typeof armed?.taskId === 'string') {
        const taskId = armed.taskId
        const timeout = armed.persistent === true || typeof armed.timeoutMs !== 'number' || armed.timeoutMs <= 0 ? undefined : armed.timeoutMs
        record($, (a, at) => act.monitorArmed(a, owner, { id: taskId, ...(timeout === undefined ? {} : { until: at + timeout }) }, at), startedAt)
      }
    }
    const stopped = argument(e, 'task_id') || argument(e, 'shell_id')
    if (STOPPERS.has(tool) && stopped !== '') {
      enqueue(async () => {
        const at = await endedAt
        await update($, shells, list => shellStopped(list, stopped, at))
        // A stop that failed stops nobody; one that worked ends the monitor or the agent of that id.
        if (!ran.isError && ran.deny === undefined) await update($, activity, a => act.agentStopped(act.monitorStopped(a, stopped), stopped, at))
      })
    }
    if (tool === 'Bash' || edited !== undefined) isGitStale = true
    if (tool === 'Bash' && /\b(git push|gh pr)\b/.test(argument(e, 'command'))) isCiStale = true

    return ran
  })

  // The verdict a rule, a mode or a PreToolUse hook gave: the call's result then arrives as an
  // error, and this says it was a refusal, with its reason.
  on('tool.check', async ($, e, next) => {
    const verdict = await next(e)
    const id = e.tool_use_id
    if (verdict.decision === 'deny' && id !== undefined) {
      const reason = verdict.reason ?? (verdict.rule === undefined ? t('outcome.denied') : t('reason.rule', { rule: verdict.rule }))
      record($, a => act.checkDenied(a, id, reason))
    }
    return verdict
  })

  on('skill.prompt', async ($, e, next) => {
    const answered = await next(e)
    const name = e.skill
    record($, (a, at) => act.skillLoaded(a, name, at))
    return answered
  })

  on('session.compact', async ($, e, next) => {
    const done = await next(e)
    if (e.agentId === undefined && e.trigger !== 'precompute' && done.messages !== undefined) {
      const c = { trigger: e.trigger, before: done.tokensBefore, after: done.tokensAfter }
      record($, (a, at) => act.compacted(a, { ...c, at }))
    }
    return done
  })

  on('session.receive', ($, e, next) => {
    const origin = e.origin
    // Any delivery to an agent's loop wakes it, a task's notice too: it owes nobody an answer before it.
    const receiver = e.agentId
    if (receiver !== undefined) record($, (a, at) => act.agentHeard(a, receiver, at))
    // A background task's notice is this session's own news, not a message from elsewhere.
    if (origin.kind !== 'task-notification') {
      const from = 'teammate' in origin ? origin.teammate : origin.kind === 'peer' ? t('peer.other') : origin.kind
      const note = { direction: 'in' as const, who: from, text: e.text }
      record($, (a, at) => act.noted(a, { ...note, at }))
    }
    return next(e)
  })

  on('session.send', ($, e, next) => {
    const note = { direction: 'out' as const, who: e.to, text: e.text }
    record($, (a, at) => act.noted(a, { ...note, at }))
    const sender = e.agentId
    if (sender !== undefined) record($, (a, at) => act.agentSent(a, sender, note.who, at))
    return next(e)
  })

  // A teammate about to idle with nothing to wake it is sent back once with what to do; the
  // settings' own hooks answer first, and a block of theirs stands.
  on('classic.TeammateIdle', async ($, e, next) => {
    const answered = await next(e)
    const agentId = e.agent_id
    if (answered.block !== undefined || agentId === undefined) return answered
    await queue
    const text = await teammateIdle($, agentId)
    return text === null ? answered : { ...answered, block: text }
  })

  // A subagent about to end with its own shells running is held once: their end will not wake it.
  on('classic.SubagentStop', async ($, e, next) => {
    const answered = await next(e)
    if (answered.block !== undefined) return answered
    await queue
    const text = await subagentStop($, e.agent_id, e.stop_hook_active)
    return text === null ? answered : { ...answered, block: text }
  })

  on('ui.render', { component: 'Pane', requestId: PANE }, async ($, e) => {
    const { Box, Text } = $.ui.resolve(e)
    const input: PaneInput = {
      now: await $.clock.now(),
      tz: await read($, tz),
      activity: await read($, activity),
      snapshot: await read($, snapshot),
      history: await read($, history),
      git: await read($, git),
      ci: await read($, ci),
      pr: await read($, pr),
      peers: await read($, peers),
      loops: (await read($, loops)).length,
      shells: await runsOf($, await read($, shells)),
    }
    const lines = paneLines(input, e.props.bodyColumns)
    return (
      <Box flexDirection="column">
        {lines.map((line, i) => (
          <Text key={`line-${i}`} wrap="truncate-end">
            {line.length === 0 ? ' ' : line.map(seg => <Text {...THEME[seg.tone ?? "plain"]}>{seg.t}</Text>)}
          </Text>
        ))}
      </Box>
    )
  })

  // The HUD above the prompt, drawn by the engine in the person's theme. A survey takes the band;
  // switched off or hidden, the band is the engine's and the status line draws the HUD again.
  on('ui.render', { component: 'AbovePrompt' }, async ($, e, next) => {
    if (e.props.hasSurvey) return next(e)
    if (!(await read($, band))) {
      bandDrawn(false)
      return next(e)
    }
    const now = await $.clock.now()
    const input = {
      now,
      tz: await read($, tz),
      model: prettyModel(await $.session.model().catch(() => ''), 'Claude'),
      effort,
      startedAt: sessionStartedAt,
      snapshot: await read($, snapshot),
      shared: await sharedNow($, now),
      pr: await read($, pr),
      runs: await runsOf($, await read($, shells)),
      peers: await read($, peers),
      isWorking: e.props.isWorking,
    }
    const { bodyColumns, maxRows } = e.props
    const lines = bandLines(input, bodyColumns, maxRows)
    // Shells share their line with alerts and agents, so they show when the band would differ without them.
    hasBandShells = JSON.stringify(lines) !== JSON.stringify(bandLines({ ...input, runs: [] }, bodyColumns, maxRows))
    bandDrawn(lines.length > 0)
    if (lines.length === 0) return next(e)
    // Air first: an empty row above and below the band and one between its lines, given up in
    // that order (between, then around) when the rows run short, before any line is.
    const n = lines.length
    const gaps = lines.slice(1).filter(line => line.tight !== true).length
    const [pad, gap] = ([[BAND_PAD, 1], [BAND_PAD, 0], [0, 0]] as const).find(([p, g]) => n + gaps * g + 2 * p <= maxRows) ?? [0, 0]
    // The band is raised on the terminal and the desktop, the two surfaces that mount surface modules.
    if (e.surface !== 'terminal' && e.surface !== 'desktop') return next(e)
    const { Box, Text, Button, Link, Client } = $.ui.resolve(e)
    const Gauge = ({ part }: { part: GaugePart }) => (
      <Client key={`gauge-${part.id}`} module="../render/gauge-client.tsx" props={{ value: part.value, inner: part.inner, colour: part.colour, track: PALETTE.track }} width={gaugeCells(part.inner)} height={1} />
    )
    const Spinner = ({ part }: { part: SpinnerPart }) => <Client key={`spin-${part.id}`} module="../render/spinner-client.tsx" props={{ colour: part.colour }} width={1} height={1} />
    const onAction = (action: Action) => quietly((action === 'panel' ? togglePane($) : reapLoops($)).then(text => $.ui.toast(text)))
    const { Band } = createBandView({ Box, Text, Button, Link }, { Gauge, Spinner, onAction })
    return <Band lines={lines.slice(0, maxRows)} columns={bodyColumns} pad={pad} gap={gap} />
  })

  // While the band has a row per background shell, the engine's `N active shells` under the prompt
  // repeats it. With `hideModeHint` on, the footer also drops its permission-mode reminder and keeps
  // only what changes, such as `esc to interrupt`.
  on('ui.render', { component: 'PromptHint' }, ($, e, next) => {
    const hint = e.props.hint
      .split('·')
      .map(part => part.trim())
      .filter(part => part !== '' && !(settings.hideModeHint && /mode on|permissions on|shift\+tab|for agents/i.test(part)))
      .filter(part => !(hasBandShells && /^\d+ active shells?$/i.test(part)))
      .join(' · ')
    return next({ ...e, props: { ...e.props, hint } })
  })
}
