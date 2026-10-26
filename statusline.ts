#!/usr/bin/env bun
// Claude Code's status line: reads the session's JSON on stdin, and what binnacle wrote for the
// same session under ~/.claude/binnacle/state, and prints two lines (three with an alert) for the terminal's width,
// then a line per background shell that runs or just ended.
//
// While binnacle draws the band above the prompt it says so in that state, and this prints nothing:
// the band shows the same rows in the theme's colours. To draw here again, `/binnacle band off` in
// the session (`/binnacle band on` brings the band back), or BINNACLE_LINE=full in the status
// line's command to print the full lines whatever the band does.
import { dictionaryFrom, useLanguage } from './i18n'
import { isOutputPath, runOf, tailStart, type Probe, type ShellRun } from './model/shells'
import { prettyModel } from './render/format'
import { statusLines, type Status } from './render/status'
import { paint } from './render/text'
import type { Shared, Shell } from './types'

type Input = {
  session_id?: string
  model?: { id?: string; display_name?: string }
  context_window?: {
    used_percentage?: number
    context_window_size?: number
    total_input_tokens?: number
  }
  rate_limits?: Record<string, { used_percentage?: number; resets_at?: number } | undefined>
  cost?: { total_cost_usd?: number }
}

export function statusOf(input: Input): Status {
  const window = input.context_window
  return {
    model: prettyModel(input.model?.id ?? '', input.model?.display_name ?? 'Claude'),
    context:
      window?.used_percentage === undefined
        ? undefined
        : {
            percent: window.used_percentage,
            tokens: window.total_input_tokens,
            window: window.context_window_size ?? 200_000,
          },
    limits: Object.entries(input.rate_limits ?? {}).flatMap(([kind, limit]) =>
      limit?.used_percentage === undefined
        ? []
        : [{ kind, percent: limit.used_percentage, resetsAt: limit.resets_at === undefined ? undefined : limit.resets_at * 1000 }],
    ),
    usd: input.cost?.total_cost_usd,
  }
}

async function sharedOf(id: string | undefined): Promise<Shared> {
  if (id === undefined || !/^[\w-]+$/.test(id)) return {}
  try {
    // BINNACLE_STATE_DIR points a hand run at a sample state instead of the live sessions'.
    const dir = process.env.BINNACLE_STATE_DIR || `${process.env.HOME}/.claude/binnacle/state`
    return (await Bun.file(`${dir}/${id}.json`).json()) as Shared
  } catch {
    return {}
  }
}

/** The last bytes of a shell's output file and its last change; null when it is gone. */
export async function probe(path: string): Promise<Probe> {
  if (!isOutputPath(path)) return null
  try {
    const file = Bun.file(path)
    if (!(await file.exists())) return null
    return { tail: await file.slice(tailStart(file.size)).text(), mtimeMs: file.lastModified }
  } catch {
    return null
  }
}

export async function runsOf(shells: readonly Shell[]): Promise<ShellRun[]> {
  return Promise.all(shells.map(async shell => runOf(shell, shell.stoppedAt === undefined ? await probe(shell.output) : null)))
}

/** Writes in `language`: the built-in words, then its JSON beside this file over them. */
async function speak(language: string | undefined): Promise<void> {
  if (language === undefined || !/^[a-z]{2,3}(?:-[A-Za-z]{2,4})?$/.test(language)) return
  useLanguage(language)
  try {
    const dictionary = dictionaryFrom(await Bun.file(`${import.meta.dir}/i18n/${language}.json`).json())
    if (dictionary !== null) useLanguage(language, dictionary)
  } catch {
    // The built-in words stand.
  }
}

if (import.meta.main) {
  const now = Date.now()
  const columns = Number(process.env.COLUMNS) || 120
  try {
    const input = JSON.parse((await Bun.stdin.text()) || '{}') as Input
    const shared = await sharedOf(input.session_id)
    if (shared.band === true && process.env.BINNACLE_LINE !== 'full') process.exit(0)
    await speak(shared.language)
    const tz = -new Date(now).getTimezoneOffset()
    const runs = await runsOf(shared.shells ?? [])
    console.log(statusLines(statusOf(input), shared, now, columns, tz, runs).map(paint).join('\n'))
  } catch (error) {
    console.log(`binnacle: ${error instanceof Error ? error.message : String(error)}`)
  }
}
