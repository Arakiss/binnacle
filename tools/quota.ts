#!/usr/bin/env bun
// How much Claude Code quota is left, from the state binnacle writes: for each rate-limit window
// the share used and left, when it resets, the pace of the last hour and whether it fills before
// the reset at that pace, and how old the reading is. The quota is the account's, so the reading
// comes from whichever session took it last, and the pace from every session's readings.
//   bun tools/quota.ts                  words for a person (JSON when stdout is not a terminal)
//   bun tools/quota.ts --json           the JSON object render/quota.ts documents (Quota)
//   bun tools/quota.ts --text           words even when stdout is not a terminal
//   bun tools/quota.ts --state-dir DIR  read DIR instead of ./state (also BINNACLE_STATE_DIR)
//   bun tools/quota.ts --lang es        words in that language (also BINNACLE_LANGUAGE)
// Exit 0 with a reading, 1 when there is none (with why and what to do), 2 on a wrong argument.
import { readdir, stat } from 'node:fs/promises'

import { argsOf, report, USAGE, type StateFile } from '../render/quota'
import type { Shared } from '../types'

/** Every `.json` file of `dir`, parsed; one that does not parse holds null. Null when `dir` cannot be read. */
async function stateFiles(dir: string): Promise<StateFile[] | null> {
  const names = await readdir(dir).catch(() => null)
  if (names === null) return null
  return Promise.all(
    names
      .filter(n => n.endsWith('.json'))
      .map(async (n): Promise<StateFile> => {
        const path = `${dir}/${n}`
        try {
          const { mtimeMs } = await stat(path)
          const value: unknown = await Bun.file(path).json()
          return { path, mtimeMs, shared: value !== null && typeof value === 'object' && !Array.isArray(value) ? (value as Shared) : null }
        } catch {
          return { path, mtimeMs: 0, shared: null }
        }
      }),
  )
}

const args = argsOf(process.argv.slice(2))
if (typeof args === 'string' || args.isHelp) {
  if (typeof args === 'string') console.error(args)
  console.error(USAGE)
  process.exit(typeof args === 'string' ? 2 : 0)
}

// BINNACLE_STATE_DIR points a hand run at another copy's state, or at a sample one.
const dir = (args.dir ?? (process.env.BINNACLE_STATE_DIR || `${import.meta.dir}/../state`)).replace(/(.)\/+$/, '$1')
const now = Date.now()
const out = report({
  args,
  dir,
  files: await stateFiles(dir),
  isTTY: process.stdout.isTTY === true,
  envLanguage: process.env.BINNACLE_LANGUAGE,
  now,
  tz: -new Date(now).getTimezoneOffset(),
})
process.stdout.write(out.stdout)
process.stderr.write(out.stderr)
process.exit(out.code)
