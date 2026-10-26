#!/usr/bin/env bun
// What each agent and background shell of a Claude Code session is doing, as the HUD judges it:
// working, waiting on something that will wake it, stalled with nothing that will, done, or
// unknown. The verdicts the band and the pane draw, from the state binnacle writes, for a
// terminal, a script or another agent harness to read:
//   bun tools/liveness.ts                the session whose state changed last
//   bun tools/liveness.ts <session-id>   that session; a prefix is enough
//   bun tools/liveness.ts --json         one JSON object per agent or shell
// Exit 0 when no agent stalled, 3 when one did, 2 when there is no state to read.
import { readdir, stat } from 'node:fs/promises'

import { t, useLanguage } from '../i18n'
import { duration } from '../render/format'
import { exitOf, lineOf, rowsOf } from '../render/report'
import { isOutputPath, runOf, tailStart, type Probe, type ShellRun } from '../model/shells'
import type { Shared, Shell } from '../types'

/** The last bytes of a shell's output file and its last change; null when it is gone. */
async function probe(path: string): Promise<Probe> {
  if (!isOutputPath(path)) return null
  try {
    const file = Bun.file(path)
    if (!(await file.exists())) return null
    return { tail: await file.slice(tailStart(file.size)).text(), mtimeMs: file.lastModified }
  } catch {
    return null
  }
}

async function runsOf(shells: readonly Shell[]): Promise<ShellRun[]> {
  return Promise.all(shells.map(async shell => runOf(shell, shell.stoppedAt === undefined ? await probe(shell.output) : null)))
}

/** The state file of the session named by `prefix`, or the one written last. */
async function stateFile(dir: string, prefix: string | undefined): Promise<string | null> {
  const names = (await readdir(dir).catch(() => [] as string[])).filter(n => n.endsWith('.json') && (prefix === undefined || n.startsWith(prefix)))
  const dated = await Promise.all(names.map(async n => ({ n, t: (await stat(`${dir}/${n}`)).mtimeMs })))
  const newest = dated.sort((x, y) => y.t - x.t)[0]
  return newest === undefined ? null : `${dir}/${newest.n}`
}

const args = process.argv.slice(2)
const isJson = args.includes('--json')
const prefix = args.find(a => !a.startsWith('--'))
// BINNACLE_STATE_DIR points a hand run at a sample state instead of the live sessions'.
const dir = process.env.BINNACLE_STATE_DIR || `${import.meta.dir}/../state`
const file = await stateFile(dir, prefix)
if (file === null) {
  console.error(`liveness: no binnacle state${prefix ? ` for ${prefix}` : ''} in ${dir}`)
  process.exit(2)
}
const now = Date.now()
const shared = (await Bun.file(file).json()) as Shared
useLanguage(shared.language ?? 'en')
const rows = rowsOf(shared, await runsOf(shared.shells ?? []), now)
if (isJson) {
  for (const row of rows) console.log(JSON.stringify(row))
} else {
  console.log(`${file.split('/').pop()?.replace(/\.json$/, '')} · ${t('report.written', { time: duration(now - (await stat(file)).mtimeMs) })}`)
  console.log(rows.length === 0 ? t('report.empty') : rows.map(r => lineOf(r, now)).join('\n'))
}
process.exit(exitOf(rows))
