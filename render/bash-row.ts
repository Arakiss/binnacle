// A Bash call as a person reads it: what it is for, where it runs and, apart, the command itself.

import { printable } from '../model/printable'
import { homeShort } from './pane'

export type BashRow = {
  /** What the engine's own row names the call by. */
  title: string
  /** The folder a leading `cd` moved to, which then leaves the command. */
  folder: string | null
  /** The command to highlight. */
  source: string
  /** The lines left out of `source`. */
  hidden: number
}

export type ResultView = {
  out: string
  err: string
  /** The grammar `out` is drawn with; null draws it as plain text. */
  language: 'json' | 'diff' | null
}

/** Result fields that change what the engine shows: an image, a background run, a saved long output. */
const ENGINE_DRAWN = ['interrupted', 'isImage', 'backgroundTaskId', 'rawOutputPath', 'persistedOutputPath', 'structuredContent', 'timedOutAfterMs', 'returnCodeInterpretation'] as const

/** Lines of a command a folded row shows; ctrl+o shows the rest. */
const FOLDED_LINES = 12

/** Well under the engine's 100000 characters per drawing, which a whole transcript row shares. */
const MAX_CHARS = 20_000

const LEADING_CD = /^cd\s+("[^"]*"|'[^']*'|[^\s;&|]+)\s*(?:&&|;)\s*/

const isRecord = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null

/** The row for a Bash call's input; null for an input with no command, which the engine draws as it comes. */
export function bashRow(input: unknown, isExpanded: boolean): BashRow | null {
  if (!isRecord(input) || typeof input.command !== 'string') return null
  const command = printable(input.command).trim()
  if (command === '') return null

  const cd = LEADING_CD.exec(command)
  const body = cd === null ? command : command.slice(cd[0].length)
  const said = typeof input.description === 'string' ? printable(input.description).trim().split('\n')[0]?.trim() : ''

  const lines = body.slice(0, MAX_CHARS).split('\n')
  const shown = isExpanded ? lines : lines.slice(0, FOLDED_LINES)
  return {
    title: said || (body.split(/\s/)[0] ?? command),
    folder: cd === null ? null : homeShort((cd[1] ?? '').replace(/^(["'])(.*)\1$/, '$2')),
    source: shown.join('\n'),
    hidden: body.split('\n').length - shown.length,
  }
}

/**
 * A finished call's result, when this row can draw all of it; null leaves it to the engine, whose
 * renderer knows what the fields below mean, so nothing is ever dropped from the screen.
 */
export function resultView(output: unknown): ResultView | null {
  if (!isRecord(output) || typeof output.stdout !== 'string' || typeof output.stderr !== 'string') return null
  if (ENGINE_DRAWN.some(field => output[field])) return null
  if (output.stdout.length + output.stderr.length > MAX_CHARS) return null
  const out = printable(output.stdout).trimEnd()
  return { out, err: printable(output.stderr).trim(), language: languageOf(out) }
}

function languageOf(out: string): ResultView['language'] {
  if (/^(?:diff --git |--- .*\n\+\+\+ )/.test(out) && /^@@ /m.test(out)) return 'diff'
  return /^[{[]/.test(out) && isJson(out) ? 'json' : null
}

function isJson(text: string): boolean {
  try {
    JSON.parse(text)
    return true
  } catch {
    return false
  }
}
