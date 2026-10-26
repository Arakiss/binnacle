// A surface module: the rounded gauge, animated. It grows from empty when it first appears and
// eases to each new value the band hands it, on the surface's own frame clock, so no hook runs
// while it moves.

import type { ClientModule } from 'claude-code'

import { easedToward, gaugeRuns } from './gauge'

export type GaugeProps = { value: number; inner: number; colour: string; track: string }

type GaugeState = { shown: number; target: number }

/** Milliseconds between frames of the animation: 25 a second reads as smooth and costs little. */
const FRAME_MS = 40

const AnimatedGauge: ClientModule<GaugeProps, GaugeState> = (props, surface) => {
  const { Box, Text } = surface.elements
  const state = surface.state
  if (state === undefined) {
    surface.setState({ shown: 0, target: props.value })
    surface.every(FRAME_MS, () => {
      const now = surface.state
      if (now !== undefined && now.shown !== now.target) surface.setState({ ...now, shown: easedToward(now.shown, now.target) })
    })
  } else if (state.target !== props.value) {
    surface.setState({ ...state, target: props.value })
  }
  return (
    <Box flexDirection="row">
      {gaugeRuns(state?.shown ?? 0, props.inner, props.colour, props.track).map(run => (
        <Text color={run.fg} backgroundColor={run.bg}>
          {run.t}
        </Text>
      ))}
    </Box>
  )
}

export default AnimatedGauge
