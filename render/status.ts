// The status block: three short lines (the work, the checkout, the budgets), a fourth only when
// something needs the user, then a row per background shell. The status line prints numbers
// only; the band above the prompt frames the same facts in sections (render/band.ts) and draws this
// block bare only when it has too few rows for a frame; the long bars live in the pane.
// Each line is built at less detail until it fits; nothing ever wraps. Grey dominates:
// colour marks the branch to find and what needs attention (a dirty tree, a budget about to fill,
// an alert, a failed shell).

import { alertsOf } from '../model/alerts'
import type { ShellRun } from '../model/shells'
import { untilFull } from '../model/signals'
import type { Meter, Shared } from '../types'
import { agentCount, judged } from './agents'
import { t, tn } from '../i18n'
import { dollars, duration, limitName, percent, shortWhen, tokens } from './format'
import { shellLines } from './shells'
import { bar, cells, cutWords, fitWords, joined, toneOf, type Line, type Tone } from './text'

/** The model and the budgets, reduced to what the status line draws. */
export type Status = {
  model: string
  context?: { percent: number; tokens?: number; window: number }
  limits: Meter[]
  usd?: number
}

type Level = { detail: boolean; model: boolean; tool: boolean; actions: boolean; sync: boolean; urge: boolean }

const ALL: Level = { detail: true, model: true, tool: true, actions: true, sync: true, urge: true }

// What gives way, in order: the detail (the window size, the reset time, the last turn), the
// model, then what the pane repeats anyway (the tool, the action count, ahead and behind, the
// words after a red figure).
const LEVELS: Level[] = [
  ALL,
  { ...ALL, detail: false },
  { ...ALL, detail: false, model: false },
  { ...ALL, detail: false, model: false, tool: false },
  { ...ALL, detail: false, model: false, tool: false, actions: false },
  { ...ALL, detail: false, model: false, tool: false, actions: false, sync: false },
  { detail: false, model: false, tool: false, actions: false, sync: false, urge: false },
]

/** A branch past this many cells says nothing more that the pane does not. */
const BRANCH_MAX = 40

const dim = (t: string): Line => [{ t, tone: 'dim' }]

function work(shared: Shared, status: Status, now: number, level: Level, runs: readonly ShellRun[]): Line[] {
  const parts: Line[] = []
  const turn = shared.turn
  if (turn) {
    parts.push([{ t: '● ', tone: 'accent' }, { t: t('status.working', { time: duration(now - turn.startedAt) }) }])
    if (turn.tool && level.tool) parts.push([{ t: turn.tool }])
    if (level.actions) parts.push(dim(tn('count.actions', turn.actions)))
  } else {
    parts.push([{ t: '○ ', tone: 'dim' }, { t: t('status.idle') }])
    const last = shared.last
    if (last && level.detail) parts.push(dim(t('status.lastTurn', { time: duration(last.seconds * 1000) })))
    if (last && level.actions) parts.push(dim(tn('count.actions', last.actions)))
  }
  parts.push(...agentCount(judged(shared.agents, runs, now)))
  if (level.model) parts.push(dim(status.model))
  return parts
}

function checkout(shared: Shared, level: Level): Line[] {
  const repo = shared.git
  if (!repo) return []
  const parts: Line[] = [[{ t: repo.repo }], [{ t: cutWords(repo.branch, BRANCH_MAX), tone: 'accent' }]]
  parts.push(repo.dirty > 0 ? [{ t: t('git.uncommitted', { n: repo.dirty }), tone: 'warn' }] : [{ t: t('git.clean'), tone: 'good' }])
  if (repo.ahead > 0 && level.sync) parts.push(dim(t('git.ahead', { n: repo.ahead })))
  if (repo.behind > 0 && level.sync) parts.push([{ t: t('git.behind', { n: repo.behind }), tone: 'warn' }])
  return parts
}

/** A figure is plain while fine, and takes the tone only when it needs attention. */
const figure = (value: number, tone: Tone): Line => [{ t: percent(value), tone: tone === 'good' ? 'plain' : tone }]

const ORDER = ['five_hour', 'seven_day']
const rank = (kind: string) => (ORDER.includes(kind) ? ORDER.indexOf(kind) : ORDER.length)

/** The five-hour window reads "5h" beside its figure. */
const shortName = (kind: string) => (kind === 'five_hour' ? t('limit.five_hour.short') : limitName(kind))

/** A gauge of `size` cells after a figure; none when `size` is 0. */
const gauge = (value: number, tone: Tone, size: number): Line => (size > 0 ? [{ t: ' ' }, ...bar(value, size, tone)] : [])

function budgets(status: Status, shared: Shared, now: number, tz: number, level: Level, bars: number): Line[] {
  const parts: Line[] = []
  const ctx = status.context
  if (ctx) {
    const tone = toneOf(ctx.percent)
    const part: Line = [...dim(`${t('status.context')} `), ...figure(ctx.percent, tone), ...gauge(ctx.percent, tone, bars)]
    if (level.detail) part.push({ t: ` ${t('status.ofWindow', { window: tokens(ctx.window) })}`, tone: 'dim' })
    if (ctx.percent >= 90 && level.urge) part.push({ t: ` · ${t('status.compactSoon')}`, tone: 'bad' })
    parts.push(part)
  }

  for (const limit of [...status.limits].sort((a, b) => rank(a.kind) - rank(b.kind))) {
    const fills = untilFull(shared.history?.[limit.kind] ?? [])
    const resetsIn = limit.resetsAt === undefined ? null : limit.resetsAt - now
    const isFilling = fills !== null && (resetsIn === null || fills < resetsIn)
    // A window about to fill reads red whole: its name, its figure and when it fills.
    const tone: Tone = isFilling ? 'bad' : toneOf(limit.percent)
    const part: Line = [{ t: `${shortName(limit.kind)} `, tone: isFilling ? 'bad' : 'dim' }, ...figure(limit.percent, tone), ...gauge(limit.percent, tone, bars)]
    // Short of room, "6 h 45 min" reads "6 h" rather than a figure cut in half.
    const within = level.urge ? duration(fills ?? 0) : duration(fills ?? 0).replace(/ \d+ (min|h)$/, '')
    if (isFilling) part.push({ t: ` · ${t('status.fillsIn', { time: within })}`, tone: 'bad' })
    else if (level.detail && limit.resetsAt !== undefined && limit.kind !== 'seven_day') {
      part.push({ t: ` ↻ ${shortWhen(limit.resetsAt, now, tz)}`, tone: 'dim' })
    }
    parts.push(part)
  }

  // A subscription reports rate-limit windows; its dollar figure is notional, so it stays out.
  if (status.limits.length === 0 && status.usd !== undefined && status.usd > 0) {
    parts.push([...dim(`${t('status.cost')} `), { t: dollars(status.usd) }])
  }
  return parts
}

/**
 * Every alert in full words, then every alert short, then the least severe left out and counted.
 * The sign takes the worst alert's colour; a red alert stays red, a yellow one amber.
 */
export function alerting(shared: Shared, now: number, max: number, first: number, runs: readonly ShellRun[] = []): Line {
  const alerts = alertsOf({
    now,
    ci: shared.ci,
    crowd: shared.crowd,
    turnDenials: shared.turn?.denials,
    loops: shared.loops,
    agents: shared.agents,
    runs,
  })
  if (alerts.length === 0) return []
  const head: Line = [{ t: '⚠ ', tone: alerts[0]?.tone ?? 'warn' }]
  // The first `full` alerts in full words, the rest short, the first `kept` shown at all.
  const line = (full: number, kept: number): Line => [
    ...head,
    ...joined(alerts.slice(0, kept).map((a, i) => [{ t: i < full ? a.text : a.short, tone: a.tone }])),
    ...(kept < alerts.length ? [{ t: ` · ${t('status.andMore', { n: alerts.length - kept })}`, tone: 'dim' as const }] : []),
  ]
  const n = alerts.length
  const shortening = first === 0 ? Array.from({ length: n + 1 }, (_, i) => line(n - i, n)) : [line(0, n)]
  const dropping = Array.from({ length: n - 1 }, (_, i) => line(0, n - 1 - i))
  return [...shortening, ...dropping].find(t => cells(t) <= max) ?? fitWords(line(0, 1), max)
}

function fitted(build: (level: Level) => Line[], max: number, first: number): Line {
  let line: Line = []
  for (const level of LEVELS.slice(first)) {
    line = joined(build(level))
    if (cells(line) <= max) return line
  }
  return fitWords(line, max)
}

/**
 * How a drawing site lays the rows: `bars` cells of gauge after each budget figure (none by
 * default), `slack` cells kept free at the right end.
 */
export type Layout = { bars?: number; slack?: number }

/**
 * The status line's rows for a terminal `columns` wide, then a row per background shell `runs`
 * holds; none when the user hid it.
 */
export function statusLines(status: Status, shared: Shared, now: number, columns: number, tz: number, runs: readonly ShellRun[] = [], layout: Layout = {}): Line[] {
  if (shared.mode === 'hidden') return []
  // Two cells of slack by default: the footer's own inset, and a row that never touches the last column.
  const max = Math.max(20, columns - (layout.slack ?? 2))
  const first = shared.mode === 'compact' ? 1 : 0
  const bars = layout.bars ?? 0

  // The gauges are the first thing to give way: with them only at the mode's fullest level.
  const withBars = bars > 0 ? joined(budgets(status, shared, now, tz, LEVELS[first] ?? ALL, bars)) : null
  const lines = [
    fitted(level => work(shared, status, now, level, runs), max, first),
    fitted(level => checkout(shared, level), max, first),
    withBars !== null && cells(withBars) <= max ? withBars : fitted(level => budgets(status, shared, now, tz, level, 0), max, first),
    alerting(shared, now, max, first, runs),
  ]
  return [...lines.filter(line => line.length > 0), ...shellLines(runs, now, max)]
}
