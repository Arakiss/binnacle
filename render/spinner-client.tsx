// A surface module: a one-cell spinner that turns on the surface's frame clock while something runs.
// The pragma keeps Bun on the engine's factory when tools/preview.ts imports it by hand.
/** @jsxRuntime classic @jsx h @jsxFrag Fragment */

import type { ClientModule } from 'claude-code'

export type SpinnerProps = { colour: string }

export const SPINNER_FRAMES = ['◐', '◓', '◑', '◒'] as const

/** Milliseconds per frame: a quarter turn every 150 ms reads as busy without flicker. */
const FRAME_MS = 150

const Spinner: ClientModule<SpinnerProps, number> = (props, surface) => {
  const { Text } = surface.elements
  if (surface.state === undefined) {
    surface.setState(0)
    surface.every(FRAME_MS, () => surface.setState(((surface.state ?? 0) + 1) % SPINNER_FRAMES.length))
  }
  return <Text color={props.colour}>{SPINNER_FRAMES[surface.state ?? 0]}</Text>
}

export default Spinner
