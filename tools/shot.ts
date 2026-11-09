#!/usr/bin/env bun
// Writes the band as a web page, for a picture of it: the storied fixtures at a given width, drawn
// through the band's own components, on the theme's background, with the rows of air the engine
// lays between its lines. Open it in a browser, or hand it to one headless for a PNG:
//   bun tools/shot.ts 150 > band.html
//   bun tools/shot.ts 150 es told > band.html     one fixture, in Spanish
import { useLanguage } from '../i18n'
import { bandLines } from '../render/band'
import { createBandView } from '../render/band-view'
import { bandOf, MATES, RESTED, RUNS, STATUS, TOLD } from '../tests/fixtures'
import { drawn, installFactory, STAND_INS, STILL_PARTS } from './draw'

const columns = Number(process.argv[2] ?? 150)
const language = process.argv[3] ?? 'en'
const only = process.argv[4]
useLanguage(language)
installFactory()
const { Band } = createBandView(STAND_INS, STILL_PARTS)

const escape = (text: string) => text.replace(/&/g, '&amp;').replace(/</g, '&lt;')

/** One ANSI row as spans: true colour and the 256 indices the stand-ins use, bold and italic. */
function html(row: string): string {
  const indexed: Record<string, string> = { '255': '#c0caf5', '234': '#1a1b26', '247': '#737aa2', '117': '#7dcfff', '114': '#9ece6a', '221': '#e0af68', '210': '#f7768e' }
  let out = ''
  for (const m of row.matchAll(/\x1b\[([0-9;]*)m([^\x1b]*)/g)) {
    const codes = (m[1] ?? '').split(';')
    const style: string[] = []
    for (let i = 0; i < codes.length; i += 1) {
      const code = codes[i]
      if (code === '1') style.push('font-weight:700')
      if (code === '3') style.push('font-style:italic')
      if (code === '38' || code === '48') {
        const prop = code === '38' ? 'color' : 'background'
        if (codes[i + 1] === '2') style.push(`${prop}:rgb(${codes.slice(i + 2, i + 5).join(',')})`)
        else style.push(`${prop}:${indexed[codes[i + 2] ?? ''] ?? '#c0caf5'}`)
        i += codes[i + 1] === '2' ? 4 : 2
      }
    }
    out += `<span style="${style.join(';')}">${escape(m[2] ?? '')}</span>`
  }
  return out
}

const scenes = { told: { ...bandOf(STATUS, TOLD, RUNS), mates: MATES }, rested: { ...bandOf(STATUS, RESTED), mates: MATES } }
const blocks = Object.entries(scenes)
  .filter(([name]) => only === undefined || only === name)
  .map(([, input]) => {
    const lines = bandLines(input, columns, 20)
    const rows = drawn(Band({ lines, columns }))
    return rows.map((row, i) => `${i > 0 && lines[i]?.tight !== true ? '<div class="row"> </div>' : ''}<div class="row">${html(row)}</div>`).join('')
  })

console.log(`<!doctype html><meta charset="utf-8"><style>
body{margin:0;background:#1a1b26;color:#c0caf5;font:15px/1.45 "JetBrainsMono Nerd Font Mono","JetBrainsMono NFM",monospace}
.band{padding:22px 26px;width:${columns}ch;border-bottom:1px solid #292e42}.row{white-space:pre;height:1.45em}
</style>${blocks.map(block => `<div class="band">${block}</div>`).join('')}`)
