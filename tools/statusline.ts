#!/usr/bin/env bun
// A classic status line, for settings.json's `statusLine` command: reads the session's JSON on
// stdin and what binnacle wrote for the same session under ./state, and prints the status block in
// colour for the terminal's width: the work, the checkout and the budgets, a line of alerts when
// something needs the user, then a row per background shell that runs or just ended.
//
// binnacle pins a one-line summary of its own while the band is off; this script is for those who
// want the full block instead (turn the `pinStatusLine` option off, so it is not shown twice). While
// the band draws, this prints nothing: the band shows the same facts. BINNACLE_LINE=full in the
// command prints the block whatever the band does; BINNACLE_STATE_DIR points it at a sample state.
import { isQuiet, printed, type Input } from '../render/statusline'
import type { Shared } from '../types'
import { runsOf } from './shell-runs'

async function sharedOf(id: string | undefined): Promise<Shared> {
  if (id === undefined || !/^[\w-]+$/.test(id)) return {}
  try {
    const dir = process.env.BINNACLE_STATE_DIR || `${import.meta.dir}/../state`
    return (await Bun.file(`${dir}/${id}.json`).json()) as Shared
  } catch {
    return {}
  }
}

const now = Date.now()
try {
  const input = JSON.parse((await Bun.stdin.text()) || '{}') as Input
  const shared = await sharedOf(input.session_id)
  const isForced = process.env.BINNACLE_LINE === 'full'
  const lines = printed(input, shared, {
    columns: Number(process.env.COLUMNS) || 120,
    now,
    tz: -new Date(now).getTimezoneOffset(),
    // While the band draws nothing is printed, so the shells' output files are not read.
    runs: isQuiet(shared, isForced) ? [] : await runsOf(shared.shells ?? []),
    isForced,
  })
  if (lines.length > 0) console.log(lines.join('\n'))
} catch (error) {
  console.log(`binnacle: ${error instanceof Error ? error.message : String(error)}`)
}
