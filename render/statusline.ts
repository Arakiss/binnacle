// The classic status line's lines, decided as data: what tools/statusline.ts prints for Claude
// Code's `statusLine` command, from the JSON the command gets on stdin and the state binnacle wrote
// for that session. Pure, so the tests read the same lines the script prints.
import { useLanguage } from '../i18n'
import type { ShellRun } from '../model/shells'
import type { Shared } from '../types'
import { prettyModel } from './format'
import { statusLines, type Status } from './status'
import { paint } from './text'

/** What Claude Code writes on the status line command's stdin, as far as this reads it. */
export type Input = {
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
        : { percent: window.used_percentage, tokens: window.total_input_tokens, window: window.context_window_size ?? 200_000 },
    limits: Object.entries(input.rate_limits ?? {}).flatMap(([kind, limit]) =>
      limit?.used_percentage === undefined ? [] : [{ kind, percent: limit.used_percentage, resetsAt: limit.resets_at === undefined ? undefined : limit.resets_at * 1000 }],
    ),
    usd: input.cost?.total_cost_usd,
  }
}

export type Print = { columns: number; now: number; tz: number; runs: readonly ShellRun[]; isForced: boolean }

/** Whether the script keeps quiet: the band draws the same facts, and nobody forced the lines. */
export const isQuiet = (shared: Shared, isForced: boolean) => shared.band === true && !isForced

/**
 * The lines to print, painted, in the language binnacle speaks in that session: none while the
 * band draws, unless forced.
 */
export function printed(input: Input, shared: Shared, print: Print): string[] {
  if (isQuiet(shared, print.isForced)) return []
  useLanguage(shared.language ?? 'en')
  return statusLines(statusOf(input), shared, print.now, print.columns, print.tz, print.runs).map(paint)
}
