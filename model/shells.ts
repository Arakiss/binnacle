// Background shells: what a Bash call with run_in_background started, and how the status line
// tells, from the tail of its output file alone, whether it still runs. Pure: the caller reads.

import { firstLine } from '../render/format'
import { cut, width } from '../render/text'
import type { Shell } from '../types'

/** The most shells the state keeps; the oldest finished one goes first. */
export const SHELLS_MAX = 8

/** Bytes of an output file the status line reads: enough for the exit line, never the log. */
export const TAIL_BYTES = 200

/** How long a finished shell stays on the status line. */
export const RECENT_MS = 2 * 60_000

const LABEL_MAX = 60

/** The output file a background Bash call's result names, or null. */
export function outputPathOf(text: string): string | null {
  const match = /Output is being written to:\s*(\S+\.output)\b/.exec(text)
  return match?.[1] ?? null
}

/** The exit code an output file's tail ends with, or null while the command runs. */
export function exitOf(tail: string): number | null {
  const match = /\[exited with code (-?\d+)\]\s*$/.exec(tail)
  return match?.[1] === undefined ? null : Number(match[1])
}

/** The task id an output file is named after: `bxogwr2mq` of `…/tasks/bxogwr2mq.output`. */
const taskIdOf = (output: string) => /([^/]+)\.output$/.exec(output)?.[1] ?? output

/** The words the user reads: the call's description, or the command's first line. */
export function labelOf(description: string, command: string): string {
  const said = description.trim() || firstLine(command)
  return width(said) <= LABEL_MAX ? said : cut(said, LABEL_MAX)
}

/** The shell a finished Bash call started, or null when it ran in the foreground or named no file. */
export function shellFrom(args: Record<string, unknown>, text: string, at: number, agentId?: string): Shell | null {
  if (args.run_in_background !== true) return null
  const output = outputPathOf(text)
  if (output === null) return null
  const said = (key: string) => (typeof args[key] === 'string' ? (args[key] as string) : '')
  return { id: taskIdOf(output), label: labelOf(said('description'), said('command')), startedAt: at, output, ...(agentId === undefined ? {} : { agentId }) }
}

/** The shell the mod told its agent of: told once, never again. */
export function shellTold(list: readonly Shell[], id: string, at: number): Shell[] {
  return list.map(s => (s.id === id && s.toldAt === undefined ? { ...s, toldAt: at } : s))
}

/** The list with `shell` added, bounded: past the limit the oldest finished shell goes, else the oldest. */
export function shellAdded(list: readonly Shell[], shell: Shell, isFinished: (s: Shell) => boolean): Shell[] {
  const next = [...list.filter(s => s.id !== shell.id), shell].sort((a, b) => a.startedAt - b.startedAt)
  while (next.length > SHELLS_MAX) {
    const finished = next.findIndex(s => s.stoppedAt !== undefined || isFinished(s))
    next.splice(finished === -1 ? 0 : finished, 1)
  }
  return next
}

/** A shell the session stopped writes no exit line; this marks it ended instead. */
export function shellStopped(list: readonly Shell[], id: string, at: number): Shell[] {
  return list.map(s => (s.id === id && s.stoppedAt === undefined ? { ...s, stoppedAt: at } : s))
}

/** Only the files Claude Code names for a background task; the state file is no licence to read others. */
export const isOutputPath = (path: string) => path.startsWith('/') && path.endsWith('.output')

/** Where the tail of a file `size` bytes long starts. */
export const tailStart = (size: number) => Math.max(0, size - TAIL_BYTES)

/** What the status line read of an output file: missing, or its last bytes and when it last changed. */
export type Probe = { tail: string; mtimeMs: number } | null

/** A shell as the status line draws it: still running, or ended (`code` null when unknown); `agentId` its owner. */
export type ShellRun = { label: string; startedAt: number; agentId?: string } & (
  /** `quietSince`: when its output file last changed, to tell a shell that stopped writing. */
  | { state: 'running'; quietSince?: number }
  | { state: 'ended'; code: number | null; endedAt: number | null }
)

/** What one probe says of one shell; a missing file is a shell gone, with no code and no end. */
export function runOf(shell: Shell, probe: Probe): ShellRun {
  const base = { label: shell.label, startedAt: shell.startedAt, ...(shell.agentId === undefined ? {} : { agentId: shell.agentId }) }
  if (shell.stoppedAt !== undefined) return { ...base, state: 'ended', code: null, endedAt: shell.stoppedAt }
  if (probe === null) return { ...base, state: 'ended', code: null, endedAt: null }
  const code = exitOf(probe.tail)
  return code === null ? { ...base, state: 'running', quietSince: probe.mtimeMs } : { ...base, state: 'ended', code, endedAt: probe.mtimeMs }
}
