// The /binnacle pane as plain lines: everything the status line has no room for, in a rounded frame
// titled "binnacle · status". Two columns from 100 cells: the session's own work on the left
// (activity, agents and shells, PR and CI), what surrounds it on the right (alerts, the bus,
// usage, files and skills); one column below that, alerts first. Pure, so the hook draws it, the
// tests read it and tools/preview.ts prints it the same way.

import { currentCall, STALL_MS, who } from '../model/activity'
import { alertsOf } from '../model/alerts'
import { verdictOf, type Verdict } from '../model/liveness'
import { pulses } from '../model/shared'
import type { ShellRun } from '../model/shells'
import { crowdOf, peerWords, untilFull } from '../model/signals'
import type { Activity, AgentRun, Call, Ci, Git, Peer, Pr, Sample, Snapshot } from '../types'
import { t, tn } from '../i18n'
import { SIGN, TONE, word } from './agents'
import { clock, clockSeconds, dollars, duration, limitName, percent, runTime, tokens, when } from './format'
import { ordered, shellRow } from './shells'
import { bar, cut, fit, sparkline, toneOf, width, type Line, type Tone } from './text'

export type PaneInput = {
  now: number
  tz: number
  activity: Activity
  snapshot: Snapshot | null
  history: Record<string, Sample[]>
  git: Git | null
  ci: Ci | null
  pr: Pr | null
  peers: Peer[]
  loops: number
  /** The session's background shells, as their output files say they stand. */
  shells: ShellRun[]
}

/** From this many cells the pane splits in two columns. */
export const TWO_COLUMNS = 100

/** The pane's title, set in its top edge. */
export const title = () => t('pane.title')

/** Below this many cells a column drops what it can do without: run times, foreground or background. */
const NARROW_COLUMN = 66

const COLLAPSE_MS = 10 * 60_000

const dim = (text: string): Line => [{ t: text, tone: 'dim' }]
const sep = (): Line => dim(' · ')

/** A section's title in capitals and accent, then a thin rule to the column's edge. */
function heading(title: string, w: number): Line {
  return [
    { t: title, tone: 'accent' },
    { t: ` ${'─'.repeat(Math.max(0, w - width(title) - 1))}`, tone: 'dim' },
  ]
}

/** A path under a home folder written from `~`, so the pane spends its cells on what differs. */
export function homeShort(path: string): string {
  return path.replace(/^\/(?:Users|home)\/[^/]+\//, '~/')
}

/** A file the session keeps for itself (its scratchpad, its task outputs), not work in a repository. */
export const isScratch = (path: string) => /\/claude-\d+\/[^/]+\/[^/]+\/(?:scratchpad|tasks)\//.test(path)

/** A call in the words it gave for itself, else what it acts on. */
const callText = (c: { said?: string; target: string }) => c.said ?? c.target

/**
 * Why a call was refused or failed, in fewer cells: a hook's refusal without the engine's prefix,
 * a bare exit code in words. Anything else as it came.
 */
export function reasonWords(reason: string): string {
  const hook = /^(?:Pre|Post)ToolUse:\w+ hook error:\s*/.exec(reason)
  if (hook) return t('reason.hook', { text: reason.slice(hook[0].length) })
  const exit = /^Exit code (-?\d+)$/.exec(reason.trim())
  if (exit) return t('reason.exit', { code: exit[1] ?? '' })
  return reason
}

/** A path cut from its start, where the folders matter least. */
function cutStart(text: string, max: number): string {
  const chars = [...text]
  return chars.length <= max ? text : `…${chars.slice(chars.length - max + 1).join('')}`
}

type Cell = { line: Line; size: number | 'flex'; right?: boolean }

/** Cells side by side, one space apart; the flex cell takes what the fixed ones leave. */
function row(cellsOf: Cell[], total: number): Line {
  const fixed = cellsOf.reduce((n, c) => n + (c.size === 'flex' ? 0 : c.size), 0) + Math.max(0, cellsOf.length - 1)
  const flex = Math.max(4, total - fixed)
  const out: Line = []
  cellsOf.forEach((c, i) => {
    const size = c.size === 'flex' ? flex : c.size
    const text = fit(c.line, size)
    const gap = size - text.reduce((n, s) => n + width(s.t), 0)
    if (i > 0) out.push({ t: ' ' })
    if (c.right) out.push({ t: ' '.repeat(gap) }, ...text)
    else out.push(...text, ...(i === cellsOf.length - 1 ? [] : [{ t: ' '.repeat(gap) }]))
  })
  return fit(out, total)
}

/** A sub-list inside a section: a blank line, then its name, dim. */
const sublist = (name: string): Line[] => [[], dim(name)]

// ACTIVIDAD DEL TURNO

function turnState(input: PaneInput): Line[] {
  const { activity: a, tz } = input
  const turn = a.turn
  if (turn) {
    const call = currentCall(a)
    return [
      [{ t: '● ', tone: 'accent' }, { t: t('pane.working') }, ...dim(` ${t('pane.since', { time: clock(turn.startedAt, tz) })} · ${duration(input.now - turn.startedAt)}`)],
      call ? [...dim(`${t('pane.running')} `), { t: call.tool, tone: 'strong' }, { t: callText(call) === '' ? '' : ` ${callText(call)}` }] : dim(t('pane.noToolRunning')),
      [{ t: tn('count.requests', turn.steps) }, ...sep(), { t: tn('count.actions', turn.actions) }, ...dim(` ${t('pane.thisTurn')}`)],
    ]
  }
  const last = a.last
  const state: Line = [{ t: '○ ', tone: 'dim' }, { t: t('status.idle') }, ...(last ? dim(` ${t('pane.since', { time: clock(last.endedAt, tz) })}`) : [])]
  if (!last) return [state]
  return [state, dim(`${t('status.lastTurn', { time: duration(last.seconds * 1000) })}, ${tn('count.actions', last.actions)}, ${tn('count.steps', last.steps)}`)]
}

function result(call: Call): Line {
  if (call.outcome === 'ok') return [{ t: t('outcome.ok'), tone: 'good' }]
  if (call.outcome === 'running') return [{ t: t('pane.running'), tone: 'warn' }]
  const tone: Tone = call.outcome === 'denied' ? 'warn' : 'bad'
  const said = call.outcome === 'denied' ? t('outcome.denied') : t('outcome.error')
  return [{ t: call.reason ? `${said}: ${reasonWords(call.reason)}` : said, tone }]
}

function recentCalls(input: PaneInput, w: number): Line[] {
  const { activity: a, tz } = input
  const lines = sublist(t('pane.recentCalls'))
  if (a.calls.length === 0) return [...lines, dim(t('pane.noCallsYet'))]
  const isWide = w >= 90
  // A narrow column keeps the target readable: the run time goes before it does.
  const hasTime = w >= NARROW_COLUMN
  const calls = a.calls.slice(-12).reverse()
  // Who made each call only matters once an agent made one.
  const hasAgents = calls.some(c => c.agentId !== undefined)
  const hasReason = calls.some(c => c.reason)
  const reasonSize = hasReason ? Math.min(50, Math.max(12, Math.floor(w * (hasTime ? 0.3 : 0.25)))) : 8
  for (const call of calls) {
    lines.push(
      row(
        [
          { line: dim(isWide ? clockSeconds(call.at, tz) : clock(call.at, tz)), size: isWide ? 8 : 5 },
          ...(hasAgents ? [{ line: [{ t: who(a, call.agentId) }], size: isWide ? 12 : 10 }] : []),
          { line: [{ t: call.tool, tone: 'strong' }], size: 9 },
          { line: [{ t: callText(call) }], size: 'flex' },
          ...(hasTime ? [{ line: dim(call.ms === undefined ? '' : runTime(call.ms)), size: 7, right: true }] : []),
          { line: result(call), size: reasonSize },
        ],
        w,
      ),
    )
  }
  return lines
}

function blocks(input: PaneInput, w: number): Line[] {
  const { activity: a, tz } = input
  const lines = sublist(t('pane.blocks'))
  if (a.deniedTotal === 0 && a.errorTotal === 0) return [...lines, dim(t('pane.noBlocks'))]
  lines.push([
    { t: tn('count.denied', a.deniedTotal), tone: a.deniedTotal > 0 ? 'warn' : 'plain' },
    ...dim(` ${t('pane.and')} `),
    { t: tn('count.errors', a.errorTotal), tone: a.errorTotal > 0 ? 'bad' : 'plain' },
    ...dim(` ${t('pane.inSession')}`),
  ])
  const list = (items: Activity['denials'], tone: Tone) => {
    for (const b of items.slice(-5).reverse()) {
      const target = cut(callText(b), Math.max(8, Math.floor(w * 0.35)))
      lines.push(
        fit(
          [
            { t: `${clock(b.at, tz)} `, tone: 'dim' },
            { t: b.tool, tone: 'strong' },
            { t: target === '' ? ' ' : ` ${target} ` },
            { t: '— ', tone: 'dim' },
            { t: b.reason === '' ? t('pane.noReason') : reasonWords(b.reason), tone },
          ],
          w,
        ),
      )
    }
  }
  list(a.denials, 'warn')
  list(a.errors, 'bad')
  return lines
}

function activity(input: PaneInput, w: number): Line[] {
  return [...turnState(input), ...recentCalls(input, w), ...blocks(input, w)]
}

// AGENTES Y SHELLS

/** In a turn without a step or a call this long, an agent reads as silent rather than at work. */
const QUIET_MS = 2 * 60_000

/** How an agent stands and for how long; an ended one, when it ended. */
function agentState(v: Verdict, run: AgentRun, at: number, tz: number): Line {
  if (v.state === 'done') return dim(`${v.why} ${clock(v.since, tz)}`)
  const silent = at - run.lastAt
  if (v.state === 'working' && run.busy === 0 && silent >= QUIET_MS) return [{ t: t('pane.silentFor', { time: duration(silent) }), tone: silent >= STALL_MS ? 'warn' : 'plain' }]
  return [{ t: `${word(v.state)} ${duration(at - v.since)}`, tone: v.state === 'waiting' ? 'plain' : TONE[v.state] }]
}

function agentRows(input: PaneInput, w: number): Line[] {
  const { activity: a, tz } = input
  const active = a.agents.filter(r => r.endedAt === undefined).sort((x, y) => x.startedAt - y.startedAt)
  const ended = a.agents.filter(r => r.endedAt !== undefined).sort((x, y) => (y.endedAt ?? 0) - (x.endedAt ?? 0))
  const recent = ended.filter(r => input.now - (r.endedAt ?? 0) < COLLAPSE_MS)
  const old = ended.length - recent.length
  const lines: Line[] = []
  for (const run of [...active, ...recent]) {
    const kind = run.isTeammate ? t('agent.teammate') : run.isBackground === undefined ? '' : run.isBackground ? t('agent.background') : t('agent.foreground')
    const v = verdictOf(run, input.shells, input.now)
    const isSaid = run.type === '' || run.type === run.name || run.type === kind
    const name: Line = [{ t: `${SIGN[v.state]} `, tone: TONE[v.state] }, { t: run.name }, ...(isSaid ? [] : dim(` ${run.type}`))]
    lines.push(
      row(
        [
          { line: name, size: 'flex' },
          ...(w >= NARROW_COLUMN ? [{ line: dim(kind), size: 13 }] : []),
          { line: dim(clock(run.startedAt, tz)), size: 5 },
          { line: [{ t: tn('count.actions', run.actions) }], size: 12, right: true },
          { line: agentState(v, run, input.now, tz), size: 20 },
        ],
        w,
      ),
    )
    // What it waits on, or why nothing will wake it: the line that keeps a stall from passing for a wait.
    if (v.state === 'waiting' || v.state === 'stalled' || v.state === 'unknown') lines.push(fit([{ t: '  → ', tone: 'dim' }, { t: v.why, tone: v.state === 'stalled' ? 'bad' : 'dim' }], w))
    // What a working agent does now in its own words, or the last thing it did while it thinks.
    else if (v.state === 'working' && run.doing) {
      const { tool, text, running } = run.doing
      lines.push(fit([{ t: '  → ', tone: 'dim' }, ...(running ? [] : dim(`${t('pane.thinkingLast')} `)), { t: text ? `${tool} · ${text}` : tool, tone: running ? 'plain' : 'dim' }], w))
    }
  }
  if (old > 0) lines.push(dim(tn('pane.olderEnded', old)))
  return lines
}

/** A shell in the pane: how long it runs, or how and when it ended, however long ago. */
function shellTail(run: ShellRun, now: number, tz: number): Line {
  if (run.state === 'running') return dim(` · ${duration(now - run.startedAt)}`)
  if (run.endedAt === null) return dim(` · ${t('pane.gone')}`)
  const at = dim(` · ${clock(run.endedAt, tz)}`)
  if (run.code === null) return [...dim(` · ${t('shell.stopped')}`), ...at]
  return run.code === 0 ? [{ t: ` · ${t('shell.ended')}`, tone: 'good' }, ...at] : [{ t: ` · ${t('shell.exit', { code: run.code })}`, tone: 'bad' }, ...at]
}

function agentsAndShells(input: PaneInput, w: number): Line[] {
  const agents = agentRows(input, w)
  const shells = ordered(input.shells).map(run => shellRow(run, shellTail(run, input.now, input.tz), w))
  if (agents.length === 0 && shells.length === 0) return [dim(t('pane.noAgents'))]
  return [...agents, ...(agents.length > 0 && shells.length > 0 ? [[] as Line] : []), ...shells]
}

// PR Y CI

/** A pull request's review decision in words, with its tone. */
function review(decision: string): [string, Tone] {
  if (decision === 'APPROVED') return [t('review.approved'), 'good']
  if (decision === 'CHANGES_REQUESTED') return [t('review.changesRequested'), 'bad']
  if (decision === 'REVIEW_REQUIRED') return [t('review.required'), 'warn']
  return [t('review.none'), 'dim']
}

function ciLine(ci: Ci | null): Line {
  if (ci === null) return [{ t: '○ ', tone: 'dim' }, ...dim(t('ci.none'))]
  const sign: Line = ci.fail > 0 ? [{ t: '✗ ', tone: 'bad' }] : ci.pending > 0 ? [{ t: '⧗ ', tone: 'warn' }] : [{ t: '✓ ', tone: 'good' }]
  return [
    ...sign,
    { t: 'CI ' },
    { t: t('ci.pass', { n: ci.pass }), tone: ci.pass > 0 && ci.fail === 0 ? 'good' : 'plain' },
    ...sep(),
    { t: tn('ci.fail', ci.fail), tone: ci.fail > 0 ? 'bad' : 'dim' },
    ...sep(),
    { t: tn('ci.pending', ci.pending), tone: ci.pending > 0 ? 'warn' : 'dim' },
  ]
}

function prAndCi(input: PaneInput): Line[] {
  const { git, ci, pr } = input
  if (git === null) return [dim(t('pane.noRepo'))]
  const changes: Line =
    git.dirty === 0 && git.ahead === 0 && git.behind === 0
      ? [{ t: t('git.upToDate'), tone: 'good' }]
      : [
          git.dirty === 0 ? { t: t('git.nothingUncommitted'), tone: 'good' } : { t: t('git.uncommitted', { n: git.dirty }), tone: 'warn' },
          ...sep(),
          { t: t('git.ahead', { n: git.ahead }), tone: git.ahead > 0 ? 'plain' : 'dim' },
          ...sep(),
          { t: t('git.behind', { n: git.behind }), tone: git.behind > 0 ? 'warn' : 'dim' },
        ]
  const reviewed = (p: Pr): Line => {
    const [said, tone] = review(p.review)
    return [{ t: '○ ', tone: 'dim' }, { t: `PR #${p.number}` }, ...sep(), { t: said, tone }]
  }
  return [
    [{ t: git.repo }, ...sep(), { t: git.branch, tone: 'accent' }],
    changes,
    pr === null ? [{ t: '○ ', tone: 'dim' }, ...dim(t('pane.noPr'))] : reviewed(pr),
    ciLine(ci),
  ]
}

// ALERTAS

function alertLines(input: PaneInput): Line[] {
  const list = alertsOf({
    now: input.now,
    ci: input.ci,
    crowd: crowdOf(input.peers, input.git?.root),
    turnDenials: input.activity.turn?.denials,
    loops: input.loops,
    agents: pulses(input.activity),
    runs: input.shells,
  })
  return list.flatMap(alert => [
    [{ t: '⚠ ', tone: alert.tone }, { t: alert.text, tone: alert.tone }],
    [{ t: '  → ', tone: 'dim' }, { t: alert.fix, tone: 'dim' }],
  ])
}

// OTHER SESSIONS

function bus(input: PaneInput, w: number): Line[] {
  const { peers, activity: a, tz } = input
  const lines: Line[] = []
  if (peers.length === 0) lines.push(dim(t('pane.noPeers')))
  for (const p of peers.slice(0, 8)) {
    const isLive = p.liveness === 'live'
    // Each session by its callsign, where it works, and what it says it does.
    const { name, mission } = peerWords(p)
    const where = p.repo.split('/').filter(Boolean).pop() ?? p.place
    const about = mission || (p.branch === null ? '' : `rama ${p.branch}`)
    const isNarrow = w < NARROW_COLUMN
    lines.push(
      row(
        [
          { line: [{ t: isLive ? '● ' : '○ ', tone: isLive ? 'good' : 'dim' }, { t: name, tone: isLive ? 'strong' : 'dim' }], size: isNarrow ? 12 : 16 },
          { line: dim(isLive || isNarrow ? where : t('pane.peerSilent', { where })), size: isNarrow ? 10 : 18 },
          { line: [{ t: about, tone: isLive ? 'plain' : 'dim' }], size: 'flex' },
        ],
        w,
      ),
    )
  }
  if (peers.length > 8) lines.push(dim(t('status.andMore', { n: peers.length - 8 })))
  lines.push(...sublist(t('pane.messages')))
  if (a.notes.length === 0) lines.push(dim(t('pane.noMessages')))
  for (const n of a.notes.slice(-6).reverse()) {
    lines.push([{ t: `${clock(n.at, tz)} `, tone: 'dim' }, { t: `${t(n.direction === 'in' ? 'pane.from' : 'pane.to', { who: n.who })}: `, tone: 'strong' }, { t: n.text }])
  }
  return lines
}

// CONSUMO

const SPARK = 8
/** What started a compaction, in words. */
function trigger(kind: string): string {
  if (kind === 'manual') return t('compaction.manual')
  if (kind === 'auto') return t('compaction.auto')
  if (kind === 'plugin') return t('compaction.plugin')
  return kind
}

/** A meter: its words on one line, then a block bar and, when it has readings, their sparkline. */
function meter(words: Line, value: number, tone: Tone, samples: readonly Sample[], w: number): Line[] {
  const spark = sparkline(samples.map(s => s.p), SPARK, tone === 'good' ? 'dim' : tone)
  const size = Math.max(10, Math.min(40, w - (spark.length > 0 ? SPARK + 2 : 0)))
  return [words, [...bar(value, size, tone === 'good' ? 'accent' : tone), ...(spark.length > 0 ? [{ t: '  ' }, ...spark] : [])]]
}

function usage(input: PaneInput, w: number): Line[] {
  const { snapshot: s, tz } = input
  if (s === null) return [dim(t('pane.noMeasures'))]
  const lines: Line[] = []
  if (s.percent !== undefined) {
    const tone = toneOf(s.percent)
    const words: Line = [
      { t: `${t('status.context')} ` },
      { t: percent(s.percent), tone: tone === 'good' ? 'plain' : tone },
      ...dim(s.tokens === undefined ? ` ${t('status.ofWindow', { window: tokens(s.window) })}` : ` · ${t('pane.tokensOf', { used: tokens(s.tokens), window: tokens(s.window) })}`),
      ...(s.percent >= 90 ? [{ t: ` · ${t('status.compactSoon')}`, tone: 'bad' as const }] : []),
    ]
    lines.push(...meter(words, s.percent, tone, [], w))
  } else lines.push(dim(t('pane.contextUnread', { window: tokens(s.window) })))

  for (const m of s.limits) {
    const samples = input.history[m.kind] ?? []
    const fills = untilFull(samples)
    const resetsIn = m.resetsAt === undefined ? null : m.resetsAt - input.now
    const isFilling = fills !== null && (resetsIn === null || fills < resetsIn)
    const tone: Tone = isFilling ? 'bad' : toneOf(m.percent)
    const name = m.kind === 'five_hour' ? t('limit.five_hour.short') : limitName(m.kind)
    const words: Line = [
      { t: `${name.charAt(0).toUpperCase()}${name.slice(1)} `, tone: isFilling ? 'bad' : 'plain' },
      { t: percent(m.percent), tone: tone === 'good' ? 'plain' : tone },
      ...(isFilling ? [{ t: ` · ${t('status.fillsIn', { time: duration(fills) })}`, tone: 'bad' as const }] : []),
      ...(m.resetsAt === undefined ? [] : dim(` · ${t('band.resets', { when: when(m.resetsAt, input.now, tz) })}`)),
    ]
    lines.push([], ...meter(words, m.percent, tone, samples, w))
  }
  if (s.limits.length === 0 && s.usd !== undefined) lines.push([], [...dim(`${t('status.cost')} `), { t: dollars(s.usd) }])

  lines.push(...sublist(t('pane.compactions')))
  const cs = input.activity.compactions
  if (cs.length === 0) lines.push(dim(t('pane.noneInSession')))
  for (const c of cs.slice(-5)) {
    const sizes = c.before !== undefined && c.after !== undefined ? ` (${tokens(c.before)} → ${tokens(c.after)})` : ''
    lines.push([{ t: `${clock(c.at, tz)} ${trigger(c.trigger)}` }, ...dim(sizes)])
  }
  return lines
}

// FICHEROS Y SKILLS

function filesAndSkills(input: PaneInput, w: number): Line[] {
  const { activity: a, tz } = input
  const lines: Line[] = []
  // The session's own scratch files are counted, not listed: the repositories' files are the work.
  const files = a.files.filter(f => !isScratch(f.path))
  const scratch = a.files.length - files.length
  if (files.length === 0) lines.push(dim(t('pane.noFiles')))
  for (const f of files.slice(0, 12)) {
    lines.push(
      row(
        [
          { line: [{ t: cutStart(homeShort(f.path), Math.max(10, w - 19)) }], size: 'flex' },
          { line: [{ t: tn('count.edits', f.edits) }], size: 12, right: true },
          { line: dim(clock(f.lastAt, tz)), size: 5 },
        ],
        w,
      ),
    )
  }
  if (files.length > 12) lines.push(dim(tn('pane.moreFiles', files.length - 12)))
  if (scratch > 0) lines.push(dim(tn('pane.scratchFiles', scratch)))
  lines.push(...sublist(t('pane.skills')))
  if (a.skills.length === 0) lines.push(dim(t('pane.noSkills')))
  for (const s of [...a.skills].reverse().slice(0, 10)) {
    lines.push(row([{ line: [{ t: s.name }], size: 'flex' }, { line: dim(clock(s.at, tz)), size: 5 }], w))
  }
  if (a.skills.length > 10) lines.push(dim(t('status.andMore', { n: a.skills.length - 10 })))
  return lines
}

// Layout

type Section = { title: string; body: (w: number) => Line[] }

/** Sections one under another, a blank line apart, each line cut to `w`. */
function stack(sections: Section[], w: number): Line[] {
  return sections.flatMap((s, i) => [...(i === 0 ? [] : [[] as Line]), heading(s.title, w), ...s.body(w)]).map(line => fit(line, w))
}

/** A line cut or padded to exactly `w` cells. */
function exactly(line: Line, w: number): Line {
  const cutLine = fit(line, w)
  const left = w - cutLine.reduce((n, s) => n + width(s.t), 0)
  return left > 0 ? [...cutLine, { t: ' '.repeat(left) }] : cutLine
}

/** The body inside a rounded accent frame, the title set in its top edge. */
function framed(body: Line[], w: number): Line[] {
  const inner = w - 4
  const top = cut(title(), Math.max(0, w - 6))
  return [
    [{ t: '╭─ ', tone: 'accent' }, { t: top, tone: 'accent' }, { t: ` ${'─'.repeat(Math.max(0, w - 5 - width(top)))}╮`, tone: 'accent' }],
    ...body.map(line => [{ t: '│ ', tone: 'accent' as const }, ...exactly(line, inner), { t: ' │', tone: 'accent' as const }]),
    [{ t: `╰${'─'.repeat(w - 2)}╯`, tone: 'accent' }],
  ]
}

/** The pane's lines for a body `columns` wide; none longer than that. */
export function paneLines(input: PaneInput, columns: number): Line[] {
  const w = Math.max(40, columns)
  const inner = w - 4
  const alerts = alertLines(input)
  const warning: Section[] = alerts.length === 0 ? [] : [{ title: t('pane.section.alerts'), body: () => alerts }]
  const left: Section[] = [
    { title: t('pane.section.activity'), body: cw => activity(input, cw) },
    { title: t('pane.section.agents'), body: cw => agentsAndShells(input, cw) },
    { title: t('pane.section.pr'), body: () => prAndCi(input) },
  ]
  const right: Section[] = [
    ...warning,
    { title: t('pane.section.peers'), body: cw => bus(input, cw) },
    { title: t('pane.section.usage'), body: cw => usage(input, cw) },
    { title: t('pane.section.files'), body: cw => filesAndSkills(input, cw) },
  ]

  if (w < TWO_COLUMNS) return framed(stack([...warning, ...left, ...right.slice(warning.length)], inner), w)

  // The left column carries the longer rows (actions, agents); the rule between is dim.
  const leftWidth = Math.floor((inner - 3) * 0.55)
  const rightWidth = inner - 3 - leftWidth
  const a = stack(left, leftWidth)
  const b = stack(right, rightWidth)
  const body = Array.from({ length: Math.max(a.length, b.length) }, (_, i) => [
    ...exactly(a[i] ?? [], leftWidth),
    { t: ' │ ', tone: 'dim' as const },
    ...(b[i] ?? []),
  ])
  return framed(body, w)
}
