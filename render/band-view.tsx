// The band drawn as components over the surface's own elements: a column of lines with a row of
// air between them, each line its items left and its buttons right. An item is a keyed Box, which
// makes it a hover scope: its card, drawn hidden and absolutely placed on the row under it, shows
// while the pointer is on the item. A press item is a plain Button with its hotkey; an item with a
// link is a Link. Gauges and spinners are the animated surface modules the hooks module mounts,
// handed in as components so their module paths stay in its source, where the engine reads them.
//
// The pragma names the factory the engine compiles with anyway, for Bun: run by hand (tools/preview.ts)
// it ignores the generated tsconfig's `jsxFactory` and would build React elements the stand-ins cannot read.
/** @jsxRuntime classic @jsx h @jsxFrag Fragment */

import type { BoxProps, ButtonProps, ElementConstructor, LinkProps, RenderElement, TextProps } from 'claude-code'

import { GAP, PALETTE, type Action, type BandLine, type GaugePart, type Item, type Part, type SpinnerPart, type TextPart } from './band'

/** The elements the band draws with. */
export type BandElements = {
  Box: ElementConstructor<BoxProps>
  Text: ElementConstructor<TextProps>
  Button: ElementConstructor<ButtonProps>
  Link: ElementConstructor<LinkProps>
}

/** What the hooks module hands the view: the animated parts, and what a press does. */
export type BandParts = {
  Gauge: (props: { part: GaugePart }) => RenderElement
  Spinner: (props: { part: SpinnerPart }) => RenderElement
  onAction: (action: Action) => void
}

export function createBandView({ Box, Text, Button, Link }: BandElements, { Gauge, Spinner, onAction }: BandParts) {
  const TextRun = ({ part }: { part: TextPart }) => (
    <Text color={part.color} backgroundColor={part.bg} bold={part.bold === true}>
      {part.t}
    </Text>
  )

  const PartView = ({ part }: { part: Part }) => (part.kind === 'gauge' ? <Gauge part={part} /> : part.kind === 'spinner' ? <Spinner part={part} /> : <TextRun part={part} />)

  /** The card an item reveals under the pointer: one row on the line's empty row below it. */
  const Card = ({ runs }: { runs: readonly TextPart[] }) => (
    <Box position="absolute" top={1} left={0} display="none" hover={{ display: 'flex' }}>
      <Text backgroundColor={PALETTE.card} wrap="truncate-end">
        <Text backgroundColor={PALETTE.card}> </Text>
        {runs.map(part => (
          <Text color={part.color} backgroundColor={PALETTE.card} bold={part.bold === true}>
            {part.t}
          </Text>
        ))}
        <Text backgroundColor={PALETTE.card}> </Text>
      </Text>
    </Box>
  )

  const ItemView = ({ item }: { item: Item }): RenderElement => {
    if (item.press) {
      const { action } = item.press
      return <Button key={item.key} plain hotkey={item.press.hotkey} label={item.press.label} dimColor onPress={() => onAction(action)} />
    }
    if (item.href) {
      return (
        <Link href={item.href}>
          {item.parts.flatMap(part => (part.kind === 'text' ? [<TextRun part={part} />] : []))}
        </Link>
      )
    }
    return (
      <Box key={item.key} flexDirection="row" flexShrink={0}>
        {[...item.parts.map(part => <PartView part={part} />), ...(item.card ? [<Card runs={item.card} />] : [])]}
      </Box>
    )
  }

  const Group = ({ items }: { items: readonly Item[] }) => (
    <Box flexDirection="row" columnGap={GAP} flexShrink={0}>
      {items.map(item => (
        <ItemView item={item} />
      ))}
    </Box>
  )

  const Line = ({ line, above }: { line: BandLine; above: number }) => {
    const sides: RenderElement[] = [...(line.left.length > 0 ? [<Group items={line.left} />] : []), ...(line.right.length > 0 ? [<Group items={line.right} />] : [])]
    return (
      <Box flexDirection="row" marginTop={above} justifyContent={line.left.length === 0 ? 'flex-end' : 'space-between'}>
        {sides}
      </Box>
    )
  }

  /** The whole band, `columns` cells wide, `pad` empty rows above and below, `gap` above each line but a tight one. */
  const Band = ({ lines, columns, pad = 0, gap = 0 }: { lines: readonly BandLine[]; columns: number; pad?: number; gap?: number }) => (
    <Box flexDirection="column" width={columns} paddingTop={pad} paddingBottom={pad}>
      {lines.map((line, i) => (
        <Line line={line} above={i > 0 && line.tight !== true ? gap : 0} />
      ))}
    </Box>
  )

  return { Band }
}
