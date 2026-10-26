// Lays out a tree drawn with stand-in elements as terminal text, so tools/preview.ts and the tests
// show what render/band-view.tsx draws rather than a copy of it. It knows only what the band uses:
// a column Box stacks its rows; a row Box joins its children with `columnGap` and spreads them by
// `justifyContent` over its `width` or its parent's; a hidden or absolutely placed Box (a hover
// card) takes no room and is not drawn; a Text run takes its colours as ANSI; a Button reads
// `hotkey: label`; a Link its text; a surface module (`Client`) its gauge or spinner at rest.

import type { RenderElement } from 'claude-code'

import type { GaugePart, SpinnerPart } from '../render/band'
import type { BandElements, BandParts } from '../render/band-view'
import { gaugeRuns } from '../render/gauge'
import { SPINNER_FRAMES } from '../render/spinner-client'

type Node = { type: string; props: Record<string, unknown>; children: unknown[] }

const flat = (children: unknown): unknown[] => (Array.isArray(children) ? children.flatMap(flat) : children === null || children === undefined || children === false ? [] : [children])

const element =
  (type: string) =>
  (props: Record<string, unknown>): Node => ({ type, props, children: flat(props.children) })

/**
 * The element table the band draws with, as plain data. The cast bridges to the engine's element
 * types: the stand-ins build the same `{ type, props, children }` shape without the engine.
 */
export const STAND_INS = { Box: element('Box'), Text: element('Text'), Button: element('Button'), Link: element('Link') } as unknown as BandElements

/** The gauge's track colour, as the hook hands it to the surface module. */
const TRACK = '#3b4261'

/** The animated parts as the engine shows them at rest: the gauge at its value, the spinner's first frame. */
export const STILL_PARTS: BandParts = {
  Gauge: ({ part }: { part: GaugePart }) =>
    element('Client')({ module: 'gauge', props: { value: part.value, inner: part.inner, colour: part.colour, track: TRACK } }) as unknown as RenderElement,
  Spinner: ({ part }: { part: SpinnerPart }) => element('Client')({ module: 'spinner', props: { colour: part.colour } }) as unknown as RenderElement,
  onAction: () => undefined,
}

// The engine's factory calls a component with its props and the children beside them.
const factory = (tag: unknown, props: Record<string, unknown> | null, ...children: unknown[]) =>
  typeof tag === 'function' ? (tag as (p: Record<string, unknown>) => unknown)({ ...(props ?? {}), children }) : null

/** Installs the JSX factory the band's components compile against. */
export function installFactory(): void {
  Object.assign(globalThis, { h: factory, Fragment: (props: { children?: unknown }) => element('Box')({ flexDirection: 'column', children: props.children }) })
}

/** The theme's colours on a dark background (256-colour indices). */
const THEME_COLOUR: Record<string, string> = { text: '255', inverseText: '234', inactive: '247', suggestion: '117', success: '114', warning: '221', error: '210' }

/** A colour prop as the SGR parameters after 38 (foreground) or 48 (background); hex in true colour. */
function colourCode(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined
  const hex = /^#([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i.exec(value)
  if (hex) return `2;${hex.slice(1).map(h => parseInt(h, 16)).join(';')}`
  const indexed = THEME_COLOUR[value]
  return indexed === undefined ? undefined : `5;${indexed}`
}

type Run = { t: string; sgr: string }

const isNode = (value: unknown): value is Node => typeof value === 'object' && value !== null && 'type' in value

const widthOf = (runs: readonly Run[]) => runs.reduce((n, r) => n + [...r.t].length, 0)

type Style = { fg?: string; bg?: string; bold?: boolean }

const sgrOf = (style: Style) => [style.bold ? '1' : '', style.fg ? `38;${style.fg}` : '', style.bg ? `48;${style.bg}` : ''].filter(Boolean).join(';') || '0'

function textRuns(node: Node, inherited: Style): Run[] {
  const style: Style = {
    fg: colourCode(node.props.color) ?? inherited.fg,
    bg: colourCode(node.props.backgroundColor) ?? inherited.bg,
    bold: node.props.bold === true || (node.props.bold === undefined && inherited.bold === true),
  }
  return node.children.flatMap(child => (isNode(child) ? textRuns(child, style) : [{ t: String(child), sgr: sgrOf(style) }]))
}

/** A surface module at rest: a gauge at its value, or a spinner's first frame. */
function clientRuns(node: Node): Run[] {
  const props = (node.props.props ?? {}) as Record<string, unknown>
  if (typeof props.inner === 'number') {
    return gaugeRuns(Number(props.value), props.inner, String(props.colour), String(props.track)).map(run => ({ t: run.t, sgr: sgrOf({ fg: colourCode(run.fg), bg: colourCode(run.bg) }) }))
  }
  return [{ t: SPINNER_FRAMES[0], sgr: sgrOf({ fg: colourCode(props.colour) }) }]
}

/** Whether a node takes room in its row: a hidden or absolutely placed Box does not. */
const isInFlow = (node: Node) => !(node.type === 'Box' && (node.props.display === 'none' || node.props.position === 'absolute'))

/** One row of runs for a node, `width` cells wide when it spreads its children. */
function rowRuns(node: Node, width: number | null): Run[] {
  if (node.type === 'Text') return textRuns(node, { fg: '5;255' })
  if (node.type === 'Link') return node.children.filter(isNode).flatMap(child => textRuns(child, { fg: '5;255' }))
  if (node.type === 'Button') return [{ t: String(node.props.hotkey), sgr: sgrOf({ fg: '5;117' }) }, { t: `: ${String(node.props.label)}`, sgr: sgrOf({ fg: '5;247' }) }]
  if (node.type === 'Client') return clientRuns(node)
  const parts = node.children.filter(isNode).filter(isInFlow).map(child => rowRuns(child, null))
  const gap = Number(node.props.columnGap ?? 0)
  const used = parts.reduce((n, p) => n + widthOf(p), 0) + gap * Math.max(0, parts.length - 1)
  const free = Math.max(0, (typeof node.props.width === 'number' ? node.props.width : (width ?? used)) - used)
  const space = (n: number): Run[] => (n > 0 ? [{ t: ' '.repeat(n), sgr: '0' }] : [])
  if (node.props.justifyContent === 'flex-end') return [...space(free), ...parts.flatMap((p, i) => [...(i > 0 ? space(gap) : []), ...p])]
  if (node.props.justifyContent === 'space-between' && parts.length > 1) {
    return parts.flatMap((p, i) => [...(i > 0 ? space(gap + (i === 1 ? free : 0)) : []), ...p])
  }
  return parts.flatMap((p, i) => [...(i > 0 ? space(gap) : []), ...p])
}

/** The tree's rows as text: ANSI-coloured, or plain. Padding and gaps between rows are not drawn. */
export function drawn(tree: unknown, isPlain = false): string[] {
  if (!isNode(tree)) return []
  const width = typeof tree.props.width === 'number' ? tree.props.width : null
  const rows = tree.props.flexDirection === 'column' ? tree.children.filter(isNode) : [tree]
  return rows.map(row => rowRuns(row, width).map(r => (isPlain ? r.t : `\x1b[${r.sgr}m${r.t}\x1b[0m`)).join(''))
}
