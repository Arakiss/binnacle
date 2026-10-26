// Text as runs of one tone each. Colour carries meaning only: dim for labels and everything
// secondary, plain for values, accent (blue) for the one thing to find, heading its bold form for a
// section's title, good (green) done or fine,
// warn (amber) waiting or attention, bad (red) failed or about to fill; strong is bold plain.

export type Tone = 'plain' | 'dim' | 'accent' | 'heading' | 'good' | 'warn' | 'bad' | 'strong'

/**
 * `isSeparator` marks the runs `joined` adds, so a cut line never ends on one; `isChip` draws the
 * run on a background of its tone, in the theme's inverse text, as a chip's label.
 */
export type Seg = { t: string; tone?: Tone; isSeparator?: true; isChip?: true }

export type Line = Seg[]

/** Cells a text takes; every character the HUD prints is one cell wide. */
export const width = (text: string) => [...text].length

export const cells = (line: Line) => line.reduce((n, s) => n + width(s.t), 0)

export const plainText = (line: Line) => line.map(s => s.t).join('')

/** A text cut to `max` cells, an ellipsis where it was cut. */
export function cut(text: string, max: number): string {
  if (max <= 0) return ''
  const chars = [...text]
  return chars.length <= max ? text : `${chars.slice(0, max - 1).join('')}…`
}

/** A line cut to `max` cells, each run keeping its tone. */
export function fit(line: Line, max: number): Line {
  if (cells(line) <= max) return line
  const out: Line = []
  let left = max
  for (const s of line) {
    const n = width(s.t)
    if (n < left) {
      out.push(s)
      left -= n
      continue
    }
    out.push({ ...s, t: cut(s.t, left) })
    break
  }
  return out
}

export function pad(text: string, size: number): string {
  const n = width(text)
  return n >= size ? cut(text, size) : text + ' '.repeat(size - n)
}

export function padStart(text: string, size: number): string {
  const n = width(text)
  return n >= size ? cut(text, size) : ' '.repeat(size - n) + text
}

/** Parts joined by a dim middle dot. */
export function joined(parts: Line[], sep = ' · '): Line {
  return parts.filter(p => p.length > 0).flatMap((p, i) => (i === 0 ? p : [{ t: sep, tone: 'dim' as const, isSeparator: true as const }, ...p]))
}

// A branch reads in pieces split by these; a cut lands after one, never inside a piece.
const BREAKS = /[\s/_-]/

/** A text cut to `max` cells at the last word break that leaves at least half of it, with an ellipsis. */
export function cutWords(text: string, max: number): string {
  if (width(text) <= max) return text
  if (max <= 1) return cut(text, max)
  const chars = [...text].slice(0, max - 1)
  let at = chars.length
  while (at > 0 && !BREAKS.test(chars[at - 1] ?? '')) at -= 1
  const kept = at >= Math.ceil((max - 1) / 2) ? chars.slice(0, at) : chars
  return `${kept.join('').replace(/[\s·/_-]+$/, '')}…`
}

/** A line cut to `max` cells at a word break, with no separator or space left dangling at its end. */
export function fitWords(line: Line, max: number): Line {
  if (cells(line) <= max) return line
  const out: Line = []
  let left = max
  for (const s of line) {
    const n = width(s.t)
    if (n <= left) {
      out.push(s)
      left -= n
      continue
    }
    // Room for a word and its ellipsis, or the cut is a stub nobody can read.
    if (!s.isSeparator && left >= 4) out.push({ ...s, t: cutWords(s.t, left) })
    break
  }
  while (out.length > 0 && (out.at(-1)?.isSeparator === true || out.at(-1)?.t.trim() === '')) out.pop()
  return out
}

const SGR: Record<Tone, string> = { plain: '97', dim: '38;5;247', accent: '38;5;117', heading: '1;38;5;117', good: '38;5;114', warn: '38;5;221', bad: '38;5;210', strong: '1;97' }

/** A chip's label: its tone as the background, near-black bold text on it. */
const chipSgr = (tone: Tone) => `1;38;5;234;${SGR[tone].replace(/^1;/, '').replace('38;5', '48;5').replace(/^97$/, '48;5;255')}`

/** ANSI for a terminal with a dark background. */
export function paint(line: Line): string {
  return line.map(s => `\x1b[${s.isChip ? chipSgr(s.tone ?? 'plain') : SGR[s.tone ?? 'plain']}m${s.t}\x1b[0m`).join('')
}

/**
 * A gauge of `size` cells on one text row: thin rules, lit in `tone`, the rest a dim track. Full
 * blocks fill the whole cell, so gauges on rows one above another merge into a solid rectangle.
 */
export function rail(percent: number, size: number, tone: Tone): Line {
  const share = Math.min(100, Math.max(0, percent)) / 100
  const lit = percent > 0 ? Math.max(1, Math.round(share * size)) : 0
  return [
    ...(lit > 0 ? [{ t: '━'.repeat(lit), tone }] : []),
    ...(lit < size ? [{ t: '━'.repeat(size - lit), tone: 'dim' as const }] : []),
  ]
}

const EIGHTHS = ['', '▏', '▎', '▍', '▌', '▋', '▊', '▉']

/** A gauge of `size` cells in eighths; its tone says how worried to be. */
export function bar(percent: number, size: number, tone: Tone): Line {
  const eighths = Math.round((Math.min(100, Math.max(0, percent)) / 100) * size * 8)
  const full = Math.floor(eighths / 8)
  const head = '█'.repeat(full) + (full < size ? (EIGHTHS[eighths % 8] ?? '') : '')
  const lit = percent > 0 && head === '' ? '▏' : head
  return [
    { t: lit, tone },
    { t: '░'.repeat(Math.max(0, size - width(lit))), tone: 'dim' },
  ]
}

/** The tone of a share used up: yellow from 80%, red from 90%. */
export function toneOf(percent: number): Tone {
  if (percent >= 90) return 'bad'
  if (percent >= 80) return 'warn'
  return 'good'
}

const TICKS = ['▁', '▂', '▃', '▄', '▅', '▆', '▇', '█']

/** The last `size` readings of a share as ticks from 0% to 100%; empty with fewer than two. */
export function sparkline(values: readonly number[], size: number, tone: Tone): Line {
  if (values.length < 2) return []
  const ticks = values.slice(-size).map(v => TICKS[Math.round((Math.min(100, Math.max(0, v)) / 100) * (TICKS.length - 1))] ?? '▁')
  return [{ t: ticks.join(''), tone }]
}
