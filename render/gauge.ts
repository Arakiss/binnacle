// A rounded gauge as runs of background-coloured cells between two half-circle caps (Nerd Font
// glyphs): lit in its colour up to the share shown, the rest in the track's colour. Pure, so the
// animated surface module, the band's layout and tools/preview.ts draw the same gauge.

/** A run of the gauge: text in one foreground on one background (none for the caps' outside). */
export type GaugeRun = { t: string; fg?: string; bg?: string }

/** The half circles that round the gauge's ends. */
export const CAP = { left: '', right: '' } as const

/** Cells a gauge of `inner` cells takes, its caps included. */
export const gaugeCells = (inner: number) => inner + 2

/**
 * A gauge `inner` cells wide at `value` percent. The left cap lights as soon as anything is used,
 * so 1% still shows; the right one only when the gauge is full.
 */
export function gaugeRuns(value: number, inner: number, colour: string, track: string): GaugeRun[] {
  const share = Math.min(100, Math.max(0, value)) / 100
  const lit = Math.round(share * inner)
  const runs: GaugeRun[] = [{ t: CAP.left, fg: value > 0 ? colour : track }]
  if (lit > 0) runs.push({ t: ' '.repeat(lit), bg: colour })
  if (lit < inner) runs.push({ t: ' '.repeat(inner - lit), bg: track })
  runs.push({ t: CAP.right, fg: lit >= inner ? colour : track })
  return runs
}

/** The next value an animated gauge shows on its way from `shown` to `target`: a quarter of the way, at least one point. */
export function easedToward(shown: number, target: number): number {
  const gap = target - shown
  if (Math.abs(gap) <= 1) return target
  return shown + Math.sign(gap) * Math.max(1, Math.abs(gap) / 4)
}
