// Prints the status line for the test fixtures (the busy fixtures with their shell rows), or the
// /binnacle pane, at a given width:
//   bun tools/preview.ts 120              every status fixture, in colour
//   bun tools/preview.ts 80 alerts        one fixture
//   bun tools/preview.ts 100 pane --plain the pane, without ANSI
//   bun tools/preview.ts 160 band         the band above the prompt, every fixture
//   bun tools/preview.ts 160 band 2       the same, given only two rows
//   bun tools/preview.ts 160 liveness     a team in every liveness: status line, band, pane rows, report
//   bun tools/preview.ts 160 liveness 20  the same, the band given twenty rows
// The band goes through its components (render/band-view.tsx) over stand-in elements; the engine
// paints it in the person's theme, here a dark one.
import { bandLines } from '../render/band'
import { createBandView } from '../render/band-view'
import { paneLines } from '../render/pane'
import { statusLines, type Status } from '../render/status'
import { paint, plainText, type Line } from '../render/text'
import type { Shared } from '../types'
import { lineOf, rowsOf } from '../render/report'
import { AHEAD_OF_PACE, ALERT_STATUS, ALERTS, API_KEY, bandOf, busyPane, IDLE, LIVE_RUNS, livenessPane, livenessShared, NO_REPO, NOW, RUNS, SHARED_CHECKOUT, STATUS, TZ, WORKING } from '../tests/fixtures'
import { drawn, installFactory, STAND_INS, STILL_PARTS } from './draw'

const columns = Number(process.argv[2] ?? 120)
const words = process.argv.slice(3).filter(arg => !arg.startsWith('--'))
const which = words[0]
const isPlain = process.argv.includes('--plain')
const show = (line: Line) => (isPlain ? plainText(line) : paint(line))

const FIXTURES: Record<string, [Status, Shared]> = {
  idle: [STATUS, IDLE],
  working: [STATUS, WORKING],
  alerts: [ALERT_STATUS, ALERTS],
  'no-repo': [STATUS, NO_REPO],
  'api-key': [API_KEY, IDLE],
  'shared-checkout': [AHEAD_OF_PACE, SHARED_CHECKOUT],
}

if (which === 'liveness') {
  const shared = livenessShared()
  console.log(`── status line @ ${columns}`)
  console.log(statusLines(STATUS, shared, NOW, columns, TZ, LIVE_RUNS).map(show).join('\n'))
  installFactory()
  const { Band } = createBandView(STAND_INS, STILL_PARTS)
  const maxRows = Number(words[1] ?? 3)
  console.log(`── band @ ${columns}×${maxRows}`)
  console.log(drawn(Band({ lines: bandLines(bandOf(STATUS, shared, LIVE_RUNS), columns, maxRows), columns }), isPlain).join('\n'))
  console.log(`── pane @ ${columns}`)
  console.log(paneLines(livenessPane(), columns).map(show).join('\n'))
  console.log('── tools/liveness.ts')
  console.log(rowsOf(shared, LIVE_RUNS, NOW).map(row => lineOf(row, NOW)).join('\n'))
} else if (which === 'pane') {
  console.log(paneLines(busyPane(), columns).map(show).join('\n'))
} else if (which === 'band') {
  installFactory()
  const { Band } = createBandView(STAND_INS, STILL_PARTS)
  const maxRows = Number(words[1] ?? 12)
  for (const [name, [status, shared]] of Object.entries(FIXTURES)) {
    const lines = bandLines(bandOf(status, shared, shared.turn ? RUNS : []), columns, maxRows)
    console.log(`── band · ${name} @ ${columns}×${maxRows}`)
    console.log(drawn(Band({ lines, columns }), isPlain).join('\n'))
  }
} else {
  for (const [name, [status, shared]] of Object.entries(FIXTURES)) {
    if (which !== undefined && which !== name) continue
    console.log(`── ${name} @ ${columns}`)
    const runs = shared.turn ? RUNS : []
    console.log(statusLines(status, shared, NOW, columns, TZ, runs).map(show).join('\n'))
  }
}
