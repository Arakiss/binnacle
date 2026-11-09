// The band above the prompt, decided as data, in the active language (English by default). It
// answers one question first: what is being worked on. So it opens with the heading: what this
// session is about (its goal, as a small model read it from the request and the work, or the
// request itself until it has), what it does now, and what it has so far. Then a line of alerts
// while any stands, and one row per agent, workflow, background shell and other session: who, how
// it stands and since when, and what it is on, in words; with rows to spare each agent gets a
// second line with its goal and what it has so far. Last, the foot: the model and its effort, each
// budget as a gauge, the repo and branch, the pull request, and the band's own buttons.
//
// Every item may carry a card the surface reveals under the pointer, a hotkey and press, or a
// link; the gauges and spinners are animated surface modules the view mounts. Colours are Tokyo
// Night, a popular terminal theme. Each line drops detail until it fits; nothing wraps.
// Pure: the hook, the tests and tools/preview.ts lay the same lines.

import { t, tn } from '../i18n'
import { alertsOf, type Alert } from '../model/alerts'
import { isSame, matesShown } from '../model/fleet'
import type { Liveness } from '../model/liveness'
import { STALL_MS } from '../model/activity'
import { RECENT_MS, type ShellRun } from '../model/shells'
import { peerWords, untilFull } from '../model/signals'

export { peerWords }
import type { Brief, Ci, Finished, Git, Mate, Meter, Peer, Pr, Sample, Shared, Snapshot, Story, Trail } from '../types'
import { judged, SIGN, tallyOf, word, type Judged } from './agents'
import { dollars, weekday } from './format'
import { gaugeCells } from './gauge'
import { ordered } from './shells'
import { cutWords, type Tone } from './text'

/**
 * Each tone as the theme names it, for the pane. Values take the theme's own text colour and
 * secondary text its grey (`inactive`); never `dimColor` nor `subtle`, which fade on a dark background.
 */
export const THEME: Record<Tone, { color: string; bold?: boolean }> = {
  plain: { color: 'text' },
  dim: { color: 'inactive' },
  accent: { color: 'suggestion' },
  heading: { color: 'suggestion', bold: true },
  strong: { color: 'text', bold: true },
  good: { color: 'success' },
  warn: { color: 'warning' },
  bad: { color: 'error' },
}

/** Tokyo Night, a popular terminal theme: hex, since the band needs fills the theme keys do not name. */
export const PALETTE = {
  ink: '#1a1b26',
  text: '#c0caf5',
  dim: '#737aa2',
  blue: '#7aa2f7',
  cyan: '#7dcfff',
  lavender: '#bb9af7',
  green: '#9ece6a',
  amber: '#e0af68',
  red: '#f7768e',
  /** A gauge's unlit cells. */
  track: '#3b4261',
  /** The background of a card the pointer reveals, and of a label's chip. */
  card: '#292e42',
  /** A thought: lavender, a step quieter. */
  mauve: '#9d7cd8',
  /** A chip's words: between the grey and the text. */
  label: '#a9b1d6',
} as const

/** The half circles that round the model's pill (Nerd Font glyphs). */
const PILL = { left: '', right: '' } as const

/** The branch glyph (Nerd Font). */
const BRANCH = ''

export type BandInput = {
  now: number
  /** Local offset from UTC in minutes. */
  tz: number
  /** The model as a person reads it: "Opus 5.5". */
  model: string
  /** The effort the last request of the main loop asked for: "high". */
  effort?: string
  /** When the session started, in milliseconds. */
  startedAt?: number
  snapshot: Snapshot | null
  shared: Shared
  pr?: Pr | null
  runs: readonly ShellRun[]
  /** The other sessions the peers command lists; the live ones get a row each. */
  peers?: readonly Peer[]
  /** The engine's word on whether a turn runs; the HUD's own record may lag it. */
  isWorking: boolean
  /** The other sessions that run binnacle, as their state files tell. */
  mates?: readonly Mate[]
  /** What each loop thinks at this moment, by loop: `main`, or an agent's id. */
  live?: Readonly<Record<string, Live>>
}

/** The tail of the thinking a loop streams now; gone when its step ends. */
export type Live = { thinking?: string }

/** The key of the main loop in `BandInput.live`. */
export const MAIN = 'main'

export type TextPart = { kind: 'text'; t: string; color?: string; bg?: string; bold?: boolean; italic?: boolean }
/** An animated gauge; `id` keeps its instance, and so its animation, across redraws. */
export type GaugePart = { kind: 'gauge'; id: string; value: number; colour: string; inner: number }
/** An animated spinner; `id` keeps its instance across redraws. */
export type SpinnerPart = { kind: 'spinner'; id: string; colour: string }
export type Part = TextPart | GaugePart | SpinnerPart

/** What a band button does; the hook runs it. */
export type Action = 'panel' | 'reap'

/**
 * One item of a line: its parts in a row, and at most one of a card revealed under the pointer, a
 * press (a hotkey while the band holds the focus, or a click), or a link.
 */
export type Item = { key: string; parts: Part[]; card?: TextPart[]; press?: { hotkey: string; label: string; action: Action }; href?: string }

/** A line; `tight` sits it right under the one before, with no row of air between. */
export type BandLine = { left: Item[]; right: Item[]; tight?: true }

/** Cells between two items of a line, and the least between its left and right groups. */
export const GAP = 3

const text = (t: string, color: string = PALETTE.text, bold = false): TextPart => ({ kind: 'text', t, color, ...(bold ? { bold: true } : {}) })
const dim = (t: string) => text(t, PALETTE.dim)

const partCells = (part: Part) => (part.kind === 'text' ? [...part.t].length : part.kind === 'gauge' ? gaugeCells(part.inner) : 1)

/** Cells an item takes on its line. */
export const itemCells = (item: Item) => (item.press ? [...`${item.press.hotkey}: ${item.press.label}`].length : item.parts.reduce((n, p) => n + partCells(p), 0))

/** Cells a line takes, the gaps included. */
export function lineCells(line: BandLine): number {
  const side = (items: readonly Item[]) => (items.length === 0 ? 0 : items.reduce((n, i) => n + itemCells(i), 0) + GAP * (items.length - 1))
  return side(line.left) + side(line.right) + (line.left.length > 0 && line.right.length > 0 ? GAP : 0)
}

/** The fullest of `levels` renderings that fits `w` cells, else the sparest with its last items left out until it fits. */
function fitted(build: (level: number) => BandLine, levels: number, w: number): BandLine {
  for (let level = 0; level < levels; level += 1) {
    const line = build(level)
    if (lineCells(line) <= w) return line
  }
  const sparest = build(levels - 1)
  let left = sparest.left
  let right = sparest.right
  while (lineCells({ left, right }) > w && right.length > 0) right = right.slice(0, -1)
  while (lineCells({ left, right }) > w && left.length > 1) left = left.slice(0, -1)
  return { left, right }
}

// ── Words for time and size ──────────────────────────────────────────────────────────────────

/** "45s", "12m", "3h15m", "4d13h": durations as status lines write them. */
export function compact(ms: number): string {
  const s = Math.max(0, Math.round(ms / 1000))
  if (s < 60) return `${s}s`
  const m = Math.round(s / 60)
  if (m < 60) return `${m}m`
  const d = Math.floor(m / 1440)
  const h = Math.floor((m % 1440) / 60)
  if (d > 0) return h > 0 ? `${d}d${h}h` : `${d}d`
  return m % 60 > 0 ? `${h}h${m % 60}m` : `${h}h`
}

/** "49k", "1M", "1.2M". */
export function size(n: number): string {
  if (n >= 1e6) return `${Number((n / 1e6).toFixed(1))}M`
  if (n >= 1000) return `${Math.round(n / 1000)}k`
  return String(n)
}


/** "20:50", "tomorrow 09:00", "Sat 03:00", in the local offset `tz` (minutes). */
export function at(ms: number, now: number, tz: number): string {
  const local = new Date(ms + tz * 60_000)
  const day = (t: number) => Math.floor((t + tz * 60_000) / 86_400_000)
  const clock = `${String(local.getUTCHours()).padStart(2, '0')}:${String(local.getUTCMinutes()).padStart(2, '0')}`
  const days = day(ms) - day(now)
  if (days <= 0) return clock
  if (days === 1) return t('when.short.tomorrow', { time: clock })
  return t('when.short.weekday', { day: weekday(local.getUTCDay(), true), time: clock })
}


const TICKS = ['▁', '▂', '▃', '▄', '▅', '▆', '▇', '█']

/** The readings of a share as ticks from 0% to 100%; empty with fewer than two. */
function sparkline(samples: readonly Sample[]): string {
  if (samples.length < 2) return ''
  return samples
    .slice(-12)
    .map(s => TICKS[Math.round((Math.min(100, Math.max(0, s.p)) / 100) * (TICKS.length - 1))] ?? '▁')
    .join('')
}

// ── The foot's left: the model and the budgets ───────────────────────────────────────────────

const HOUR = 3_600_000
const DAY = 24 * HOUR

/** How long each rate-limit window lasts, to read how far into it the session is. */
const WINDOW_MS: Record<string, number> = { five_hour: 5 * HOUR, seven_day: 7 * DAY, seven_day_opus: 7 * DAY, seven_day_sonnet: 7 * DAY }

/** Share of its window already gone at `now`, 0 to 1; null when the window's length or end is unknown. */
export function elapsedOf(limit: Meter, now: number): number | null {
  const length = WINDOW_MS[limit.kind]
  if (length === undefined || limit.resetsAt === undefined) return null
  return Math.min(1, Math.max(0, 1 - (limit.resetsAt - now) / length))
}

/** How far ahead of the clock a window may run before it is flagged, as a share of the window. */
const PACE_SLACK = 0.2

/**
 * Whether a window runs ahead of the clock: half spent at least, and more than PACE_SLACK past the
 * share of the window gone (60% a day and a half into the week runs out by Wednesday).
 */
export function isAheadOfPace(limit: Meter, now: number): boolean {
  const elapsed = elapsedOf(limit, now)
  return elapsed !== null && limit.percent >= 50 && limit.percent / 100 > elapsed + PACE_SLACK
}

/** A window's colour: cyan, amber from 75% or ahead of the clock, red from 90% or when it fills before it resets. */
export function quotaColour(limit: Meter, now: number, isFilling: boolean): string {
  if (limit.percent >= 90 || isFilling) return PALETTE.red
  if (limit.percent >= 75 || isAheadOfPace(limit, now)) return PALETTE.amber
  return PALETTE.cyan
}

/** The context's colour: cyan, amber from 70%, red from 85%, where a compaction comes soon. */
export function contextColour(value: number): string {
  if (value >= 85) return PALETTE.red
  if (value >= 70) return PALETTE.amber
  return PALETTE.cyan
}

/** Cells inside a gauge at its fullest and at its shorter rendering. */
export const GAUGE_INNER = 10
const GAUGE_SHORT = 6

const WINDOW_NAME: Record<string, string> = { five_hour: '5h', seven_day: '7d', seven_day_opus: '7d opus', seven_day_sonnet: '7d sonnet' }

function modelItem(input: BandInput, withEffort: boolean): Item {
  const label = ` ✳ ${input.model}${withEffort && input.effort ? ` · ${input.effort}` : ''} `
  const started = input.startedAt === undefined ? '' : ` · ${t('band.session', { time: compact(input.now - input.startedAt) })}`
  return {
    key: 'model',
    parts: [text(PILL.left, PALETTE.lavender), { kind: 'text', t: label, color: PALETTE.ink, bg: PALETTE.lavender, bold: true }, text(PILL.right, PALETTE.lavender)],
    card: [dim(`${input.model}${input.effort ? ` · ${t('band.effort', { effort: input.effort })}` : ''}${started}`)],
  }
}

type Budget = { key: string; name: string; value: number; colour: string; tail: TextPart[]; card: TextPart[] }

function budgetsOf(input: BandInput, shared: Shared, level: number): Budget[] {
  const now = input.now
  const out: Budget[] = []
  const snapshot = input.snapshot
  const ctx = snapshot?.percent
  if (ctx !== undefined) {
    const colour = contextColour(ctx)
    const used = snapshot?.tokens === undefined ? '' : `${size(snapshot.tokens)}/${size(snapshot.window)}`
    const urge = ctx >= 85 ? [text(` ${t('band.compactNow')}`, PALETTE.red)] : []
    out.push({
      key: 'ctx',
      name: 'ctx',
      value: ctx,
      colour,
      tail: [...(used !== '' && level < 1 ? [dim(` ${used}`)] : []), ...urge],
      card: [dim(t('band.ctx.card', { used: snapshot?.tokens?.toLocaleString(t('number.locale')) ?? '?', window: snapshot?.window.toLocaleString(t('number.locale')) ?? '?', free: Math.round(100 - ctx) }))],
    })
  }
  // The five-hour window first, then the week, then any other, whatever order the engine lists them in.
  const rank = (kind: string) => (kind === 'five_hour' ? 0 : kind === 'seven_day' ? 1 : 2)
  for (const limit of [...(snapshot?.limits ?? [])].sort((x, y) => rank(x.kind) - rank(y.kind))) {
    const samples = shared.history?.[limit.kind] ?? []
    const fills = untilFull(samples)
    const resetsIn = limit.resetsAt === undefined ? null : limit.resetsAt - now
    const isFilling = fills !== null && (resetsIn === null || fills < resetsIn)
    const colour = quotaColour(limit, now, isFilling)
    const isFlagged = isFilling || isAheadOfPace(limit, now)
    const tail: TextPart[] = [
      ...(isFlagged ? [text(' ▲', colour)] : []),
      ...(isFilling ? [text(` ${t('band.fillsIn', { time: compact(fills ?? 0) })}`, PALETTE.red)] : resetsIn !== null && level < 2 ? [dim(` ↻ ${compact(resetsIn)}`)] : []),
    ]
    const elapsed = elapsedOf(limit, now)
    const pace = elapsed === null ? '' : ` · ${t(isAheadOfPace(limit, now) ? 'band.windowGoneAhead' : 'band.windowGone', { gone: Math.round(elapsed * 100) })}`
    const trend = sparkline(samples)
    out.push({
      key: limit.kind,
      name: WINDOW_NAME[limit.kind] ?? limit.kind.replace(/_/g, ' '),
      value: limit.percent,
      colour,
      tail,
      card: [dim(`${limit.resetsAt === undefined ? t('band.noReset') : t('band.resets', { when: at(limit.resetsAt, now, input.tz) })}${pace}`), ...(trend === '' ? [] : [dim(' · '), text(trend, colour)])],
    })
  }
  return out
}

/** The budgets that ask for attention, as notices: a context near compaction, a window that fills or runs ahead of the clock. */
export function budgetNotices(snapshot: Snapshot | null, shared: Shared, now: number): Notice[] {
  const out: Notice[] = []
  const ctx = snapshot?.percent
  if (ctx !== undefined && ctx >= 85) out.push({ key: 'ctx', tone: 'bad', long: t('notice.ctx', { percent: Math.round(ctx) }), short: t('notice.ctx.short', { percent: Math.round(ctx) }), fix: t('notice.ctx.fix') })
  for (const limit of snapshot?.limits ?? []) {
    const name = WINDOW_NAME[limit.kind] ?? limit.kind
    const fills = untilFull(shared.history?.[limit.kind] ?? [])
    const isFilling = fills !== null && (limit.resetsAt === undefined || fills < limit.resetsAt - now)
    if (isFilling) out.push({ key: `fill:${limit.kind}`, tone: 'bad', long: t('notice.fill', { name, time: compact(fills ?? 0) }), short: t('notice.fill.short', { name }), fix: t('notice.fill.fix') })
    else if (isAheadOfPace(limit, now)) out.push({ key: `pace:${limit.kind}`, tone: 'warn', long: t('notice.pace', { name, percent: Math.round(limit.percent) }), short: t('notice.pace.short', { name }), fix: t('notice.pace.fix') })
  }
  return out
}

function budgetItem(b: Budget, inner: number): Item {
  return {
    key: b.key,
    parts: [dim(`${b.name} `), ...(inner > 0 ? [{ kind: 'gauge' as const, id: b.key, value: b.value, colour: b.colour, inner }, text(' ')] : []), text(`${Math.round(b.value)}%`, b.colour, true), ...b.tail],
    card: b.card,
  }
}

// ── The foot's right: where, and how the session goes ────────────────────────────────────────

function repoItem(git: Git | null | undefined, crowd: number, level: number): Item {
  if (!git) return { key: 'repo', parts: [dim(t('band.noGit'))] }
  const branch = git.branch.replace(/^\((.*)\)$/, '$1')
  const company = crowd > 0 ? tn('alert.crowd.short', crowd) : t('band.aloneHere')
  return {
    key: 'repo',
    parts: [
      ...(level < 5 ? [text(git.repo, PALETTE.text, true), text(' ')] : []),
      dim(`${BRANCH} `),
      text(cutWords(branch, level < 4 ? 40 : 16), PALETTE.blue),
      ...(git.dirty > 0 ? [text(` ●${git.dirty}`, PALETTE.amber)] : []),
      ...(git.ahead > 0 && level < 4 ? [dim(` ↑${git.ahead}`)] : []),
      ...(git.behind > 0 && level < 4 ? [text(` ↓${git.behind}`, PALETTE.amber)] : []),
    ],
    card: [dim(`${tn('band.uncommittedFiles', git.dirty)} · ${t('git.ahead', { n: git.ahead })} · ${t('git.behind', { n: git.behind })} · ${company}`)],
  }
}

function prItem(pr: Pr | null | undefined, ci: Ci | null | undefined, level: number): Item[] {
  if (!pr) return []
  const checks: TextPart[] =
    !ci || level >= 3
      ? []
      : ci.fail > 0
        ? [text(` ✗ ${ci.fail}/${ci.pass + ci.fail + ci.pending}`, PALETTE.red)]
        : ci.pending > 0
          ? [text(' ◌', PALETTE.amber)]
          : [text(' ✓', PALETTE.green)]
  return [{ key: 'pr', parts: [text(`#${pr.number}`, PALETTE.cyan), ...checks], ...(pr.url ? { href: pr.url } : {}) }]
}

function sessionItem(input: BandInput, shared: Shared, level: number): Item {
  const now = input.now
  const turn = shared.turn
  const agents = shared.agents ?? []
  const last = shared.last
  const card = [
    dim(
      [
        last ? `${t('status.lastTurn', { time: compact(last.seconds * 1000) })}, ${tn('count.actions', last.actions)}` : t('band.noTurnYet'),
        agents.length > 0 ? t('band.agentsList', { names: agents.map(a => a.name).join(', ') }) : '',
        input.startedAt === undefined ? '' : t('band.session', { time: compact(now - input.startedAt) }),
      ]
        .filter(Boolean)
        .join(' · '),
    ),
  ]
  // A stalled agent is counted in red at every level: the one fact this line never drops.
  const crew = agents.length > 0 ? ` · ${tn('count.agents', agents.length)}` : ''
  const stalled = tallyOf(judged(agents, input.runs, now)).stalled
  const loud = stalled > 0 ? [text(` · ${SIGN.stalled} ${tn('count.stalled', stalled)}`, PALETTE.red, true)] : []
  if (turn) {
    return {
      key: 'session',
      parts: [{ kind: 'spinner', id: 'session', colour: PALETTE.amber }, text(` ${t('band.working', { time: compact(now - turn.startedAt) })}`), ...(level < 2 ? [dim(` · ${tn('count.actions', turn.actions)}${crew}`)] : []), ...loud],
      card,
    }
  }
  const age = input.startedAt === undefined ? (last ? t('band.idle') : t('band.newSession')) : t('band.session', { time: compact(now - input.startedAt) })
  return { key: 'session', parts: [dim(`${age}${level < 2 ? crew : ''}`), ...loud], card }
}

/**
 * The foot: the model and the budgets on the left; the repo, the pull request and the band's
 * buttons on the right. `withSession` adds how the session goes, for a band with no heading to say it.
 */
function footLine(input: BandInput, shared: Shared, w: number, withSession: boolean): BandLine {
  const loops = shared.loops ?? 0
  const crowd = shared.crowd ?? 0
  const usd = input.snapshot?.usd
  const isPaid = (input.snapshot?.limits.length ?? 0) === 0 && usd !== undefined && usd > 0
  // Detail gives way in order: the other sessions here, the context's token count, the reset
  // times, the gauges' length, the effort in the pill, the gauges, the checks, the branch's length
  // and sync, the pill, the repo's name, the buttons.
  return fitted(
    level => {
      const inner = level < 3 ? GAUGE_INNER : level < 5 ? GAUGE_SHORT : 0
      return {
        left: [
          ...(level < 7 ? [modelItem(input, level < 4)] : []),
          ...budgetsOf(input, shared, level).map(b => budgetItem(b, inner)),
          ...(isPaid ? [{ key: 'cost', parts: [dim(`${t('status.cost')} `), text(dollars(usd ?? 0))] }] : []),
        ],
        right: [
          ...(withSession ? [sessionItem(input, shared, level)] : []),
          repoItem(shared.git, crowd, level < 6 ? 0 : level < 8 ? 4 : 5),
          ...prItem(input.pr, shared.ci, level < 6 ? 0 : 3),
          ...(crowd > 0 && level < 1 ? [{ key: 'crowd', parts: [dim(t('band.crowd', { n: crowd }))], card: [dim(t('band.crowd.card'))] }] : []),
          ...(level < 9
            ? [
                ...(loops > 0 ? [{ key: 'reap', parts: [], press: { hotkey: 'r', label: t('band.reap', { n: loops }), action: 'reap' as const } }] : []),
                { key: 'panel', parts: [], press: { hotkey: 'p', label: 'panel', action: 'panel' as const } },
              ]
            : []),
        ],
      }
    },
    10,
    w,
  )
}

// ── The heading: what this session is about, what it does now, what it has so far ─────────────

/** A story's brief while it is of the request that stands; one read before the newest request is of another task. */
export function briefOf(story: Story | undefined): Brief | undefined {
  const brief = story?.brief
  return brief !== undefined && brief.at >= (story?.askedAt ?? 0) ? brief : undefined
}

/** "12 reads · 3 edits in band.ts · 5 commands": a trail's calls by what they did, and the files it edited last. */
export function trailWords(trail: Trail | undefined): string {
  if (trail === undefined) return ''
  const names = trail.files.slice(0, 2).map(file => file.split('/').pop() ?? file)
  return [
    trail.read > 0 ? tn('trail.read', trail.read) : '',
    trail.search > 0 ? tn('trail.search', trail.search) : '',
    trail.edit > 0 ? `${tn('trail.edit', trail.edit)}${names.length > 0 ? ` ${t('trail.files', { files: names.join(', ') })}` : ''}` : '',
    trail.run > 0 ? tn('trail.run', trail.run) : '',
    trail.web > 0 ? tn('trail.web', trail.web) : '',
    trail.agent > 0 ? tn('trail.agent', trail.agent) : '',
  ]
    .filter(Boolean)
    .join(' · ')
}

/** The mark before a call that runs now, and before a thought that streams now. */
const CALL_MARK = '▸'
const THOUGHT_MARK = '∴'

/**
 * What a loop at work is on: its words (`now`: the brief's, else its own last ones), then dim the
 * pulse under them, the call that runs or the thought that streams. Without words the call stands
 * in their place; with neither, `idle`.
 */
function voice(now: string | undefined, call: string | undefined, live: Live | undefined, idle: TextPart[]): TextPart[] {
  const hasCall = call !== undefined && call !== ''
  const thought: TextPart[] = live?.thinking ? [text(`${THOUGHT_MARK} `, PALETTE.mauve), { kind: 'text', t: live.thinking, color: PALETTE.mauve, italic: true }] : []
  if (now === undefined || now === '') return hasCall ? [text(call)] : thought.length === 0 ? idle : thought
  const pulse: TextPart[] = hasCall ? [text(`${CALL_MARK} `, PALETTE.cyan), dim(call)] : thought
  return [text(now), ...(pulse.length === 0 ? [] : [text('  '), ...pulse])]
}

/** The rail down the heading's left edge, one cell per line: lavender running to cyan, so the block reads as one. */
const RAIL = '▍'
const RAIL_COLOURS = [PALETTE.lavender, PALETTE.blue, PALETTE.cyan] as const
const rail = (line: number): TextPart => text(RAIL, RAIL_COLOURS[Math.min(line, RAIL_COLOURS.length - 1)])

/** Cells the heading's lines open with: the rail and a space. */
const RAIL_CELLS = 2

/**
 * A labelled line of the heading: the rail, the label as a chip in its column under the goal, then
 * the parts cut to the width.
 */
function labelled(key: string, line: number, label: string, labelW: number, parts: readonly TextPart[], w: number): BandLine {
  const chip: TextPart = { kind: 'text', t: ` ${label.padEnd(labelW)} `, color: PALETTE.label, bg: PALETTE.card }
  const lead = RAIL_CELLS + 2 + labelW + 2 + 2
  return { left: [{ key, parts: [rail(line), text('   '), chip, text('  '), ...cutParts(parts, Math.max(0, w - lead))] }], right: [], tight: true }
}

const TICK = ['▁', '▂', '▃', '▄', '▅', '▆', '▇', '█']

/** A pulse as ticks: each span's calls against the busiest span (three at least, so one call is not a peak). */
function pulseParts(pulse: readonly number[] | undefined, colour: string): TextPart[] {
  if (pulse === undefined || pulse.every(n => n === 0)) return []
  const top = Math.max(3, ...pulse)
  return [text(pulse.map(n => TICK[Math.round((n / top) * (TICK.length - 1))] ?? '▁').join(''), colour), text(' ')]
}

/**
 * The heading, three lines at most: the goal with how the turn goes on its right; what the loop
 * does now (or, between turns, how the last one ended); what it has so far. None before the
 * session was asked anything; a turn that runs unasked gets the first line alone, with its call.
 */
export function mainLines(input: BandInput, shared: Shared, w: number): BandLine[] {
  const story = shared.story ?? {}
  const ask = story.asks?.at(-1)
  const turn = shared.turn
  // A turn nobody asked for in words (a continuation, a reload mid-turn) still says what it does.
  if (ask === undefined && !turn) return []
  const now = input.now
  const brief = briefOf(story)
  const stalled = tallyOf(judged(shared.agents, input.runs, now)).stalled
  const loud = stalled > 0 ? [text(`${SIGN.stalled} ${tn('count.stalled', stalled)}`, PALETTE.red, true)] : []
  const going = turn
    ? `${t('band.working', { time: compact(now - turn.startedAt) })} · ${tn('count.actions', turn.actions)}`
    : shared.last
      ? t('main.ended', { time: compact(now - shared.last.endedAt) })
      : t('band.idle')
  const sign: Part = turn ? { kind: 'spinner', id: 'main', colour: PALETTE.amber } : text('◆', PALETTE.lavender)
  const unasked = turn?.doing ?? (turn?.previous ? t('row.thinkingAfter', { last: turn.previous }) : t('row.thinking'))
  const words = brief?.goal || ask || unasked
  // The goal keeps the line: how the turn goes sits right while the whole goal fits beside it,
  // first without its count of actions, then as the stalled count alone, then not at all.
  const tail = loud.length > 0 ? [dim(' · '), ...loud] : []
  const states: Item[] = [
    ...(turn ? [{ key: 'going', parts: [...pulseParts(shared.pulse, PALETTE.amber), dim(going), ...tail] }] : []),
    { key: 'going', parts: [dim(going), ...tail] },
    ...(turn ? [{ key: 'going', parts: [dim(t('band.working', { time: compact(now - turn.startedAt) })), ...tail] }] : []),
    ...(loud.length > 0 ? [{ key: 'going', parts: loud }] : []),
  ]
  const state = states.find(item => [...words].length <= w - RAIL_CELLS - 2 - itemCells(item) - GAP)
  const head: BandLine = {
    left: [{ key: 'goal', parts: [rail(0), text(' '), sign, text(' '), text(cutWords(words, Math.max(8, w - RAIL_CELLS - 2)), '#ffffff', true)], ...(ask === undefined ? {} : { card: [dim(t('main.asked', { ask }))] }) }],
    right: state === undefined ? [] : [state],
  }
  if (ask === undefined) return [head]
  const labels = [turn ? t('main.now') : t('main.result'), t('main.soFar')]
  const labelW = Math.max(...labels.map(label => [...label].length))
  const trail = trailWords(story.trail)
  if (turn) {
    const doing = voice(brief?.now || story.said, turn.doing, input.live?.[MAIN], [dim(t('row.thinking'))])
    const done = brief?.done ?? ''
    const soFar = [...(done === '' ? [] : [text(done, PALETTE.green)]), ...(trail === '' ? [] : [dim(done === '' ? trail : `  ${trail}`)])]
    return [head, labelled('now', 1, labels[0] ?? '', labelW, doing, w), ...(soFar.length > 0 ? [labelled('so-far', 2, labels[1] ?? '', labelW, soFar, w)] : [])]
  }
  // Between turns: the brief speaks once it has read the turn's end; until then, the answer's own opening.
  const isRead = brief !== undefined && brief.at >= (story.outcomeAt ?? 0)
  const result = (isRead ? brief.now : '') || story.outcome || ''
  const done = isRead && brief.done !== '' && brief.done !== result ? brief.done : ''
  return [
    head,
    ...(result === '' ? [] : [labelled('result', 1, labels[0] ?? '', labelW, [text(result)], w)]),
    ...(done === '' ? [] : [labelled('so-far', 2, labels[1] ?? '', labelW, [text(done, PALETTE.green), ...(trail === '' ? [] : [dim(`  ${trail}`)])], w)]),
  ]
}

// ── The alerts: what asks for attention ──────────────────────────────────────────────────────

/** An alert, with a key that stays the same while the alert lasts and what resolves it. */
export type Notice = { key: string; tone: 'bad' | 'warn'; long: string; short: string; fix: string }

/** The alerts, in the same words as the status line and the pane. */
export function noticesOf(shared: Shared, now: number, runs: readonly ShellRun[] = []): Notice[] {
  const loops = shared.loops ?? 0
  return alertsOf({ now, ci: shared.ci, turnDenials: shared.turn?.denials, loops, agents: shared.agents, runs }).map((alert: Alert): Notice => {
    const key = alert.agent ? `${alert.kind}:${alert.agent.name}` : alert.kind
    // The band has a button for orphan loops: its key says so where the status line names the command.
    if (alert.kind === 'loops') return { key, tone: alert.tone, long: tn('band.loops', loops), short: tn('alert.loops.short', loops), fix: alert.fix }
    return { key, tone: alert.tone, long: alert.text, short: alert.short, fix: alert.fix }
  })
}

/** An agent's colour in the band, by how it stands. */
const LIVE_COLOUR: Record<Liveness, string> = { working: PALETTE.lavender, waiting: PALETTE.dim, stalled: PALETTE.red, done: PALETTE.green, unknown: PALETTE.amber }

/** The alerts no row below already tells: an agent's stall, silence or owed answer reads on its own row. */
const AGENT_ALERT = /^(stalled|owed|quiet):/

function alertsLine(input: BandInput, shared: Shared, w: number): BandLine {
  const notices = noticesOf(shared, input.now, input.runs).filter(n => !AGENT_ALERT.test(n.key))
  const itemsAt = (isShort: boolean): Item[] =>
    notices.map(n => ({ key: `alert-${n.key}`, parts: [text(`⚠ ${isShort ? n.short : n.long}`, n.tone === 'bad' ? PALETTE.red : PALETTE.amber)], card: [dim(n.fix)] }))
  for (const isShort of [false, true]) {
    const line = { left: itemsAt(isShort), right: [] }
    if (lineCells(line) <= w) return line
  }
  const items = itemsAt(true)
  const counted = (n: number): BandLine => ({ left: [...items.slice(0, n), { key: 'more', parts: [dim(t('more', { n: items.length - n }))] }], right: [] })
  for (let n = items.length - 1; n >= 1; n -= 1) if (lineCells(counted(n)) <= w) return counted(n)
  return counted(1)
}

// ── The rows: one per agent, workflow, shell and other session, and the main loop beside them ─

/** The most rows the band gives to its rows; past it, the rest are counted on one more row. */
export const DETAIL_ROWS = 10

/** What opens a row's second line, under its name. */
const DETAIL_LEAD = '  ╰ '

/** The widest the who and the state columns grow. */
const WHO_MAX = 22
const STATE_MAX = 20

/**
 * One row as columns: a sign, who (an agent, a workflow, the main loop, a shell's owner, another
 * session), how it stands and since when, and what it does in its own words. `rank` orders the
 * rows: what needs the user first. `kind` says what a hidden row was, for the count.
 */
type Row = {
  key: string
  kind: 'agent' | 'workflow' | 'shell' | 'main' | 'peer'
  rank: number
  sign: Part
  who: string
  whoColour: string
  state: string
  stateColour: string
  what: TextPart[]
  card: TextPart[]
  /** A second line under the row, drawn while the band has rows to spare: its goal and what it has so far. */
  detail?: TextPart[]
}

/** "Bash · Ejecutar los tests": a call as the agent described it, the tool first. */
function callWords(tool: string, words: string): string {
  const said = words.trim()
  return said === '' ? tool : `${tool} · ${said}`
}

/**
 * Ranks, most urgent first: a stall; an unknown; a failed shell, an owed answer or a silent turn;
 * the work (agents, workflows); running shells; waits; what ended; other sessions.
 */
const RANK: Record<Liveness, number> = { stalled: 0, unknown: 1, working: 3, waiting: 5, done: 8 }

function agentRow(j: Judged, now: number, live?: Live): Row {
  const { agent: a, verdict: v } = j
  const id = a.id ?? a.name
  const doing = a.doing
  const story = a.story
  const brief = briefOf(story)
  const goal = brief?.goal || story?.asks?.at(-1) || ''
  const quiet = doing === undefined ? [dim(t('row.thinking'))] : [dim(t('row.thinkingAfter', { last: callWords(doing.tool, doing.text) }))]
  const call = doing?.running ? callWords(doing.tool, doing.text) : undefined
  // At work, what it is on; in any other state, why it stands so, then what it was on.
  const what: TextPart[] =
    v.state === 'working'
      ? voice(brief?.now || story?.said, call, live, quiet)
      : [text(v.why, v.state === 'stalled' ? PALETTE.red : v.state === 'unknown' ? PALETTE.amber : PALETTE.dim), ...(goal === '' ? [] : [dim(` · ${goal}`)])]
  const since = v.state === 'working' && doing?.running ? doing.at : v.since
  // The two quiet troubles: an answer owed this long, a turn this silent.
  const isOwed = v.state === 'waiting' && v.wakers.some(w => w.kind === 'reply') && now - (a.sentAt ?? now) >= STALL_MS
  const isSilent = v.state === 'working' && a.busy === 0 && now - a.lastAt >= STALL_MS
  const state = isSilent ? t('row.silent', { time: compact(now - a.lastAt) }) : `${word(v.state)} ${compact(now - (isOwed ? (a.sentAt ?? since) : since))}`
  const trail = trailWords(story?.trail)
  const detail = [goal, brief?.done ? t('row.soFar', { done: brief.done }) : '', trail].filter(Boolean).join(' · ')
  return {
    key: `agent-${id}`,
    kind: 'agent',
    rank: isOwed || isSilent ? 2 : RANK[v.state],
    sign: v.state === 'working' ? { kind: 'spinner', id: `agent-${id}`, colour: PALETTE.lavender } : text(SIGN[v.state], LIVE_COLOUR[v.state]),
    who: a.name,
    whoColour: v.state === 'working' ? PALETTE.text : v.state === 'waiting' ? PALETTE.lavender : LIVE_COLOUR[v.state],
    state,
    stateColour: isOwed || isSilent ? PALETTE.amber : v.state === 'working' || v.state === 'waiting' ? PALETTE.dim : LIVE_COLOUR[v.state],
    what: isOwed ? [text(t('row.owed', { why: v.why }), PALETTE.amber)] : what,
    card: [dim(`${a.name} · ${word(v.state)} ${compact(now - v.since)} · ${v.why}${doing ? ` · ${t(doing.running ? 'row.now' : 'row.last', { call: callWords(doing.tool, doing.text) })}` : ''}`)],
    ...(detail === '' ? {} : { detail: [dim(detail)] }),
  }
}

/** An agent that handed its report back a moment ago: how the report opens. */
function finishedRow(f: Finished, now: number): Row {
  return {
    key: `finished-${f.id}`,
    kind: 'agent',
    rank: 7,
    sign: text(SIGN.done, PALETTE.green),
    who: f.name,
    whoColour: PALETTE.dim,
    state: `${t('row.reported')} ${compact(now - f.endedAt)}`,
    stateColour: PALETTE.dim,
    what: [text(f.outcome)],
    card: [dim(`${f.name} · ${f.outcome}`)],
  }
}

/**
 * Another session that runs binnacle, from its own state file: its goal, then what it does now or
 * how its last turn ended. Named as the sessions command names it (`peer`), else by its repo.
 */
function mateRow(mate: Mate, peer: Peer | undefined, now: number): Row {
  const isWorking = mate.turnStartedAt !== undefined
  const where = [mate.repo, mate.branch].filter(Boolean).join(' · ')
  const tail = isWorking ? mate.now : mate.outcome
  return {
    key: `peer-${mate.session}`,
    kind: 'peer',
    rank: 9,
    sign: isWorking ? { kind: 'spinner', id: `peer-${mate.session}`, colour: PALETTE.cyan } : text('◆', PALETTE.cyan),
    who: peer === undefined ? (mate.repo ?? t('peer.session')) : peerWords(peer).name,
    whoColour: PALETTE.cyan,
    state: isWorking ? `${word('working')} ${compact(now - (mate.turnStartedAt ?? now))}` : mate.endedAt === undefined ? t('band.idle') : t('main.ended', { time: compact(now - mate.endedAt) }),
    stateColour: PALETTE.dim,
    what: [...(peer !== undefined && mate.repo ? [dim(`${mate.repo} · `)] : []), text(mate.goal ?? ''), ...(tail ? [text(`  ${isWorking ? CALL_MARK : SIGN.done} `, isWorking ? PALETTE.cyan : PALETTE.green), dim(tail)] : [])],
    card: [dim([where, mate.agents > 0 ? tn('count.agents', mate.agents) : ''].filter(Boolean).join(' · ') || t('peer.session'))],
  }
}

/** "3 working, 1 waiting": a workflow's agents by how they stand. */
function workflowTally(list: readonly Judged[]): string {
  const n = tallyOf(list)
  return [n.working > 0 ? tn('row.workflowWorking', n.working) : '', n.waiting > 0 ? tn('row.workflowWaiting', n.waiting) : '']
    .filter(Boolean)
    .join(', ')
}

/**
 * One row for a workflow's agents at work or waiting: its name, how many, and who works. A
 * workflow's stalled or unknown agent keeps a row of its own, where it reads loud.
 */
function workflowRow(runId: string, list: readonly Judged[], name: string | undefined, now: number): Row {
  const working = list.filter(j => j.verdict.state === 'working')
  const since = Math.min(...list.map(j => j.verdict.since))
  const who = name ?? runId
  return {
    key: `workflow-${runId}`,
    kind: 'workflow',
    rank: working.length > 0 ? RANK.working : RANK.waiting,
    sign: working.length > 0 ? { kind: 'spinner', id: `workflow-${runId}`, colour: PALETTE.lavender } : text(SIGN.waiting, LIVE_COLOUR.waiting),
    who,
    whoColour: PALETTE.text,
    state: `${tn('count.agents', list.length)} ${compact(now - since)}`,
    stateColour: PALETTE.dim,
    what: [text(`${workflowTally(list)}${working.length > 0 ? `: ${working.map(j => j.agent.name).join(', ')}` : ''}`)],
    card: [dim(`${t('row.workflowCard', { name: who, id: runId })} · ${list.map(j => `${j.agent.name} ${word(j.verdict.state)}`).join(' · ')}`)],
  }
}

/** A shell's output this long unchanged reads as silent: a watcher that may be stuck. */
export const SHELL_QUIET_MS = 10 * 60_000

/** One row per shell, or per set of running shells with the same owner and label (`count` of them). */
function shellRow(run: ShellRun, i: number, owner: string, now: number, count = 1): Row | null {
  const base = { key: `shell-${i}`, kind: 'shell' as const, who: owner, whoColour: PALETTE.dim, what: [text(run.label)], card: [dim(`${owner} · ${run.label}`)] }
  if (run.state === 'running') {
    const quiet = run.quietSince === undefined ? 0 : now - run.quietSince
    const isQuiet = quiet >= SHELL_QUIET_MS
    const twice = count > 1 ? [text(` · ${t('row.launchedTimes', { n: count })}`, PALETTE.amber)] : []
    const silent = isQuiet ? [text(` · ${t('row.noOutput', { time: compact(quiet) })}`, PALETTE.amber)] : []
    return {
      ...base,
      rank: 4,
      sign: { kind: 'spinner', id: `shell-${i}`, colour: PALETTE.amber },
      state: `shell ${compact(now - run.startedAt)}${count > 1 ? ` ×${count}` : ''}`,
      stateColour: PALETTE.amber,
      what: [text(run.label), ...twice, ...silent],
      card: [dim(`${owner} · ${run.label}${count > 1 ? ` · ${t('row.duplicates.card', { n: count })}` : ''}${isQuiet ? ` · ${t('row.noOutput.card', { time: compact(quiet) })}` : ''}`)],
    }
  }
  if (run.endedAt === null || now - run.endedAt > RECENT_MS) return null
  const ago = compact(now - run.endedAt)
  if (run.code === null) return { ...base, rank: 7, sign: dim('■'), state: `${t('shell.stopped')} ${ago}`, stateColour: PALETTE.dim, what: [dim(run.label)] }
  if (run.code === 0) return { ...base, rank: 7, sign: text('✓', PALETTE.green), state: `${t('shell.ended')} ${ago}`, stateColour: PALETTE.dim, what: [dim(run.label)] }
  return { ...base, rank: 2, sign: text('✗', PALETTE.red), state: `${t('shell.exit', { code: run.code })} ${ago}`, stateColour: PALETTE.red }
}

/** A live session elsewhere on the bus: who, where, and what it says it does. */
function peerRow(peer: Peer, now: number): Row {
  const { name, mission } = peerWords(peer)
  const where = peer.repo.split('/').filter(Boolean).pop() ?? (peer.place || '?')
  return {
    key: `peer-${peer.session}`,
    kind: 'peer',
    rank: 9,
    sign: text('◆', PALETTE.cyan),
    who: name,
    whoColour: PALETTE.cyan,
    state: `${where} ${compact(now - peer.lastMs)}`,
    stateColour: PALETTE.dim,
    what: mission === '' ? [dim(t('row.noIntent'))] : [text(mission)],
    card: [dim(`${t('row.peerCard', { harness: peer.harness, repo: peer.repo })}${peer.branch ? ` · ${peer.branch}` : ''} · ${t('row.peerLastSignal', { time: compact(now - peer.lastMs) })}`)],
  }
}

/** Every row the band could draw, most urgent first; the main loop has the heading, not a row. */
export function rowsOf(input: BandInput, shared: Shared): Row[] {
  const now = input.now
  const agents = judged(shared.agents, input.runs, now)
  const names = new Map(agents.flatMap(({ agent }) => (agent.id === undefined ? [] : [[agent.id, agent.name] as const])))
  // A workflow's agents at work or waiting share one row; a lone one, or one in trouble, keeps its own.
  const groups = new Map<string, Judged[]>()
  for (const j of agents) {
    const runId = j.agent.workflow
    if (runId === undefined || (j.verdict.state !== 'working' && j.verdict.state !== 'waiting')) continue
    groups.set(runId, [...(groups.get(runId) ?? []), j])
  }
  const grouped = new Set([...groups.values()].filter(list => list.length > 1).flat())
  const workflows = [...groups.entries()].filter(([, list]) => list.length > 1).map(([runId, list]) => workflowRow(runId, list, shared.workflows?.[runId], now))
  // Running shells with the same owner and label are one row with their count: a relaunch that left the first behind.
  const seen = new Map<string, number>()
  const runs = ordered(input.runs)
  for (const run of runs) if (run.state === 'running') seen.set(`${run.agentId ?? ''}\u0000${run.label}`, (seen.get(`${run.agentId ?? ''}\u0000${run.label}`) ?? 0) + 1)
  const drawn = new Set<string>()
  const shells = runs.flatMap((run, i) => {
    const same = `${run.agentId ?? ''}\u0000${run.label}`
    if (run.state === 'running' && drawn.has(same)) return []
    if (run.state === 'running') drawn.add(same)
    const row = shellRow(run, i, run.agentId === undefined ? t('who.main') : (names.get(run.agentId) ?? t('who.agent')), now, run.state === 'running' ? (seen.get(same) ?? 1) : 1)
    return row === null ? [] : [row]
  })
  // A session that runs binnacle tells its own story; the sessions command only names it then.
  const livePeers = (input.peers ?? []).filter(p => p.liveness === 'live')
  const mates = matesShown(input.mates ?? [], now)
  const peers = [...mates.map(m => mateRow(m, livePeers.find(p => isSame(p, m)), now)), ...livePeers.filter(p => !mates.some(m => isSame(p, m))).map(p => peerRow(p, now))]
  const finished = (shared.finished ?? []).map(f => finishedRow(f, now))
  const rows = [...agents.filter(j => !grouped.has(j)).map(j => agentRow(j, now, j.agent.id === undefined ? undefined : input.live?.[j.agent.id])), ...workflows, ...shells, ...peers, ...finished]
  // A stable sort: within a rank, agents in the order they started, then workflows, shells newest first, sessions.
  return rows.map((row, i) => ({ row, i })).sort((x, y) => x.row.rank - y.row.rank || x.i - y.i).map(({ row }) => row)
}

/** `parts` cut to `room` cells: whole while they fit, the one that overflows cut at a word, the rest dropped. */
function cutParts(parts: readonly TextPart[], room: number): TextPart[] {
  const out: TextPart[] = []
  let left = room
  for (const part of parts) {
    const n = [...part.t].length
    if (n <= left) {
      out.push(part)
      left -= n
      continue
    }
    if (left >= 4) out.push({ ...part, t: cutWords(part.t, left) })
    break
  }
  return out
}

/** A row laid in `w` cells with the columns `whoW` and `stateW`: what it does gives way first, then who. */
function rowItem(row: Row, whoW: number, stateW: number, w: number): Item {
  const signCells = partCells(row.sign)
  const fixed = signCells + 1 + whoW + 2 + stateW + 2
  const room = w - fixed
  const what = room >= 8 ? cutParts(row.what, room) : []
  // Short of room for what it does, who narrows to what is left beside the state, four cells at least.
  const whoCol = room >= 8 ? whoW : Math.max(4, Math.min(whoW, w - (signCells + 1 + 2 + stateW)))
  const state = cutWords(row.state, Math.max(4, w - (signCells + 1 + whoCol + 2)))
  return {
    key: row.key,
    parts: [
      row.sign,
      text(' '),
      text(cutWords(row.who, whoCol).padEnd(whoCol), row.whoColour, row.whoColour === PALETTE.text),
      text('  '),
      text(what.length > 0 ? cutWords(state, stateW).padEnd(stateW) : state, row.stateColour),
      ...(what.length > 0 ? [text('  '), ...what] : []),
    ],
    card: row.card,
  }
}

/** What the hidden rows were: "1 agent, 4 shells, 2 sessions, main". */
function hiddenWords(hidden: readonly Row[]): string {
  const n = (kind: Row['kind']) => hidden.filter(r => r.kind === kind).length
  return [
    n('agent') > 0 ? tn('count.agents', n('agent')) : '',
    n('workflow') > 0 ? tn('count.workflows', n('workflow')) : '',
    n('shell') > 0 ? tn('count.shells', n('shell')) : '',
    n('peer') > 0 ? tn('count.sessions', n('peer')) : '',
    n('main') > 0 ? t('who.main') : '',
  ]
    .filter(Boolean)
    .join(', ')
}

/**
 * The rows for `room` lines at most, columns aligned; past the room (or DETAIL_ROWS), the least
 * urgent go and one row counts them. Every row but the first sits tight. With lines to spare for
 * all of them, each row that has a second line (an agent's goal and what it has so far) gets it.
 *
 * This session's rows and other sessions' rows read alike at a glance, so when both share the
 * band, one dim title line sits before the first other session; it takes one of the rows, and is
 * left out when no other session's row would show anyway.
 */
export function detailLines(input: BandInput, shared: Shared, w: number, room: number): BandLine[] {
  const rows = rowsOf(input, shared)
  if (rows.length === 0 || room <= 0) return []
  const most = Math.min(room, DETAIL_ROWS)
  const take = (lines: number) => (rows.length <= lines ? rows : rows.slice(0, Math.max(0, lines - 1)))
  const hasPeer = (list: readonly Row[]) => list.some(r => r.kind === 'peer')
  const isMixed = hasPeer(rows) && rows.some(r => r.kind !== 'peer')
  const isTitled = isMixed && most > 2 && (hasPeer(take(most - 1)) || hasPeer(take(most)))
  const shown = take(isTitled ? most - 1 : most)
  const hidden = rows.slice(shown.length)
  const whoW = Math.min(WHO_MAX, Math.max(4, ...shown.map(r => [...r.who].length)))
  const stateW = Math.min(STATE_MAX, Math.max(...shown.map(r => [...r.state].length)))
  const taken = shown.length + (isTitled ? 1 : 0)
  const isRoomy = hidden.length === 0 && taken + shown.filter(r => r.detail !== undefined).length <= room
  const items: Item[] = []
  for (const row of shown) {
    if (isTitled && row.kind === 'peer' && !items.some(item => item.key === 'peers-title')) {
      const title = cutWords(t('row.peersTitle'), Math.max(4, w - 6))
      items.push({ key: 'peers-title', parts: [text('── ', PALETTE.track), dim(title), text(` ${'─'.repeat(Math.max(0, w - [...title].length - 4))}`, PALETTE.track)] })
    }
    items.push(rowItem(row, whoW, stateW, w))
    if (isRoomy && row.detail !== undefined) items.push({ key: `${row.key}-detail`, parts: [dim(DETAIL_LEAD), ...cutParts(row.detail, Math.max(0, w - [...DETAIL_LEAD].length))] })
  }
  if (hidden.length > 0) {
    const what = hiddenWords(hidden)
    const said = shown.length === 0 ? what : t('row.moreOf', { n: hidden.length, what })
    items.push({ key: 'more', parts: [dim(cutWords(`${said} · ${t('row.openPanel')}`, w))] })
  }
  return items.map((item, i) => ({ left: [item], right: [], ...(i > 0 ? { tight: true } : {}) }))
}

/**
 * The band's lines for `columns` cells and at most `rows` lines; none when the user hid it.
 * The heading first, then the alerts, then a row per agent, shell and session, then the foot.
 * Short of rows they are kept in this order: the heading's goal and what it does now, the foot,
 * the alerts, the rows (counted past the room), the heading's third line, each row's second line.
 */
export function bandLines(input: BandInput, columns: number, rows: number): BandLine[] {
  // A turn the engine says ended reads ended now, before the HUD's own record catches up.
  const shared = input.isWorking || !input.shared.turn ? input.shared : { ...input.shared, turn: null }
  if (shared.mode === 'hidden' || rows <= 0 || columns <= 0) return []
  const main = mainLines(input, shared, columns)
  const alerts = alertsLine(input, shared, columns)
  let room = rows
  const kept = Math.min(main.length, 2, room)
  room -= kept
  const hasFoot = room > 0
  if (hasFoot) room -= 1
  const hasAlerts = alerts.left.length > 0 && room > 0
  if (hasAlerts) room -= 1
  const wanted = Math.min(rowsOf(input, shared).length, DETAIL_ROWS)
  const hasThird = main.length > kept && room > wanted
  if (hasThird) room -= 1
  return [
    ...main.slice(0, kept + (hasThird ? 1 : 0)),
    ...(hasAlerts ? [alerts] : []),
    ...detailLines(input, shared, columns, room),
    ...(hasFoot ? [footLine(input, shared, columns, main.length === 0)] : []),
  ]
}
